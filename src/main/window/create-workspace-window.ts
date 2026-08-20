import { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { createMainWindow, loadMainWindow } from './createMainWindow'
import {
  getWorkspaceWindow,
  registerWorkspaceWindow,
  unregisterWorkspaceWindow
} from './workspace-window-registry'

// Why: cascade off the invoking window so the new window doesn't cover it exactly.
const WORKSPACE_WINDOW_CASCADE_OFFSET = 32

/**
 * Open a standalone workspace window bootstrapped to `worktreeId`, or focus the
 * existing one — the registry enforces at most one window per worktree. The
 * renderer reads the `orca-worktree` query param to activate that worktree.
 */
export function createOrFocusWorkspaceWindow(
  store: Store | null,
  worktreeId: string,
  options: { getKeybindings?: () => KeybindingOverrides | undefined } = {}
): BrowserWindow {
  const existing = getWorkspaceWindow(worktreeId)
  if (existing) {
    if (existing.isMinimized()) {
      existing.restore()
    }
    existing.focus()
    return existing
  }

  const focusedBounds = BrowserWindow.getFocusedWindow()?.getBounds()
  const initialBounds = focusedBounds
    ? {
        x: focusedBounds.x + WORKSPACE_WINDOW_CASCADE_OFFSET,
        y: focusedBounds.y + WORKSPACE_WINDOW_CASCADE_OFFSET,
        width: focusedBounds.width,
        height: focusedBounds.height
      }
    : undefined

  // Why: deferLoad so the registry and 'closed' cleanup are wired before the renderer can boot.
  const window = createMainWindow(store, {
    role: 'workspace',
    deferLoad: true,
    ...(initialBounds ? { initialBounds } : {}),
    getKeybindings: options.getKeybindings
  })
  registerWorkspaceWindow(worktreeId, window)
  window.on('closed', () => unregisterWorkspaceWindow(worktreeId, window))
  loadMainWindow(window, { search: `orca-worktree=${encodeURIComponent(worktreeId)}` })
  return window
}
