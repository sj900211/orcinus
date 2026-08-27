import { mkdir, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SFTPWrapper, Stats } from 'ssh2'
import { fastGetViaSftp, readDirViaSftp } from '../providers/ssh-filesystem-provider-sftp'
import { sanitizeLocalDownloadFilename } from '../local-download-filename'

type DownloadOptions = {
  signal?: AbortSignal
  onBytes?: (delta: number) => void
}

const S_IFMT = 0o170000
const S_IFREG = 0o100000
const S_IFDIR = 0o040000

/**
 * Positively classify a remote entry as a regular file or directory from its ssh2 attrs. SFTP
 * permissions are OPTIONAL: a hostile/omitting server can send attrs with no `mode`, which would make
 * a symlink's isSymbolicLink() read false and get it misclassified as a file — then fastGet would
 * follow the link server-side and pull an out-of-tree target (e.g. ~/.ssh/id_rsa). So require an
 * affirmative S_IFREG/S_IFDIR mode; anything else (symlink, special, or missing mode) is skipped.
 */
export function classifyRemoteEntry(attrs: Stats | undefined): 'file' | 'directory' | 'skip' {
  const mode = attrs?.mode
  if (typeof mode !== 'number') {
    return 'skip'
  }
  const format = mode & S_IFMT
  if (format === S_IFDIR) {
    return 'directory'
  }
  if (format === S_IFREG) {
    return 'file'
  }
  return 'skip'
}

// Download one remote FILE into destPath via a sibling temp file + atomic rename, so a failed or
// canceled transfer never leaves a partial file or clobbers an existing local one until it completes.
export async function downloadFileInto(
  sftp: SFTPWrapper,
  remotePath: string,
  destPath: string,
  options?: DownloadOptions
): Promise<void> {
  const temp = `${destPath}.orcinus-part-${randomUUID()}`
  let lastTotal = 0
  try {
    await fastGetViaSftp(sftp, remotePath, temp, {
      signal: options?.signal,
      onProgress: (totalTransferred) => {
        options?.onBytes?.(totalTransferred - lastTotal)
        lastTotal = totalTransferred
      }
    })
    await rename(temp, destPath)
  } catch (error) {
    await unlink(temp).catch(() => {})
    throw error
  }
}

// Recursively download a remote directory tree into localDir. Symlinks (and non-file/dir specials)
// are SKIPPED, never followed — following a remote symlink could exfiltrate an out-of-tree target
// (e.g. a link to ~/.ssh) or loop. Each filename is sanitized for the local OS so a crafted remote
// name can't escape localDir.
export async function downloadDirectory(
  sftp: SFTPWrapper,
  remoteDir: string,
  localDir: string,
  options?: DownloadOptions
): Promise<void> {
  options?.signal?.throwIfAborted()
  await mkdir(localDir, { recursive: true })
  const entries = await readDirViaSftp(sftp, remoteDir, { signal: options?.signal })
  const parent = remoteDir.endsWith('/') ? remoteDir.slice(0, -1) : remoteDir
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') {
      continue
    }
    options?.signal?.throwIfAborted()
    const kind = classifyRemoteEntry(entry.attrs)
    if (kind === 'skip') {
      continue
    }
    const childRemote = `${parent}/${entry.filename}`
    const childLocal = join(localDir, sanitizeLocalDownloadFilename(entry.filename))
    const transfer = kind === 'directory' ? downloadDirectory : downloadFileInto
    await transfer(sftp, childRemote, childLocal, options)
  }
}
