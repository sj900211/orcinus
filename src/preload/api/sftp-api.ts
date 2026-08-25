import type { SftpHost, SftpHostInput, SftpHostView } from '../../shared/sftp-host-types'
export type { SftpHost, SftpHostInput, SftpHostView } from '../../shared/sftp-host-types'

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

export type SftpApi = {
  readdir: (args: { targetId: string; path: string }) => Promise<SftpReaddirResult | SftpError>
  realpath: (args: { targetId: string; path: string }) => Promise<string | SftpError>
  startUpload: (args: {
    targetId: string
    remoteDir: string
    overwrite?: boolean
  }) => Promise<{ transferId: string } | { canceled: true } | SftpError>
  startDownload: (args: {
    targetId: string
    remotePath: string
  }) => Promise<{ transferId: string } | { canceled: true } | SftpError>
  cancelTransfer: (args: { transferId: string }) => Promise<{ ok: true } | SftpError>
  onTransferProgress: (callback: (data: SftpTransferProgress) => void) => () => void
  host: {
    list: () => Promise<SftpHostView[]>
    add: (input: SftpHostInput) => Promise<SftpHost | SftpError>
    update: (args: { id: string; input: SftpHostInput }) => Promise<SftpHost | SftpError>
    remove: (args: { id: string }) => Promise<{ ok: true } | SftpError>
    test: (args: { id: string }) => Promise<{ ok: true } | SftpError>
  }
}
