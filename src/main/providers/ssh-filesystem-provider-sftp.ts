import type { FileEntryWithStats, SFTPWrapper, Stats } from 'ssh2'
import type { FileStat } from './filesystem-provider-contract'

const ABORTED_SFTP_OPERATION_GRACE_MS = 5_000

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Download canceled')
}

function waitForSftpCallback<T>(
  register: (callback: (err?: Error | null, value?: T) => void) => void,
  options?: { signal?: AbortSignal }
): Promise<T> {
  return new Promise((resolve, reject) => {
    const signal = options?.signal
    if (signal?.aborted) {
      reject(abortReason(signal))
      return
    }

    let settled = false
    let abortTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = (): void => {
      clearTimeout(abortTimer)
      signal?.removeEventListener('abort', onAbort)
    }
    const settle = (error?: Error | null, value?: T): void => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      if (signal?.aborted) {
        reject(abortReason(signal))
      } else if (error) {
        reject(error)
      } else {
        resolve(value as T)
      }
    }
    const onAbort = (): void => {
      if (!signal || settled) {
        return
      }
      // Why: the folder owner closes SFTP on abort; wait for its callback so
      // Windows local handles quiesce before the temporary tree is removed.
      abortTimer = setTimeout(() => settle(abortReason(signal)), ABORTED_SFTP_OPERATION_GRACE_MS)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      register((error, value) => settle(error, value))
    } catch (error) {
      settle(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export function fileStatFromSftpStats(stats: Stats): FileStat {
  let type: FileStat['type'] = 'file'
  if (stats.isDirectory()) {
    type = 'directory'
  } else if (stats.isSymbolicLink()) {
    type = 'symlink'
  }
  const maybeNlink = (stats as Stats & { nlink?: unknown }).nlink
  return {
    size: stats.size,
    type,
    mtime: stats.mtime * 1000,
    ...(typeof maybeNlink === 'number' ? { nlink: maybeNlink } : {})
  }
}

// Raw lstat (link not followed) returning the ssh2 Stats. Callers that must distinguish a symlink or
// a mode-less (untrusted) entry from a real file/dir need the raw mode, which FileStat discards.
export function lstatRawViaSftp(
  sftp: SFTPWrapper,
  filePath: string,
  options?: { signal?: AbortSignal }
): Promise<Stats> {
  return waitForSftpCallback<Stats>((callback) => sftp.lstat(filePath, callback), options)
}

export function fastGetViaSftp(
  sftp: SFTPWrapper,
  sourcePath: string,
  destinationPath: string,
  options?: {
    signal?: AbortSignal
    // Forwards ssh2 fastGet's step callback (total, transferred, fileSize) for transfer progress.
    onProgress?: (totalTransferred: number, chunk: number, fileSize: number) => void
  }
): Promise<void> {
  const step = options?.onProgress
  return waitForSftpCallback<void>(
    (callback) => sftp.fastGet(sourcePath, destinationPath, step ? { step } : {}, callback),
    options
  )
}

// Why here: upstream deleted ssh-sftp-directory-close.ts with its SSH filesystem provider; only the
// fork's SFTP listing still closes directory handles.
const SFTP_DIRECTORY_CLOSE_TIMEOUT_MS = 5_000
const retiredChannels = new WeakSet<SFTPWrapper>()

function closeSftpDirectoryHandle(sftp: SFTPWrapper, handle: Buffer): Promise<Error | undefined> {
  return new Promise((resolve) => {
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timer)
      if (error && !retiredChannels.has(sftp)) {
        retiredChannels.add(sftp)
        try {
          sftp.end()
        } catch {
          // Preserve the CLOSE failure if channel teardown also fails.
        }
      }
      resolve(error)
    }
    const timer = setTimeout(
      () => finish(new Error('SFTP directory CLOSE timed out')),
      SFTP_DIRECTORY_CLOSE_TIMEOUT_MS
    )
    try {
      sftp.close(handle, (error) => finish(error ?? undefined))
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

export async function* readDirectoryEntriesViaSftp(
  sftp: SFTPWrapper,
  dirPath: string,
  options?: { signal?: AbortSignal }
): AsyncGenerator<FileEntryWithStats> {
  // Keep the late handle visible to finally when cancellation races opendir.
  options?.signal?.throwIfAborted()
  const handle = await waitForSftpCallback<Buffer>(
    (callback) =>
      sftp.opendir(dirPath, (error, value) => {
        if (!error && options?.signal?.aborted) {
          void closeSftpDirectoryHandle(sftp, value)
          callback(new Error('Download canceled'))
          return
        }
        callback(error, value)
      }),
    options
  )
  let reachedEof = false
  let closeError: Error | undefined
  try {
    options?.signal?.throwIfAborted()
    while (true) {
      let chunk: FileEntryWithStats[] | false
      try {
        chunk = await waitForSftpCallback<FileEntryWithStats[] | false>(
          (callback) => sftp.readdir(handle, callback),
          options
        )
      } catch (error) {
        options?.signal?.throwIfAborted()
        if (error instanceof Error && 'code' in error && error.code === 1) {
          reachedEof = true
          break
        }
        throw error
      }
      if (chunk === false) {
        reachedEof = true
        break
      }
      for (const entry of chunk) {
        options?.signal?.throwIfAborted()
        if (entry.filename !== '.' && entry.filename !== '..') {
          yield entry
        }
      }
    }
  } finally {
    closeError = await closeSftpDirectoryHandle(sftp, handle)
  }
  // Consumer failures enter finally via return(); do not replace their reason.
  if (reachedEof) {
    options?.signal?.throwIfAborted()
    if (closeError) {
      throw closeError
    }
  }
}

// Read up to `cap` bytes of a remote file into memory (for the read-only viewer). Uses a capped
// stream — never sftp.readFile, which is unbounded and would OOM the main process on a huge file.
export function readFileCappedViaSftp(
  sftp: SFTPWrapper,
  filePath: string,
  cap: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    // `end` is inclusive, so this pulls at most cap+1 bytes off the wire even for a giant file.
    const stream = sftp.createReadStream(filePath, { start: 0, end: cap })
    const chunks: Buffer[] = []
    let total = 0
    let truncated = false
    stream.on('data', (chunk: Buffer) => {
      // destroy() is async, so more buffered 'data' events can fire after we hit the cap; ignore them
      // (a naive clip would go negative and overshoot the cap).
      if (truncated) {
        return
      }
      total += chunk.length
      if (total > cap) {
        truncated = true
        const keep = Math.max(0, chunk.length - (total - cap))
        chunks.push(chunk.subarray(0, keep))
        stream.destroy()
        return
      }
      chunks.push(chunk)
    })
    stream.once('error', reject)
    stream.once('close', () => resolve({ buffer: Buffer.concat(chunks), truncated }))
  })
}
