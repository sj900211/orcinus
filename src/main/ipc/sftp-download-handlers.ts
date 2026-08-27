import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { join, posix as pathPosix } from 'node:path'
import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { lstatRawViaSftp } from '../providers/ssh-filesystem-provider-sftp'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import { classifyRemoteEntry, downloadDirectory, downloadFileInto } from '../ssh/sftp-download-batch'
import { deconflictName } from './filesystem-import-local'
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

// Dialog-less remote -> local download for cross-panel drag&drop (dungeon 11-3): the renderer already
// has the dropped remote paths and the destination local directory. Split from sftp-transfer.ts to
// stay under the max-lines ratchet. Files stream via temp+rename; directories walk recursively.

type TransferSession = { controller: AbortController; senderId: number }

export type SftpDownloadHandlerDeps = {
  getSftpConnection: GetSftpConnection
  lifecycle?: { retain: (targetId: string) => void; release: (targetId: string) => void }
  transfers: Map<string, TransferSession>
  ensureDestroyedCleanup: (sender: WebContents) => void
}

export function registerSftpDownloadHandlers(deps: SftpDownloadHandlerDeps): void {
  const { getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup } = deps

  ipcMain.handle(
    'sftp:downloadToDir',
    async (
      event,
      args: { targetId?: string; remotePaths?: string[]; localDir?: string }
    ): Promise<{ transferId: string } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let localDir: string
      try {
        localDir = validateString(args?.localDir, 'localDir')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }
      const remotePaths = Array.isArray(args?.remotePaths) ? args.remotePaths : []
      if (
        remotePaths.length === 0 ||
        remotePaths.some((path) => typeof path !== 'string' || path.length === 0)
      ) {
        return { error: 'No paths to download' }
      }
      // The destination must be a real local directory. localDir is a worktree dir the user is already
      // browsing — trusted the same way uploadPaths trusts renderer-supplied local paths.
      let localReal: string
      try {
        localReal = await realpath(localDir)
        if (!(await stat(localReal)).isDirectory()) {
          return { error: 'Destination is not a directory' }
        }
      } catch {
        return { error: 'Destination directory is unavailable' }
      }

      const targetId = resolved.targetId
      const transferId = randomUUID()
      const controller = new AbortController()
      transfers.set(transferId, { controller, senderId: event.sender.id })
      ensureDestroyedCleanup(event.sender)

      const webContents = event.sender
      let bytes = 0
      lifecycle?.retain(targetId)
      void (async (): Promise<void> => {
        emitProgress(webContents, { transferId, phase: 'start', bytesTransferred: 0, totalBytes: 0 })
        try {
          // Reserve chosen local names across the whole drop so multiple items don't collide with each
          // other or with pre-existing files (deconflictName renames to "name copy" rather than clobber).
          const reserved = new Set<string>()
          await withSftpChannel(resolved.conn, async (sftp) => {
            for (const remotePath of remotePaths) {
              controller.signal.throwIfAborted()
              // Raw lstat (link not followed) + strict classify: only an affirmative file/dir proceeds,
              // so a symlink — or a mode-less entry a hostile server could forge — is never fastGet'd.
              const kind = classifyRemoteEntry(await lstatRawViaSftp(sftp, remotePath))
              if (kind === 'skip') {
                continue
              }
              // Basename sanitized in MAIN (no traversal) then deconflicted against the dest dir.
              const rawLeaf = sanitizeLocalDownloadFilename(pathPosix.basename(remotePath))
              const leaf = await deconflictName(localReal, rawLeaf, reserved)
              reserved.add(leaf)
              const dest = join(localReal, leaf)
              const onBytes = (delta: number): void => {
                bytes += delta
                emitProgress(webContents, {
                  transferId,
                  phase: 'progress',
                  bytesTransferred: bytes,
                  totalBytes: 0
                })
              }
              const transfer = kind === 'directory' ? downloadDirectory : downloadFileInto
              await transfer(sftp, remotePath, dest, { signal: controller.signal, onBytes })
            }
          })
          emitProgress(webContents, {
            transferId,
            phase: 'done',
            bytesTransferred: bytes,
            totalBytes: bytes
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
