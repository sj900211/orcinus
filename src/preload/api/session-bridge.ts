import { ipcRenderer } from 'electron'
import type { PreloadApi } from '../api-types'

export const sessionApi = {
  // hostId is optional; main defaults it to 'local' so existing omitting call sites keep the local session partition.
  get: (hostId) => ipcRenderer.invoke('session:get', hostId),
  set: (args, hostId) => ipcRenderer.invoke('session:set', args, hostId),
  patch: (args, hostId) => ipcRenderer.invoke('session:patch', args, hostId),
  flush: () => ipcRenderer.invoke('session:flush'),
  readTerminalScrollback: (args) =>
    ipcRenderer.sendSync('session:read-terminal-scrollback-sync', args),
  /** Synchronous session save for beforeunload — blocks until flushed to disk. */
  setSync: (args, hostId) => {
    ipcRenderer.sendSync('session:set-sync', args, hostId)
  },
  onCheckpointRequest: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, args: { requestId: string }): void =>
      callback(args)
    ipcRenderer.on('session:checkpointRequest', listener)
    return () => ipcRenderer.removeListener('session:checkpointRequest', listener)
  },
  sendCheckpointReply: (args) => {
    ipcRenderer.send('session:checkpointReply', args)
  },
  /** Synchronous so it lands during the closing window's beforeunload before teardown. */
  handbackProjectSessionSync: (args) => {
    ipcRenderer.sendSync('session:handbackProjectSession', args)
  },
  onProjectSessionHandback: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      args: Parameters<typeof callback>[0]
    ): void => callback(args)
    ipcRenderer.on('session:projectSessionHandback', listener)
    return () => ipcRenderer.removeListener('session:projectSessionHandback', listener)
  }
} satisfies PreloadApi['session']
