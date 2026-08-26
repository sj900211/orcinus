import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { SFTPWrapper } from 'ssh2'
import { mkdirSftp, uploadDirectory, uploadFile } from './sftp-upload'

export type ResolvedUpload = { localPath: string; remoteName: string; overwrite: boolean }

// Upload a resolved set of local files into remoteDir, each under its (possibly renamed) remote name.
// overwrite=false uploads exclusively (fails if the target exists); overwrite=true replaces it via
// uploadFile's atomic temp+rename. Progress is monotonic against one pre-measured batch total.
export async function uploadFilesInto(
  sftp: SFTPWrapper,
  uploads: ResolvedUpload[],
  remoteDir: string,
  options?: {
    signal?: AbortSignal
    onProgress?: (bytesTransferred: number, totalBytes: number) => void
  }
): Promise<void> {
  const normalizedRemoteDir = remoteDir.replace(/\/+$/, '')
  const sizes = await Promise.all(
    uploads.map((upload) =>
      stat(upload.localPath)
        .then((s) => s.size)
        .catch(() => 0)
    )
  )
  const total = sizes.reduce((sum, size) => sum + size, 0)
  let done = 0
  for (let i = 0; i < uploads.length; i++) {
    options?.signal?.throwIfAborted()
    const upload = uploads[i]!
    const remotePath = `${normalizedRemoteDir}/${upload.remoteName}`
    await uploadFile(sftp, upload.localPath, remotePath, {
      exclusive: !upload.overwrite,
      signal: options?.signal,
      onProgress: options?.onProgress
        ? (bytesTransferred) => options.onProgress!(done + bytesTransferred, total)
        : undefined
    })
    done += sizes[i]!
  }
}

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
