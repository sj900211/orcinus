// Fork bridge (satellite editor windows): split from preload/index.ts for the max-lines rule.
import { ipcRenderer } from 'electron'

export const satelliteWindowApi = {
  // Satellite editor windows (Expedition 5): one worktree's editor tabs in a
  // subordinate window. open creates, moveFile pushes into a live satellite.
  open: (
    worktreeId: string,
    file: { filePath: string; relativePath: string; language: string }
  ): Promise<{ satelliteId: string } | null> =>
    ipcRenderer.invoke('satelliteWindow:open', worktreeId, file),
  moveFile: (
    satelliteId: string,
    file: {
      filePath: string
      relativePath: string
      language: string
      dirtyDraftContent?: string
      lastKnownDiskSignature?: string
      cursorLine?: number
      scrollTop?: number
      selections?: {
        selectionStartLineNumber: number
        selectionStartColumn: number
        positionLineNumber: number
        positionColumn: number
      }[]
      markdownViewMode?: string
    }
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('satelliteWindow:moveFile', satelliteId, file),
  raise: (satelliteId: string): Promise<void> =>
    ipcRenderer.invoke('satelliteWindow:raise', satelliteId),
  hitTestCursor: (): Promise<{ satelliteId: string; worktreeId: string } | null> =>
    ipcRenderer.invoke('satelliteWindow:hitTestCursor'),
  getMirror: (): Promise<
    {
      satelliteId: string
      worktreeId: string
      visible: boolean
      files: { fileId: string; filePath: string; relativePath: string; language: string }[]
    }[]
  > => ipcRenderer.invoke('satelliteWindow:getMirror'),
  activateFile: (
    satelliteId: string,
    file: { filePath: string; relativePath: string; language: string }
  ): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('satelliteWindow:activateFile', satelliteId, file),
  moveFileBack: (file: {
    filePath: string
    relativePath: string
    language: string
    dirtyDraftContent?: string
    lastKnownDiskSignature?: string
    cursorLine?: number
    scrollTop?: number
    selections?: {
      selectionStartLineNumber: number
      selectionStartColumn: number
      positionLineNumber: number
      positionColumn: number
    }[]
    markdownViewMode?: string
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('satelliteWindow:moveFileBack', file),
  onFilesMovedBack: (
    callback: (data: {
      worktreeId: string
      files: {
        filePath: string
        relativePath: string
        language: string
        dirtyDraftContent?: string
        lastKnownDiskSignature?: string
        cursorLine?: number
        scrollTop?: number
        selections?: {
          selectionStartLineNumber: number
          selectionStartColumn: number
          positionLineNumber: number
          positionColumn: number
        }[]
        markdownViewMode?: string
      }[]
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      data: Parameters<typeof callback>[0]
    ): void => callback(data)
    ipcRenderer.on('satellite:filesMovedBack', listener)
    return () => ipcRenderer.removeListener('satellite:filesMovedBack', listener)
  },
  notifyReady: (): Promise<void> => ipcRenderer.invoke('satelliteWindow:ready'),
  /** Satellite renderer only: boot failed terminally (missing repo etc.) —
   *  main drops the persisted restore entry so it cannot zombie. */
  notifyBootFailed: (): void => ipcRenderer.send('satelliteWindow:bootFailed'),
  reportOpenFiles: (
    files: { fileId: string; filePath: string; relativePath: string; language: string }[],
    openSurfaceCount: number,
    dirtyOpenFileCount: number
  ): void =>
    ipcRenderer.send(
      'satelliteWindow:reportOpenFiles',
      files,
      openSurfaceCount,
      dirtyOpenFileCount
    ),
  onCloseRequested: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on('satelliteWindow:closeRequested', listener)
    return () => {
      ipcRenderer.removeListener('satelliteWindow:closeRequested', listener)
    }
  },
  stageSession: (
    files: {
      filePath: string
      relativePath: string
      language: string
      dirtyDraftContent?: string
      lastKnownDiskSignature?: string
      cursorLine?: number
      scrollTop?: number
      selections?: {
        selectionStartLineNumber: number
        selectionStartColumn: number
        positionLineNumber: number
        positionColumn: number
      }[]
      markdownViewMode?: string
    }[]
  ): void => ipcRenderer.send('satelliteWindow:stageSession', files),
  /** Synchronous final stage from beforeunload — close/reload/quit must not
   *  lose keystrokes newer than the debounced stage. */
  stageSessionSync: (
    files: {
      filePath: string
      relativePath: string
      language: string
      dirtyDraftContent?: string
      lastKnownDiskSignature?: string
      cursorLine?: number
      scrollTop?: number
      selections?: {
        selectionStartLineNumber: number
        selectionStartColumn: number
        positionLineNumber: number
        positionColumn: number
      }[]
      markdownViewMode?: string
    }[]
  ): void => {
    ipcRenderer.sendSync('satelliteWindow:stageSessionSync', files)
  },
  notifyActiveWorktreeChanged: (worktreeId: string): void =>
    ipcRenderer.send('satelliteWindow:activeWorktreeChanged', worktreeId),
  onMirrorChanged: (
    callback: (
      entries: {
        satelliteId: string
        worktreeId: string
        visible: boolean
        files: { fileId: string; filePath: string; relativePath: string; language: string }[]
      }[]
    ) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      entries: Parameters<typeof callback>[0]
    ): void => callback(entries)
    ipcRenderer.on('satelliteWindow:mirrorChanged', listener)
    return () => ipcRenderer.removeListener('satelliteWindow:mirrorChanged', listener)
  },
  onOpenFile: (
    callback: (file: {
      filePath: string
      relativePath: string
      language: string
      dirtyDraftContent?: string
      lastKnownDiskSignature?: string
      cursorLine?: number
      scrollTop?: number
      selections?: {
        selectionStartLineNumber: number
        selectionStartColumn: number
        positionLineNumber: number
        positionColumn: number
      }[]
      markdownViewMode?: string
    }) => void
  ): (() => void) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      file: Parameters<typeof callback>[0]
    ): void => callback(file)
    ipcRenderer.on('satellite:openFile', listener)
    return () => ipcRenderer.removeListener('satellite:openFile', listener)
  }
}
