import { ipcMain } from 'electron'
import type { WebContents } from 'electron'
import { readDirViaSftp, readFileCappedViaSftp } from '../providers/ssh-filesystem-provider-sftp'
import { isBinaryBuffer } from '../../shared/binary-buffer'
import { mkdirSftp } from '../ssh/sftp-upload'
import { registerSftpFsMutationHandlers } from './sftp-fs-mutations'
import { registerSftpDialogTransferHandlers } from './sftp-dialog-transfers'
import { registerSftpUploadHandlers } from './sftp-upload-handlers'
import { registerSftpArchiveHandlers } from './sftp-download-archive'
import { registerSftpDownloadHandlers } from './sftp-download-handlers'
import {
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
  'sftp:readFile',
  'sftp:startUpload',
  'sftp:startDownload',
  'sftp:cancelTransfer',
  'sftp:mkdir',
  'sftp:move',
  'sftp:delete',
  'sftp:planUpload',
  'sftp:performUpload',
  'sftp:uploadPaths',
  'sftp:downloadArchive',
  'sftp:downloadToDir'
] as const

// Viewer read cap — matches the relay text-file cap (ssh-file-stream-read-cap.ts MAX_TEXT_FILE_SIZE).
const SFTP_READ_MAX_BYTES = 10 * 1024 * 1024

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
    'sftp:readFile',
    async (
      _event,
      args: { targetId?: string; path?: string }
    ): Promise<{ content: string; isBinary: boolean; truncated: boolean } | SftpError> => {
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
          const { buffer, truncated } = await readFileCappedViaSftp(sftp, path, SFTP_READ_MAX_BYTES)
          const isBinary = isBinaryBuffer(buffer)
          // Never decode a binary blob into the text viewer; the renderer shows a "binary" notice.
          return { content: isBinary ? '' : buffer.toString('utf-8'), isBinary, truncated }
        })
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
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
  registerSftpDialogTransferHandlers({
    getSftpConnection,
    lifecycle,
    transfers,
    ensureDestroyedCleanup
  })
  registerSftpUploadHandlers({ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup })
  registerSftpArchiveHandlers({ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup })
  registerSftpDownloadHandlers({ getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup })
}
