// Fork bridge (SFTP explorer): split from preload/index.ts for the max-lines rule.
import { ipcRenderer } from 'electron'

import type {
  SftpReaddirResult,
  SftpError,
  SftpTransferProgress,
  SftpHost,
  SftpHostInput,
  SftpHostView,
  SftpProbeListing,
  SftpProbeConnectionInput
} from './sftp-api'

export const sftpBridgeApi = {
  readdir: (args: { targetId: string; path: string }): Promise<SftpReaddirResult | SftpError> =>
    ipcRenderer.invoke('sftp:readdir', args),

  realpath: (args: { targetId: string; path: string }): Promise<string | SftpError> =>
    ipcRenderer.invoke('sftp:realpath', args),

  readFile: (args: {
    targetId: string
    path: string
  }): Promise<{ content: string; isBinary: boolean; truncated: boolean } | SftpError> =>
    ipcRenderer.invoke('sftp:readFile', args),

  mkdir: (args: { targetId: string; path: string }): Promise<{ ok: true } | SftpError> =>
    ipcRenderer.invoke('sftp:mkdir', args),

  move: (args: {
    targetId: string
    sourcePath: string
    destPath: string
    overwrite?: boolean
  }): Promise<{ ok: true } | { conflict: true } | SftpError> =>
    ipcRenderer.invoke('sftp:move', args),

  delete: (args: {
    targetId: string
    path: string
    isDirectory: boolean
  }): Promise<{ ok: true } | SftpError> => ipcRenderer.invoke('sftp:delete', args),

  startUpload: (args: {
    targetId: string
    remoteDir: string
    overwrite?: boolean
    directories?: boolean
  }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
    ipcRenderer.invoke('sftp:startUpload', args),

  planUpload: (args: {
    targetId: string
    remoteDir: string
  }): Promise<
    | { items: { name: string; localPath: string; conflict: boolean }[] }
    | { canceled: true }
    | SftpError
  > => ipcRenderer.invoke('sftp:planUpload', args),

  performUpload: (args: {
    targetId: string
    remoteDir: string
    uploads: { localPath: string; remoteName: string; overwrite: boolean }[]
  }): Promise<{ transferId: string } | SftpError> =>
    ipcRenderer.invoke('sftp:performUpload', args),

  uploadPaths: (args: {
    targetId: string
    remoteDir: string
    paths: string[]
  }): Promise<{ transferId: string } | SftpError> => ipcRenderer.invoke('sftp:uploadPaths', args),

  downloadToDir: (args: {
    targetId: string
    remotePaths: string[]
    localDir: string
  }): Promise<{ transferId: string } | SftpError> =>
    ipcRenderer.invoke('sftp:downloadToDir', args),

  startDownload: (args: {
    targetId: string
    remotePath: string
  }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
    ipcRenderer.invoke('sftp:startDownload', args),

  downloadArchive: (args: {
    targetId: string
    remotePaths: string[]
  }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
    ipcRenderer.invoke('sftp:downloadArchive', args),

  cancelTransfer: (args: { transferId: string }): Promise<{ ok: true } | SftpError> =>
    ipcRenderer.invoke('sftp:cancelTransfer', args),

  onTransferProgress: (callback: (data: SftpTransferProgress) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: SftpTransferProgress): void =>
      callback(data)
    ipcRenderer.on('sftp:transferProgress', listener)
    return () => ipcRenderer.removeListener('sftp:transferProgress', listener)
  },

  host: {
    list: (): Promise<SftpHostView[]> => ipcRenderer.invoke('sftp:host:list'),
    add: (input: SftpHostInput): Promise<SftpHost | SftpError> =>
      ipcRenderer.invoke('sftp:host:add', input),
    update: (args: { id: string; input: SftpHostInput }): Promise<SftpHost | SftpError> =>
      ipcRenderer.invoke('sftp:host:update', args),
    remove: (args: { id: string }): Promise<{ ok: true } | SftpError> =>
      ipcRenderer.invoke('sftp:host:remove', args),
    test: (args: { id: string }): Promise<{ ok: true } | SftpError> =>
      ipcRenderer.invoke('sftp:host:test', args)
  },

  probe: {
    list: (args: {
      connection: SftpProbeConnectionInput
      path: string
    }): Promise<SftpProbeListing | SftpError> => ipcRenderer.invoke('sftp:probe:list', args)
  }
}
