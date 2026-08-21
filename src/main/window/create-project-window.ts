import { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingOverrides } from '../../shared/keybindings'
import { createMainWindow, loadMainWindow } from './createMainWindow'
import {
  getProjectWindow,
  registerProjectWindow,
  unregisterProjectWindowInstance
} from './project-window-registry'

// Why: cascade off the invoking window so the new window doesn't cover it exactly.
const PROJECT_WINDOW_CASCADE_OFFSET = 32

/**
 * Open a standalone project window bootstrapped to `projectKey` (a repoId or a
 * `folder:` workspace key), or focus the existing one — the registry enforces at
 * most one window per project. The renderer reads the `orca-project` query param
 * (plus the optional `orca-worktree` initial worktree) to activate the project.
 */
export function createOrFocusProjectWindow(
  store: Store | null,
  projectKey: string,
  options: { worktreeId?: string; getKeybindings?: () => KeybindingOverrides | undefined } = {}
): BrowserWindow {
  const existing = getProjectWindow(projectKey)
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
        x: focusedBounds.x + PROJECT_WINDOW_CASCADE_OFFSET,
        y: focusedBounds.y + PROJECT_WINDOW_CASCADE_OFFSET,
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
  registerProjectWindow(projectKey, window)
  // Why instance-scoped: an in-window project switch re-keys the registry entry, so 'closed' can't clean up by the boot projectKey.
  window.on('closed', () => unregisterProjectWindowInstance(window))
  const worktreeParam = options.worktreeId
    ? `&orca-worktree=${encodeURIComponent(options.worktreeId)}`
    : ''
  loadMainWindow(window, {
    search: `orca-project=${encodeURIComponent(projectKey)}${worktreeParam}`
  })
  return window
}
