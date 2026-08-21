import type { ProjectWindowSessionHandback } from '../../../shared/project-window-session-handback'
import { getWindowBootContext } from '../startup/window-boot-context'
import { useAppStore } from '../store'

// Bounds the scoped reattach so a wedged handback can't leak an abort controller across closes.
const HANDBACK_RECONNECT_TIMEOUT_MS = 30_000

/**
 * Main-window listener for a closing project window's session slice. Merges the slice
 * scoped to the project's worktree keys (never replacing other projects), then reconnects
 * those worktrees so main reattaches to the daemon/remote PTYs the closing window left
 * live — the reason the slice carries their session ids. Only the main window applies it:
 * it is the single persistence writer, so the merge it makes is what gets persisted.
 */
export function registerProjectWindowSessionHandbackReceiver(): () => void {
  if (getWindowBootContext().role !== 'main') {
    return () => {}
  }
  const subscribe = window.api.session.onProjectSessionHandback
  if (typeof subscribe !== 'function') {
    return () => {}
  }
  return subscribe((handback: ProjectWindowSessionHandback) => {
    void applyProjectWindowSessionHandback(handback)
  })
}

async function applyProjectWindowSessionHandback(
  handback: ProjectWindowSessionHandback
): Promise<void> {
  const { session, workspaceKeys } = handback
  if (workspaceKeys.length === 0) {
    return
  }
  const store = useAppStore.getState()
  // Scoped merge: same replaceWorkspaceKeys path the direct-SSH snapshot apply uses, so only
  // this project's worktree slices are replaced and every other window's tabs are preserved.
  store.hydrateWorkspaceSession(session, { replaceWorkspaceKeys: workspaceKeys })
  store.hydrateTabsSession(session, { replaceWorkspaceKeys: workspaceKeys })
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), HANDBACK_RECONNECT_TIMEOUT_MS)
  try {
    await store.reconnectPersistedTerminals(abort.signal, { workspaceKeys })
  } catch (error) {
    console.warn('[app] Project window session handback reconnect failed:', error)
  } finally {
    clearTimeout(timer)
  }
}
