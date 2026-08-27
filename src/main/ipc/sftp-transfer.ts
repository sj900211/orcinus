import { randomUUID } from 'node:crypto'
import { rename, stat, unlink } from 'node:fs/promises'
import { basename, posix as pathPosix } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { readDirViaSftp } from '../providers/ssh-filesystem-provider-sftp'
import { mkdirSftp, uploadFile } from '../ssh/sftp-upload'
import { uploadDirectoriesInto } from '../ssh/sftp-upload-batch'
import { registerSftpFsMutationHandlers } from './sftp-fs-mutations'
import { registerSftpUploadHandlers } from './sftp-upload-handlers'
import { registerSftpArchiveHandlers } from './sftp-download-archive'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import {
  emitProgress,
  emitTransferFailure,
  mapAndSortSftpEntries,
  realpathViaSftp,
  resolveConnection,
  toErrorMessage,
  transferErrorMessage,
  validateString,
  withSftpChannel,
  type GetSftpConnection,
  type SftpError,
  type SftpReaddirResult
} from './sftp-transfer-operations'

export type {
  SftpEntry,
  SftpEntryType,
  SftpReaddirResult,
  SftpTransferPhase,
  SftpTransferProgress
} from './sftp-transfer-operations'

// Backend IPC for the SFTP Server Explorer (Expedition 3). A targetId is an SSH
// connection id; every op resolves a relay-free raw ssh2 connection (so plain SFTP
// servers without a Node.js relay work) and returns a typed error object (never a
// raw throw) when the target is unknown or the connect/auth fails.

const SFTP_IPC_CHANNELS = [
  'sftp:readdir',
  'sftp:realpath',
  'sftp:startUpload',
  'sftp:startDownload',
  'sftp:cancelTransfer',
  'sftp:mkdir',
  'sftp:move',
  'sftp:delete',
  'sftp:planUpload',
  'sftp:performUpload',
  'sftp:downloadArchive'
] as const

type TransferSession = { controller: AbortController; senderId: number }

// Restarts the idle countdown on the shared connection pool around a transfer so a long upload/download
// isn't reaped mid-stream. Optional so the unit tests can register handlers without a pool.
export type SftpConnectionLifecycle = {
  retain: (targetId: string) => void
  release: (targetId: string) => void
}

export function registerSftpTransferHandlers(
  getSftpConnection: GetSftpConnection,
  lifecycle?: SftpConnectionLifecycle
): void {
  for (const channel of SFTP_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  const transfers = new Map<string, TransferSession>()
  // One 'destroyed' listener per WebContents, not per transfer: `.once` self-removes only when it fires,
  // so re-adding it per transfer would leak listeners and trip MaxListenersExceededWarning after ~10.
  const sendersWithCleanup = new Set<number>()

  const cleanupTransfersForSender = (senderId: number): void => {
    for (const [transferId, session] of Array.from(transfers)) {
      if (session.senderId === senderId) {
        session.controller.abort()
        transfers.delete(transferId)
      }
    }
  }

  const ensureDestroyedCleanup = (sender: WebContents): void => {
    if (sendersWithCleanup.has(sender.id)) {
      return
    }
    sendersWithCleanup.add(sender.id)
    sender.once?.('destroyed', () => {
      sendersWithCleanup.delete(sender.id)
      cleanupTransfersForSender(sender.id)
    })
  }

  ipcMain.handle(
    'sftp:readdir',
    async (
      _event,
      args: { targetId?: string; path?: string }
    ): Promise<SftpReaddirResult | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let path: string
      try {
        path = validateString(args?.path, 'path')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }
      try {
        return await withSftpChannel(resolved.conn, async (sftp) => {
          const resolvedPath = await realpathViaSftp(sftp, path)
          const rawEntries = await readDirViaSftp(sftp, resolvedPath)
          return { entries: mapAndSortSftpEntries(rawEntries), resolvedPath }
        })
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'sftp:mkdir',
    async (
      _event,
      args: { targetId?: string; path?: string }
    ): Promise<{ ok: true } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let path: string
      try {
        path = validateString(args?.path, 'path')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }
      try {
        await withSftpChannel(resolved.conn, (sftp) =>
          mkdirSftp(sftp, path, { allowExisting: false })
        )
        return { ok: true }
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'sftp:realpath',
    async (_event, args: { targetId?: string; path?: string }): Promise<string | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let path: string
      try {
        path = validateString(args?.path, 'path')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }
      try {
        return await withSftpChannel(resolved.conn, (sftp) => realpathViaSftp(sftp, path))
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

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
      const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = args?.directories
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

  ipcMain.handle(
    'sftp:cancelTransfer',
    async (_event, args: { transferId?: string }): Promise<{ ok: true } | SftpError> => {
      if (typeof args?.transferId !== 'string' || args.transferId.length === 0) {
        return { error: 'transferId is required' }
      }
      const session = transfers.get(args.transferId)
      if (!session) {
        return { error: 'Transfer not found' }
      }
      session.controller.abort()
      transfers.delete(args.transferId)
      return { ok: true }
    }
  )

  registerSftpFsMutationHandlers(getSftpConnection)
  registerSftpUploadHandlers({ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup })
  registerSftpArchiveHandlers({ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup })
}
