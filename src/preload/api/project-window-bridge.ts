// Fork bridge (New Window): split from preload/index.ts for the max-lines rule.
import { ipcRenderer } from 'electron'

export const projectWindowApi = {
  // Open a standalone window owning the project (repoId / `folder:` key), or focus it if already open.
  open: (projectKey: string, worktreeId?: string): Promise<void> =>
    ipcRenderer.invoke('projectWindow:open', projectKey, worktreeId),
  // Raise-only: the owner window already shows this project's rows, so no worktree is forwarded.
  raise: (projectKey: string): Promise<void> =>
    ipcRenderer.invoke('projectWindow:raise', projectKey),
  notifyActiveProjectChanged: (projectKey: string): void =>
    ipcRenderer.send('projectWindow:activeProjectChanged', projectKey),
  onOpenProjectsChanged: (callback: (projectKeys: string[]) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, projectKeys: string[]): void =>
      callback(projectKeys)
    ipcRenderer.on('projectWindow:openProjectsChanged', listener)
    return () => ipcRenderer.removeListener('projectWindow:openProjectsChanged', listener)
  }
}
