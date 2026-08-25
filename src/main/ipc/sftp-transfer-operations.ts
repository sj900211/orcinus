import type { WebContents } from 'electron'
import type { FileEntryWithStats, SFTPWrapper } from 'ssh2'
import type { SshConnection } from '../ssh/ssh-connection'
import { SftpConnectionAccessFailure } from '../ssh/sftp-connection'
import { fileStatFromSftpStats } from '../providers/ssh-filesystem-provider-sftp'
import { compareFileNames } from '../../shared/file-name-sort'

// Shared types + SFTP primitives for the transfer IPC handlers. Kept apart from the
// handler registration so each file stays a single responsibility (and under max-lines).

export const TRANSFER_PROGRESS_CHANNEL = 'sftp:transferProgress'

export type SftpEntryType = 'file' | 'directory' | 'symlink'

export type SftpEntry = {
  name: string
  type: SftpEntryType
  size: number
  mtime: number
  mode?: number
}

export type SftpReaddirResult = { entries: SftpEntry[]; resolvedPath: string }

export type SftpError = { error: string }

export type SftpTransferPhase = 'start' | 'progress' | 'done' | 'error' | 'canceled'

export type SftpTransferProgress = {
  transferId: string
  phase: SftpTransferPhase
  bytesTransferred: number
  totalBytes: number
  error?: string
}

export const SFTP_UNAVAILABLE_MESSAGE =
  'SFTP is not available on this connection (system SSH transport).'

// Detects the sftp()-unavailable guard on the system-SSH transport so it reads as a clear typed error.
export function isSftpUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('SFTP is not available')
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return typeof error === 'string' ? error : 'Unknown error'
}

export function transferErrorMessage(error: unknown): string {
  return isSftpUnavailableError(error) ? SFTP_UNAVAILABLE_MESSAGE : toErrorMessage(error)
}

export function validateString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}

export type GetSftpConnection = (targetId: string) => Promise<SshConnection>

// Resolves the raw ssh2 connection for a target via the relay-free SFTP accessor, so a plain SFTP
// server (no Node.js relay) works. Every failure — bad arg, unknown target, connect/auth failure —
// comes back as a typed {error}, never a raw throw (the IPC contract callers depend on).
export async function resolveConnection(
  getSftpConnection: GetSftpConnection,
  targetId: unknown
): Promise<{ conn: SshConnection; targetId: string } | SftpError> {
  if (typeof targetId !== 'string' || targetId.length === 0) {
    return { error: 'targetId is required' }
  }
  try {
    return { conn: await getSftpConnection(targetId), targetId }
  } catch (error) {
    if (error instanceof SftpConnectionAccessFailure) {
      return { error: error.message }
    }
    return { error: toErrorMessage(error) }
  }
}

function mapEntry(entry: FileEntryWithStats): SftpEntry {
  const attrs = entry.attrs
  const stat = attrs ? fileStatFromSftpStats(attrs) : { size: 0, type: 'file' as const, mtime: 0 }
  return {
    name: entry.filename,
    type: stat.type,
    size: stat.size,
    mtime: stat.mtime,
    ...(attrs && typeof attrs.mode === 'number' ? { mode: attrs.mode } : {})
  }
}

// Directories first, then natural name order — mirrors the Explorer listing contract.
export function mapAndSortSftpEntries(rawEntries: FileEntryWithStats[]): SftpEntry[] {
  return rawEntries.map(mapEntry).sort((a, b) => {
    const aDir = a.type === 'directory'
    const bDir = b.type === 'directory'
    if (aDir !== bDir) {
      return aDir ? -1 : 1
    }
    return compareFileNames(a.name, b.name)
  })
}

export function realpathViaSftp(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(path, (err, resolved) => {
      if (err) {
        reject(err)
        return
      }
      resolve(resolved)
    })
  })
}

// Runs an SFTP op on a per-call channel; the channel is always closed afterward (matches downloadFile).
export async function withSftpChannel<T>(
  conn: SshConnection,
  run: (sftp: SFTPWrapper) => Promise<T>
): Promise<T> {
  const sftp = await conn.sftp()
  try {
    return await run(sftp)
  } finally {
    sftp.end()
  }
}

export function emitProgress(webContents: WebContents, progress: SftpTransferProgress): void {
  if (webContents.isDestroyed()) {
    return
  }
  webContents.send(TRANSFER_PROGRESS_CHANNEL, progress)
}

// Terminal failure phase: distinguish a deliberate cancel ('canceled') from a real error so the renderer
// doesn't raise a failure notification for a user-initiated abort.
export function emitTransferFailure(
  webContents: WebContents,
  transferId: string,
  controller: AbortController,
  error: unknown
): void {
  const canceled = controller.signal.aborted
  emitProgress(webContents, {
    transferId,
    phase: canceled ? 'canceled' : 'error',
    bytesTransferred: 0,
    totalBytes: 0,
    ...(canceled ? {} : { error: transferErrorMessage(error) })
  })
}
