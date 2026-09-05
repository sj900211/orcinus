// Split from sftp-upload.ts for the max-lines rule: recursive remote deletion
// (readdir/unlink/rmdir walk) is its own concern.
import type { SFTPWrapper } from 'ssh2'

export async function removeDirectorySftp(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const entries = await readdirSftp(sftp, remoteDir)
  const normalizedRemoteDir = remoteDir.replace(/\/+$/, '')
  for (const entry of entries) {
    if (entry.filename === '.' || entry.filename === '..') {
      continue
    }
    const childPath = `${normalizedRemoteDir}/${entry.filename}`
    await (entry.attrs?.isDirectory?.()
      ? removeDirectorySftp(sftp, childPath)
      : unlinkSftp(sftp, childPath))
  }
  await rmdirSftp(sftp, remoteDir)
}

type SftpDirectoryEntry = {
  filename: string
  attrs?: {
    isDirectory?: () => boolean
  }
}

function readdirSftp(sftp: SFTPWrapper, remoteDir: string): Promise<SftpDirectoryEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(remoteDir, (err, entries) => {
      if (err) {
        reject(err)
        return
      }
      resolve((entries ?? []) as SftpDirectoryEntry[])
    })
  })
}

export function unlinkSftp(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.unlink(remotePath, (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}

function rmdirSftp(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.rmdir(remoteDir, (err) => {
      if (err) {
        reject(err)
        return
      }
      resolve()
    })
  })
}
