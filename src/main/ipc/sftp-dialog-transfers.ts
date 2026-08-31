import { randomUUID } from 'node:crypto'
import { rename, stat, unlink } from 'node:fs/promises'
import { basename, posix as pathPosix } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { uploadFile } from '../ssh/sftp-upload'
import { uploadDirectoriesInto } from '../ssh/sftp-upload-batch'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import {
  emitProgress,
  emitTransferFailure,
  resolveConnection,
  toErrorMessage,
  validateString,
  withSftpChannel,
  type GetSftpConnection,
  type SftpError
} from './sftp-transfer-operations'

// The OS-dialog transfer entry points (dungeon 7-A), split from sftp-transfer.ts to stay under the
// max-lines ratchet: sftp:startUpload picks local files/folders with showOpenDialog and streams them
// into the remote dir; sftp:startDownload picks a destination with showSaveDialog and fastGets into
// a temp file it renames on success. Dialog-free drop transfers (uploadPaths/downloadToDir) live in
// sftp-upload-handlers/sftp-download-handlers.

type TransferSession = { controller: AbortController; senderId: number }

export type SftpDialogTransferDeps = {
  getSftpConnection: GetSftpConnection
  lifecycle?: { retain: (targetId: string) => void; release: (targetId: string) => void }
  transfers: Map<string, TransferSession>
  ensureDestroyedCleanup: (sender: WebContents) => void
}

export function registerSftpDialogTransferHandlers(deps: SftpDialogTransferDeps): void {
  const { getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup } = deps

  ipcMain.handle(
    'sftp:startUpload',
    async (
      event,
      args: { targetId?: string; remoteDir?: string; overwrite?: boolean; directories?: boolean }
    ): Promise<{ transferId: string } | { canceled: true } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let remoteDir: string
      try {
        remoteDir = validateString(args?.remoteDir, 'remoteDir')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }

      // Windows/Linux open dialogs can't mix file + directory selection, so folder upload is a
      // distinct mode (openDirectory) rather than one combined picker.
      const properties: ('openFile' | 'openDirectory' | 'multiSelections')[] = args?.directories
        ? ['openDirectory', 'multiSelections']
        : ['openFile', 'multiSelections']
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogResult = await (parentWindow
        ? dialog.showOpenDialog(parentWindow, { properties })
        : dialog.showOpenDialog({ properties }))
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { canceled: true }
      }

      const localPaths = dialogResult.filePaths
      const targetId = resolved.targetId
      const transferId = randomUUID()
      const controller = new AbortController()
      const senderId = event.sender.id
      transfers.set(transferId, { controller, senderId })
      ensureDestroyedCleanup(event.sender)

      const overwrite = args?.overwrite === true
      const webContents = event.sender
      lifecycle?.retain(targetId)
      void (async (): Promise<void> => {
        emitProgress(webContents, {
          transferId,
          phase: 'start',
          bytesTransferred: 0,
          totalBytes: 0
        })
        try {
          if (args?.directories) {
            // Folder upload: recurse each picked directory. Progress is indeterminate (the toast
            // shows a spinner until done); the finally block below still runs on the early return.
            await withSftpChannel(resolved.conn, (sftp) =>
              uploadDirectoriesInto(sftp, localPaths, remoteDir, {
                exclusive: !overwrite,
                signal: controller.signal
              })
            )
            emitProgress(webContents, {
              transferId,
              phase: 'done',
              bytesTransferred: 0,
              totalBytes: 0
            })
            return
          }
          // Pre-stat the batch so multi-file progress stays monotonic against one stable total instead
          // of resetting per file; best-effort (a stat failure yields 0 — uploadFile surfaces the real error).
          const fileSizes = await Promise.all(
            localPaths.map((localPath) =>
              stat(localPath)
                .then((s) => s.size)
                .catch(() => 0)
            )
          )
          const batchTotal = fileSizes.reduce((sum, size) => sum + size, 0)
          let bytesBefore = 0
          // Wrap conn.sftp() + sftp-upload directly (what openFileUploadSession does for the
          // ssh2 transport) so the transfer can carry progress + a cancel signal, which the
          // FileUploadSession contract's uploadFile options don't expose.
          await withSftpChannel(resolved.conn, async (sftp) => {
            for (let i = 0; i < localPaths.length; i++) {
              const localPath = localPaths[i]!
              // basename (OS-native) for the LOCAL source; '/' join for the POSIX remote side.
              const remotePath = `${remoteDir.replace(/\/+$/, '')}/${basename(localPath)}`
              await uploadFile(sftp, localPath, remotePath, {
                exclusive: !overwrite,
                signal: controller.signal,
                onProgress: (bytesTransferred) =>
                  emitProgress(webContents, {
                    transferId,
                    phase: 'progress',
                    bytesTransferred: bytesBefore + bytesTransferred,
                    totalBytes: batchTotal
                  })
              })
              bytesBefore += fileSizes[i]!
            }
          })
          emitProgress(webContents, {
            transferId,
            phase: 'done',
            bytesTransferred: batchTotal,
            totalBytes: batchTotal
          })
        } catch (error) {
          emitTransferFailure(webContents, transferId, controller, error)
        } finally {
          transfers.delete(transferId)
          lifecycle?.release(targetId)
        }
      })()

      return { transferId }
    }
  )

  ipcMain.handle(
    'sftp:startDownload',
    async (
      event,
      args: { targetId?: string; remotePath?: string }
    ): Promise<{ transferId: string } | { canceled: true } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let remotePath: string
      try {
        remotePath = validateString(args?.remotePath, 'remotePath')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }

      // Remote paths are POSIX — derive the default filename with a POSIX basename.
      const defaultPath = sanitizeLocalDownloadFilename(pathPosix.basename(remotePath))
      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogResult = await (parentWindow
        ? dialog.showSaveDialog(parentWindow, { defaultPath })
        : dialog.showSaveDialog({ defaultPath }))
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { canceled: true }
      }

      const localDest = dialogResult.filePath
      const targetId = resolved.targetId
      const transferId = randomUUID()
      // Stream into a sibling temp file and rename onto the destination only on success, so a failed or
      // canceled download never deletes a pre-existing file the user chose to overwrite.
      const tempDest = `${localDest}.orcinus-part-${transferId}`
      const controller = new AbortController()
      const senderId = event.sender.id
      transfers.set(transferId, { controller, senderId })
      ensureDestroyedCleanup(event.sender)

      const webContents = event.sender
      lifecycle?.retain(targetId)
      void (async (): Promise<void> => {
        emitProgress(webContents, {
          transferId,
          phase: 'start',
          bytesTransferred: 0,
          totalBytes: 0
        })
        let succeeded = false
        let completedBytes = 0
        try {
          await withSftpChannel(resolved.conn, async (sftp) => {
            const { fastGetViaSftp } = await import('../providers/ssh-filesystem-provider-sftp')
            await fastGetViaSftp(sftp, remotePath, tempDest, {
              signal: controller.signal,
              onProgress: (totalTransferred, _chunk, fileSize) => {
                completedBytes = fileSize
                emitProgress(webContents, {
                  transferId,
                  phase: 'progress',
                  bytesTransferred: totalTransferred,
                  totalBytes: fileSize
                })
              }
            })
          })
          // Atomic publish: rename replaces an existing destination on all platforms (libuv on Windows).
          await rename(tempDest, localDest)
          succeeded = true
          emitProgress(webContents, {
            transferId,
            phase: 'done',
            bytesTransferred: completedBytes,
            totalBytes: completedBytes
          })
        } catch (error) {
          emitTransferFailure(webContents, transferId, controller, error)
        } finally {
          transfers.delete(transferId)
          lifecycle?.release(targetId)
          // Only ever remove our own temp file — never the user's chosen destination.
          if (!succeeded) {
            await unlink(tempDest).catch(() => {})
          }
        }
      })()

      return { transferId }
    }
  )
}
