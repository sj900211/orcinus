import { useEffect } from 'react'
import { useAppStore } from '../store'
import type { AppState } from '../store/types'
import { activateAndRevealWorkspace } from '../lib/worktree-activation'
import { projectKeyForWorkspaceKey } from '../../../shared/project-window-key'

/**
 * Pick where a window should land after another window takes over its active
 * workspace's PROJECT: the most recent live nav-history entry that is a workspace
 * key of a project not open in another window. Null means "no candidate" → landing view.
 */
export function findTakeoverNavTarget(
  state: Pick<
    AppState,
    | 'worktreeNavHistory'
    | 'worktreeNavHistoryIndex'
    | 'projectKeysInOtherWindows'
    | 'activeWorktreeId'
    | 'getKnownWorktreeById'
  >
): string | null {
  const lastIndex = Math.min(state.worktreeNavHistoryIndex, state.worktreeNavHistory.length - 1)
  for (let i = lastIndex; i >= 0; i--) {
    const entry = state.worktreeNavHistory[i]
    // Why strings only: view sentinels/task-detail entries are not workspace surfaces to land on.
    if (typeof entry !== 'string' || entry === 'tasks' || entry === 'automations') {
      continue
    }
    if (
      entry === state.activeWorktreeId ||
      state.projectKeysInOtherWindows.has(projectKeyForWorkspaceKey(entry))
    ) {
      continue
    }
    // Why: getKnownWorktreeById resolves both git worktrees and `folder:` keys, so dead entries are skipped.
    if (state.getKnownWorktreeById(entry)) {
      return entry
    }
  }
  return null
}

function navigateAwayFromTakenOverWorkspace(state: AppState): void {
  const target = findTakeoverNavTarget(state)
  if (target) {
    // Why bypass: the target's project was just vetted as un-windowed; re-running the raise guard
    // on a snapshot that changed mid-navigation could bounce focus back and loop.
    activateAndRevealWorkspace(target, { bypassOtherWindowGuard: true })
    return
  }
  // No live un-windowed history — clear to the landing view (activeView 'terminal' + no active worktree).
  state.setActiveWorktree(null)
}

/** Non-React seam so the takeover reaction is testable against the real store. */
export function installWorktreeTakeoverNavigation(): () => void {
  let navigating = false
  return useAppStore.subscribe((state, prevState) => {
    if (state.projectKeysInOtherWindows === prevState.projectKeysInOtherWindows) {
      return
    }
    const activeWorktreeId = state.activeWorktreeId
    if (
      !activeWorktreeId ||
      !state.projectKeysInOtherWindows.has(projectKeyForWorkspaceKey(activeWorktreeId))
    ) {
      return
    }
    // Why: the nav-away mutates the store, re-entering this listener; the flag stops recursion.
    if (navigating) {
      return
    }
    navigating = true
    try {
      navigateAwayFromTakenOverWorkspace(state)
    } finally {
      navigating = false
    }
  })
}

/**
 * Role-agnostic takeover watcher: when the ACTIVE workspace's project appears in this
 * window's "open in other windows" snapshot, another window now owns that project —
 * navigate away instead of showing a surface whose streams route elsewhere. Runs in
 * every window (spec: the main window on Open-in-New-Window; a project window can only
 * be taken over through defensive main-side paths, but the reaction is identical).
 */
export function useWorktreeTakeoverNavigation(): void {
  useEffect(() => installWorktreeTakeoverNavigation(), [])
}
