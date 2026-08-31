import type {
  SftpHost,
  SftpHostAuthType,
  SftpHostInput,
  SftpHostView
} from '../../shared/sftp-host-types'
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

export type SftpProbeEntry = { name: string; type: SftpEntryType }
export type SftpProbeListing = { resolvedPath: string; entries: SftpProbeEntry[] }

/** Draft connection the add/edit form probes with, before the host is saved. */
export type SftpProbeConnectionInput = {
  host: string
  port: number
  username: string
  authType: SftpHostAuthType
  identityFile?: string
  password?: string
}

export type SftpApi = {
  readdir: (args: { targetId: string; path: string }) => Promise<SftpReaddirResult | SftpError>
  realpath: (args: { targetId: string; path: string }) => Promise<string | SftpError>
  readFile: (args: {
    targetId: string
    path: string
  }) => Promise<{ content: string; isBinary: boolean; truncated: boolean } | SftpError>
  mkdir: (args: { targetId: string; path: string }) => Promise<{ ok: true } | SftpError>
  move: (args: {
    targetId: string
    sourcePath: string
    destPath: string
    overwrite?: boolean
  }) => Promise<{ ok: true } | { conflict: true } | SftpError>
  delete: (args: {
    targetId: string
    path: string
    isDirectory: boolean
  }) => Promise<{ ok: true } | SftpError>
  startUpload: (args: {
    targetId: string
    remoteDir: string
    overwrite?: boolean
    directories?: boolean
  }) => Promise<{ transferId: string } | { canceled: true } | SftpError>
  planUpload: (args: {
    targetId: string
    remoteDir: string
  }) => Promise<
    | { items: { name: string; localPath: string; conflict: boolean }[] }
    | { canceled: true }
    | SftpError
  >
  performUpload: (args: {
    targetId: string
    remoteDir: string
    uploads: { localPath: string; remoteName: string; overwrite: boolean }[]
  }) => Promise<{ transferId: string } | SftpError>
  uploadPaths: (args: {
    targetId: string
    remoteDir: string
    paths: string[]
  }) => Promise<{ transferId: string } | SftpError>
  downloadToDir: (args: {
    targetId: string
    remotePaths: string[]
    localDir: string
  }) => Promise<{ transferId: string } | SftpError>
  startDownload: (args: {
    targetId: string
    remotePath: string
  }) => Promise<{ transferId: string } | { canceled: true } | SftpError>
  downloadArchive: (args: {
    targetId: string
    remotePaths: string[]
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
  probe: {
    list: (args: {
      connection: SftpProbeConnectionInput
      path: string
    }) => Promise<SftpProbeListing | SftpError>
  }
}
