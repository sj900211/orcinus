import { randomUUID } from 'node:crypto'
import { lstat } from 'node:fs/promises'
import { basename } from 'node:path'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { SFTPWrapper } from 'ssh2'
import {
  uploadDirectoriesInto,
  uploadFilesInto,
  type ResolvedUpload
} from '../ssh/sftp-upload-batch'
import {
  emitProgress,
  emitTransferFailure,
  resolveConnection,
  toErrorMessage,
  transferErrorMessage,
  validateString,
  withSftpChannel,
  type GetSftpConnection,
  type SftpError
} from './sftp-transfer-operations'

// The conflict-aware file upload flow (dungeon 8-B), split from sftp-transfer.ts to stay under the
// max-lines ratchet. Two steps: planUpload picks local files and flags remote name collisions; the
// renderer prompts overwrite/rename/skip; performUpload uploads the resolved set. Folder upload keeps
// using sftp:startUpload (exclusive) — folder-merge conflict handling is out of scope here.

type TransferSession = { controller: AbortController; senderId: number }

export type SftpUploadHandlerDeps = {
  getSftpConnection: GetSftpConnection
  lifecycle?: { retain: (targetId: string) => void; release: (targetId: string) => void }
  transfers: Map<string, TransferSession>
  ensureDestroyedCleanup: (sender: WebContents) => void
}

type PlanUploadItem = { name: string; localPath: string; conflict: boolean }

function remotePathExists(sftp: SFTPWrapper, path: string): Promise<boolean> {
  return new Promise((resolve) => {
    sftp.lstat(path, (err) => resolve(!err))
  })
}

export function registerSftpUploadHandlers(deps: SftpUploadHandlerDeps): void {
  const { getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup } = deps

  ipcMain.handle(
    'sftp:planUpload',
    async (
      event,
      args: { targetId?: string; remoteDir?: string }
    ): Promise<{ items: PlanUploadItem[] } | { canceled: true } | SftpError> => {
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

      const parentWindow = BrowserWindow.fromWebContents(event.sender) ?? undefined
      const dialogResult = await (parentWindow
        ? dialog.showOpenDialog(parentWindow, { properties: ['openFile', 'multiSelections'] })
        : dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] }))
      if (dialogResult.canceled || dialogResult.filePaths.length === 0) {
        return { canceled: true }
      }

      const normalizedRemoteDir = remoteDir.replace(/\/+$/, '')
      try {
        const items = await withSftpChannel(resolved.conn, (sftp) =>
          Promise.all(
            dialogResult.filePaths.map(async (localPath): Promise<PlanUploadItem> => {
              const name = basename(localPath)
              const conflict = await remotePathExists(sftp, `${normalizedRemoteDir}/${name}`)
              return { name, localPath, conflict }
            })
          )
        )
        return { items }
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'sftp:performUpload',
    async (
      event,
      args: { targetId?: string; remoteDir?: string; uploads?: ResolvedUpload[] }
    ): Promise<{ transferId: string } | SftpError> => {
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
      const uploads = Array.isArray(args?.uploads) ? args.uploads : []
      if (uploads.length === 0) {
        return { error: 'No files to upload' }
      }
      // A remoteName is a single path segment — never let the renderer smuggle a traversal into it.
      for (const upload of uploads) {
        if (
          typeof upload?.remoteName !== 'string' ||
          upload.remoteName.length === 0 ||
          upload.remoteName === '.' ||
          upload.remoteName === '..' ||
          upload.remoteName.includes('/') ||
          upload.remoteName.includes('\\') ||
          typeof upload?.localPath !== 'string' ||
          upload.localPath.length === 0
        ) {
          return { error: 'Invalid upload entry' }
        }
      }

      const targetId = resolved.targetId
      const transferId = randomUUID()
      const controller = new AbortController()
      transfers.set(transferId, { controller, senderId: event.sender.id })
      ensureDestroyedCleanup(event.sender)

      const webContents = event.sender
      let lastTotal = 0
      lifecycle?.retain(targetId)
      void (async (): Promise<void> => {
        emitProgress(webContents, {
          transferId,
          phase: 'start',
          bytesTransferred: 0,
          totalBytes: 0
        })
        try {
          await withSftpChannel(resolved.conn, (sftp) =>
            uploadFilesInto(sftp, uploads, remoteDir, {
              signal: controller.signal,
              onProgress: (bytesTransferred, totalBytes) => {
                lastTotal = totalBytes
                emitProgress(webContents, {
                  transferId,
                  phase: 'progress',
                  bytesTransferred,
                  totalBytes
                })
              }
            })
          )
          emitProgress(webContents, {
            transferId,
            phase: 'done',
            bytesTransferred: lastTotal,
            totalBytes: lastTotal
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

  // Dialog-less upload for cross-panel drag&drop (dungeon 11-2): the renderer already has the dropped
  // local paths, so no open-dialog. Exclusive (overwrite=false) — a name collision fails the transfer
  // rather than clobbering, matching the non-destructive default of folder startUpload.
  ipcMain.handle(
    'sftp:uploadPaths',
    async (
      event,
      args: { targetId?: string; remoteDir?: string; paths?: string[] }
    ): Promise<{ transferId: string } | SftpError> => {
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
      const paths = Array.isArray(args?.paths) ? args.paths : []
      if (paths.length === 0 || paths.some((p) => typeof p !== 'string' || p.length === 0)) {
        return { error: 'No paths to upload' }
      }

      const targetId = resolved.targetId
      const transferId = randomUUID()
      const controller = new AbortController()
      transfers.set(transferId, { controller, senderId: event.sender.id })
      ensureDestroyedCleanup(event.sender)

      const webContents = event.sender
      let lastTotal = 0
      lifecycle?.retain(targetId)
      void (async (): Promise<void> => {
        emitProgress(webContents, { transferId, phase: 'start', bytesTransferred: 0, totalBytes: 0 })
        try {
          // Split dropped paths into files vs directories; each routes to its own engine. The remote
          // name is the local basename (computed here, never from the renderer) so no traversal.
          // lstat (not stat): a top-level SYMLINK must be refused — uploadDirectoriesInto realpaths a
          // symlinked directory and would upload the target tree (e.g. a link to ~/.ssh) outside the
          // dropped source. Internal symlinks are already skipped by uploadDirectory.
          const entries = await Promise.all(
            paths.map(async (localPath) => {
              const info = await lstat(localPath)
              return {
                localPath,
                isSymbolicLink: info.isSymbolicLink(),
                isDirectory: info.isDirectory()
              }
            })
          )
          if (entries.some((entry) => entry.isSymbolicLink)) {
            throw new Error('Symbolic links cannot be uploaded')
          }
          const fileUploads: ResolvedUpload[] = entries
            .filter((entry) => !entry.isDirectory)
            .map((entry) => ({
              localPath: entry.localPath,
              remoteName: basename(entry.localPath),
              overwrite: false
            }))
          const dirPaths = entries.filter((entry) => entry.isDirectory).map((entry) => entry.localPath)
          await withSftpChannel(resolved.conn, async (sftp) => {
            if (fileUploads.length > 0) {
              await uploadFilesInto(sftp, fileUploads, remoteDir, {
                signal: controller.signal,
                onProgress: (bytesTransferred, totalBytes) => {
                  lastTotal = totalBytes
                  emitProgress(webContents, {
                    transferId,
                    phase: 'progress',
                    bytesTransferred,
                    totalBytes
                  })
                }
              })
            }
            if (dirPaths.length > 0) {
              await uploadDirectoriesInto(sftp, dirPaths, remoteDir, {
                exclusive: true,
                signal: controller.signal
              })
            }
          })
          emitProgress(webContents, {
            transferId,
            phase: 'done',
            bytesTransferred: lastTotal,
            totalBytes: lastTotal
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
}
