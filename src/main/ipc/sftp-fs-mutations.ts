import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { SFTPWrapper } from 'ssh2'
import { removeDirectorySftp, unlinkSftp } from '../ssh/sftp-upload'
import { renameSftp } from '../ssh/sftp-rename'
import {
  resolveConnection,
  toErrorMessage,
  transferErrorMessage,
  validateString,
  withSftpChannel,
  type GetSftpConnection,
  type SftpError
} from './sftp-transfer-operations'

// SFTP filesystem mutations (move/delete) for the Server Explorer, split from sftp-transfer.ts to
// stay under the max-lines ratchet. Same relay-free contract: typed {error} instead of throwing.

// lstat the destination without following symlinks; null when nothing is there. Drives the move
// conflict check and picks file-vs-recursive removal when overwriting.
function statSftpOrNull(sftp: SFTPWrapper, path: string): Promise<{ isDirectory: boolean } | null> {
  return new Promise((resolve) => {
    sftp.lstat(path, (err, stats) => {
      if (err || !stats) {
        resolve(null)
      } else {
        resolve({ isDirectory: stats.isDirectory() })
      }
    })
  })
}

// Overwrite-safe replace: rename the old destination aside, move the source into place, then remove
// the old one — restoring it if the move fails. Never deletes the destination before the source
// lands, so a failed rename can't lose data on a remote with no trash/undo.
async function replaceViaBackup(
  sftp: SFTPWrapper,
  source: string,
  dest: string,
  destIsDirectory: boolean
): Promise<void> {
  const backup = `${dest}.orcinus-replaced-${randomUUID()}`
  await renameSftp(sftp, dest, backup)
  try {
    await renameSftp(sftp, source, dest)
  } catch (error) {
    // Put the original destination back; the source is untouched.
    await renameSftp(sftp, backup, dest).catch(() => {})
    throw error
  }
  await (destIsDirectory ? removeDirectorySftp(sftp, backup) : unlinkSftp(sftp, backup))
}

export function registerSftpFsMutationHandlers(getSftpConnection: GetSftpConnection): void {
  ipcMain.handle(
    'sftp:move',
    async (
      _event,
      args: { targetId?: string; sourcePath?: string; destPath?: string; overwrite?: boolean }
    ): Promise<{ ok: true } | { conflict: true } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      let sourcePath: string
      let destPath: string
      try {
        sourcePath = validateString(args?.sourcePath, 'sourcePath')
        destPath = validateString(args?.destPath, 'destPath')
      } catch (error) {
        return { error: toErrorMessage(error) }
      }
      // Guard at the handler (not just the renderer): moving an item onto itself or into its own
      // subtree would delete the source when overwriting.
      if (destPath === sourcePath || destPath.startsWith(`${sourcePath}/`)) {
        return { error: 'Cannot move an item into itself' }
      }
      const overwrite = args?.overwrite === true
      try {
        return await withSftpChannel(resolved.conn, async (sftp) => {
          const existing = await statSftpOrNull(sftp, destPath)
          if (existing && !overwrite) {
            return { conflict: true }
          }
          await (existing
            ? replaceViaBackup(sftp, sourcePath, destPath, existing.isDirectory)
            : renameSftp(sftp, sourcePath, destPath))
          return { ok: true }
        })
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'sftp:delete',
    async (
      _event,
      args: { targetId?: string; path?: string; isDirectory?: boolean }
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
      // Defense-in-depth: refuse any root-equivalent path so a stray value can't recursively wipe
      // the account. Trailing slashes collapse to root; '.'/'~'/'..' resolve to home/parent.
      const trimmed = path.replace(/\/+$/, '')
      if (trimmed === '' || trimmed === '.' || trimmed === '~' || trimmed === '..') {
        return { error: 'Refusing to delete the root directory' }
      }
      try {
        await withSftpChannel(resolved.conn, (sftp) =>
          args?.isDirectory ? removeDirectorySftp(sftp, trimmed) : unlinkSftp(sftp, trimmed)
        )
        return { ok: true }
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )
}
