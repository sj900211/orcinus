import { randomUUID } from 'node:crypto'
import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingService } from '../keybindings/keybinding-service'
import { createOrFocusWorkspaceWindow } from '../window/create-workspace-window'
import { getWorkspaceWindow } from '../window/workspace-window-registry'
import { getRoutedMainWindow } from '../window/window-affinity-router'
import { isTrustedUIRenderer } from './ui'

// Why 2s: covers a busy renderer's stage round-trip without making Open feel hung; on expiry the
// window opens with the last persisted session (graceful degrade).
export const WORKSPACE_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS = 2_000

/**
 * Ask the main window renderer to checkpoint its live session NOW so the new
 * workspace window hydrates this run's tabs instead of the last shutdown's.
 * Always resolves — a missing/slow/failed renderer degrades to the stale session.
 */
function requestMainWindowSessionCheckpoint(): Promise<void> {
  const mainWebContents = getRoutedMainWindow()?.webContents
  if (!mainWebContents || mainWebContents.isDestroyed()) {
    console.warn(
      '[workspace-window] no main window to checkpoint the session; opening with persisted session'
    )
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const requestId = randomUUID()
    const settle = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('session:checkpointReply', onReply)
      resolve()
    }
    const timer = setTimeout(() => {
      console.warn('[workspace-window] session checkpoint timed out; opening with stale session')
      settle()
    }, WORKSPACE_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS)
    const onReply = (
      event: Electron.IpcMainEvent,
      reply: { requestId?: unknown; ok?: unknown }
    ): void => {
      // Why sender-checked: the requestId is renderer-visible, so only the window that was asked may settle the open.
      if (event.sender !== mainWebContents || reply?.requestId !== requestId) {
        return
      }
      if (reply.ok !== true) {
        console.warn('[workspace-window] session checkpoint failed; opening with stale session')
      }
      settle()
    }
    ipcMain.on('session:checkpointReply', onReply)
    mainWebContents.send('session:checkpointRequest', { requestId })
  })
}

export function registerWorkspaceWindowHandlers(
  store: Store,
  keybindings?: KeybindingService
): void {
  ipcMain.removeHandler('workspaceWindow:open')

  ipcMain.handle('workspaceWindow:open', async (event, worktreeId: unknown): Promise<void> => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[workspace-window] open rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0) {
      // Why: a silent drop here is undiagnosable from the renderer console.
      console.warn('[workspace-window] open rejected: invalid worktreeId', worktreeId)
      return
    }
    // Why skipped for an existing window: focus needs no rehydration, so a checkpoint would only delay it.
    if (!getWorkspaceWindow(worktreeId)) {
      await requestMainWindowSessionCheckpoint()
    }
    createOrFocusWorkspaceWindow(store, worktreeId, {
      getKeybindings: () => keybindings?.getOverrides()
    })
  })
}
