import { realpath } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { mkdirSftp, uploadDirectory } from './sftp-upload'

// Upload each picked local directory recursively into remoteDir, creating the top-level remote
// folder for each. Reuses the security-guarded uploadDirectory (symlink skip + path-escape guard);
// kept out of sftp-transfer.ts so that handler stays under the max-lines ratchet.
export async function uploadDirectoriesInto(
  sftp: SFTPWrapper,
  localDirs: string[],
  remoteDir: string,
  options?: { exclusive?: boolean; signal?: AbortSignal }
): Promise<void> {
  const normalizedRemoteDir = remoteDir.replace(/\/+$/, '')
  for (const localDir of localDirs) {
    options?.signal?.throwIfAborted()
    // Resolve to a canonical root so uploadDirectory's path-escape guard measures against the real
    // path; keep the picked folder's own name for the remote destination.
    const rootRealPath = await realpath(localDir)
    const remotePath = `${normalizedRemoteDir}/${basename(localDir)}`
    await mkdirSftp(sftp, remotePath, { allowExisting: !options?.exclusive })
    await uploadDirectory(sftp, rootRealPath, remotePath, rootRealPath, options)
  }
}
