import type { SFTPWrapper } from 'ssh2'

// Publishing a completed temp upload onto its real path, kept out of sftp-upload.ts to stay under the
// max-lines ratchet. Exclusive uses a standard rename (fails if the target exists); overwrite prefers
// the atomic posix-rename extension, falling back to unlink + rename.
export function publishTempUpload(
  sftp: SFTPWrapper,
  tempPath: string,
  finalPath: string,
  exclusive: boolean
): Promise<void> {
  if (exclusive) {
    return renameSftp(sftp, tempPath, finalPath)
  }
  return extRenameSftp(sftp, tempPath, finalPath).catch(async () => {
    await unlinkQuietSftp(sftp, finalPath)
    await renameSftp(sftp, tempPath, finalPath)
  })
}

export function unlinkQuietSftp(sftp: SFTPWrapper, path: string): Promise<void> {
  return new Promise((resolve) => {
    sftp.unlink(path, () => resolve())
  })
}

function renameSftp(sftp: SFTPWrapper, src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rename(src, dst, (err) => (err ? reject(err) : resolve()))
  })
}

function extRenameSftp(sftp: SFTPWrapper, src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Rejects (sync throw on old ssh2, or via callback when unsupported) so the caller can fall back.
    sftp.ext_openssh_rename(src, dst, (err) => (err ? reject(err) : resolve()))
  })
}
