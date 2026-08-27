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

// Deepest common POSIX directory of the paths (segment-wise, so /foo and /foobar don't share /foo).
function commonAncestorDir(paths: string[]): string {
  if (paths.length === 1) {
    return pathPosix.dirname(paths[0]!)
  }
  const segmentLists = paths.map((path) => path.split('/'))
  const first = segmentLists[0]!
  let shared = 0
  while (
    shared < first.length &&
    segmentLists.every((segments) => segments[shared] === first[shared])
  ) {
    shared += 1
  }
  return first.slice(0, shared).join('/') || '/'
}

// Drop any path contained by another selected path so tar doesn't archive it twice.
function dropNestedPaths(paths: string[]): string[] {
  return paths.filter(
    (path) => !paths.some((other) => other !== path && path.startsWith(`${other}/`))
  )
}

// Pipe `tar -czf -` of the selected remote paths into tempDest. shellEscape guards each argument (a
// path literally named "; rm -rf ~" must not become shell). -C <commonAncestor> keeps archive members
// relative, preserving structure across items in different directories. The `--` before the members
// stops tar from parsing a file literally named like `--checkpoint-action=exec=…` as an option
// (shellEscape blocks shell injection but still delivers such a name to tar as a distinct argv word).
async function streamTarToFile(
  conn: SshConnection,
  remotePaths: string[],
  tempDest: string,
  signal: AbortSignal,
  onBytes: (delta: number) => void
): Promise<void> {
  const kept = dropNestedPaths([...new Set(remotePaths)])
  const ancestor = commonAncestorDir(kept)
  const members = kept.map((path) => pathPosix.relative(ancestor, path))
  const command = `tar -czf - -C ${shellEscape(ancestor)} -- ${members.map(shellEscape).join(' ')}`
  const channel = await conn.exec(command, { signal })
  let stderr = ''
  let exitCode: number | null = null
  let exitSignal: string | null = null
  channel.stderr.on('data', (chunk: Buffer) => {
    if (stderr.length < 4096) {
      stderr += chunk.toString()
    }
  })
  // ssh2 emits exit as (code) on a clean exit, or (null, signalName) when the remote tar is killed —
  // a signal must be treated as failure so a truncated archive is never renamed onto the destination.
  channel.on('exit', (code: number | null, signalName?: string | null) => {
    if (typeof code === 'number') {
      exitCode = code
    } else if (signalName) {
      exitSignal = signalName
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
  if (exitSignal) {
    throw new Error(stderr.trim() || `tar terminated by signal ${exitSignal}`)
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
      args: { targetId?: string; remotePaths?: string[] }
    ): Promise<{ transferId: string } | { canceled: true } | SftpError> => {
      const resolved = await resolveConnection(getSftpConnection, args?.targetId)
      if ('error' in resolved) {
        return resolved
      }
      const remotePaths = Array.isArray(args?.remotePaths) ? args.remotePaths : []
      if (
        remotePaths.length === 0 ||
        remotePaths.some((path) => typeof path !== 'string' || path.length === 0)
      ) {
        return { error: 'remotePaths is required' }
      }

      // Single item keeps its own name; a multi-item archive is just "archive.tar.gz".
      const defaultBase =
        remotePaths.length === 1 ? pathPosix.basename(remotePaths[0]!) : 'archive'
      const defaultPath = sanitizeLocalDownloadFilename(`${defaultBase}.tar.gz`)
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
          await streamTarToFile(resolved.conn, remotePaths, tempDest, controller.signal, (delta) => {
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
