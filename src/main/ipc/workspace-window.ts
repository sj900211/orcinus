import { ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingService } from '../keybindings/keybinding-service'
import { createOrFocusWorkspaceWindow } from '../window/create-workspace-window'
import { isTrustedUIRenderer } from './ui'

export function registerWorkspaceWindowHandlers(
  store: Store,
  keybindings?: KeybindingService
): void {
  ipcMain.removeHandler('workspaceWindow:open')

  ipcMain.handle('workspaceWindow:open', (event, worktreeId: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[workspace-window] open rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0) {
      // Why: a silent drop here is undiagnosable from the renderer console.
      console.warn('[workspace-window] open rejected: invalid worktreeId', worktreeId)
      return
    }
    createOrFocusWorkspaceWindow(store, worktreeId, {
      getKeybindings: () => keybindings?.getOverrides()
    })
  })
}
