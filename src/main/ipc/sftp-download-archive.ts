import { createWriteStream } from 'node:fs'
import { rename, unlink } from 'node:fs/promises'
import { posix as pathPosix } from 'node:path'
import { randomUUID } from 'node:crypto'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import type { WebContents } from 'electron'
import type { SshConnection } from '../ssh/ssh-connection'
import { shellEscape } from '../ssh/ssh-connection-utils'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'
import {
  emitProgress,
  emitTransferFailure,
  resolveConnection,
  toErrorMessage,
  validateString,
  type GetSftpConnection,
  type SftpError
} from './sftp-transfer-operations'

// Folder archive download (dungeon 8-D): stream `tar -czf -` from the remote over an exec channel
// into a local temp file, renamed onto the chosen path on success. Split from sftp-transfer.ts for
// max-lines. Only ever runs on the relay-free ssh2 connection (which always has exec), since a
// system-ssh transport can't open SFTP in the first place.

type TransferSession = { controller: AbortController; senderId: number }

export type SftpArchiveHandlerDeps = {
  getSftpConnection: GetSftpConnection
  lifecycle?: { retain: (targetId: string) => void; release: (targetId: string) => void }
  transfers: Map<string, TransferSession>
  ensureDestroyedCleanup: (sender: WebContents) => void
}

// Pipe `tar -czf -` of one remote directory into tempDest. shellEscape guards against a crafted path
// (a directory literally named "; rm -rf ~" must not become shell). -C <parent> keeps archive members
// relative to the folder instead of absolute.
async function streamTarToFile(
  conn: SshConnection,
  remotePath: string,
  tempDest: string,
  signal: AbortSignal,
  onBytes: (delta: number) => void
): Promise<void> {
  const parent = pathPosix.dirname(remotePath)
  const name = pathPosix.basename(remotePath)
  const channel = await conn.exec(`tar -czf - -C ${shellEscape(parent)} ${shellEscape(name)}`, {
    signal
  })
  let stderr = ''
  let exitCode: number | null = null
  channel.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 4096) {
      stderr += chunk.toString()
    }
  })
  channel.on('exit', (code: number | null) => {
    if (typeof code === 'number') {
      exitCode = code
    }
  })
  channel.on('data', (chunk: Buffer) => onBytes(chunk.length))
  const writeStream = createWriteStream(tempDest)
  let rejectPromise: ((error: Error) => void) | null = null
  // destroy() with no error emits only 'close' (never 'finish'/'error'), so abort must reject
  // explicitly or the transfer would hang and never clean up.
  const onAbort = (): void => {
    channel.close()
    writeStream.destroy()
    rejectPromise?.(new Error('Archive download canceled'))
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    // Resolve only once BOTH the local file flushed AND the remote channel closed — 'exit' fires
    // before 'close', so waiting for 'close' guarantees the exit code is known before we would treat
    // a truncated archive as success.
    await new Promise<void>((resolve, reject) => {
      rejectPromise = reject
      let writeFinished = false
      let channelClosed = false
      const settle = (): void => {
        if (writeFinished && channelClosed) {
          resolve()
        }
      }
      channel.once('error', reject)
      writeStream.once('error', reject)
      writeStream.once('finish', () => {
        writeFinished = true
        settle()
      })
      channel.once('close', () => {
        channelClosed = true
        settle()
      })
      channel.pipe(writeStream)
    })
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
  if (exitCode !== null && exitCode !== 0) {
    throw new Error(stderr.trim() || `tar exited with code ${String(exitCode)}`)
  }
}

export function registerSftpArchiveHandlers(deps: SftpArchiveHandlerDeps): void {
  const { getSftpConnection, lifecycle, transfers, ensureDestroyedCleanup } = deps

  ipcMain.handle(
    'sftp:downloadArchive',
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

      const defaultPath = sanitizeLocalDownloadFilename(`${pathPosix.basename(remotePath)}.tar.gz`)
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
      // Stream into a sibling temp file and rename onto the destination only on success, so a failed
      // or canceled archive never leaves a partial/clobbered file the user chose to overwrite.
      const tempDest = `${localDest}.orcinus-part-${transferId}`
      const controller = new AbortController()
      transfers.set(transferId, { controller, senderId: event.sender.id })
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
        let bytes = 0
        try {
          await streamTarToFile(resolved.conn, remotePath, tempDest, controller.signal, (delta) => {
            bytes += delta
            emitProgress(webContents, {
              transferId,
              phase: 'progress',
              bytesTransferred: bytes,
              totalBytes: 0
            })
          })
          await rename(tempDest, localDest)
          succeeded = true
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
          if (!succeeded) {
            await unlink(tempDest).catch(() => {})
          }
        }
      })()

      return { transferId }
    }
  )
}
