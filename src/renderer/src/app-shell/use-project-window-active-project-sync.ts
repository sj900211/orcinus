import { useEffect } from 'react'
import { useAppStore } from '../store'
import { projectKeyForWorkspaceKey } from '../../../shared/project-window-key'

/**
 * Every window — the main window and each project window — reports the project it
 * currently displays to main, which registers/re-keys that window in the
 * project-window registry. Ownership drives owner routing (PTY streams,
 * notifications) and the per-window "open in other windows" snapshots: the
 * project a window shows is hidden (header-only marker) in every OTHER window.
 * Intra-project worktree switches report nothing. One store subscription covers
 * every activation path (sidebar, palette, history, deep links).
 *
 * Null/landing is deliberately NOT reported: the window keeps its last
 * registration (it still owns that project's sessions); closing it unregisters.
 */
export function installProjectWindowActiveProjectSync(): () => void {
  let lastReportedProjectKey: string | null = null
  const report = (workspaceKey: string | null): void => {
    if (!workspaceKey) {
      return
    }
    const projectKey = projectKeyForWorkspaceKey(workspaceKey)
    if (projectKey === lastReportedProjectKey) {
      return
    }
    lastReportedProjectKey = projectKey
    window.api.projectWindow?.notifyActiveProjectChanged?.(projectKey)
  }
  // Why immediate: boot activation can precede this install; the (idempotent) report also
  // triggers main's snapshot reply, hydrating this renderer's other-windows set.
  report(useAppStore.getState().activeWorktreeId)
  return useAppStore.subscribe((state, prevState) => {
    if (state.activeWorktreeId !== prevState.activeWorktreeId) {
      report(state.activeWorktreeId)
    }
  })
}

export function useProjectWindowActiveProjectSync(): void {
  // Why no role gate: the main window equally owns the project it displays, so it must
  // register/re-key like a project window — that ownership caps windows at project count.
  useEffect(() => installProjectWindowActiveProjectSync(), [])
}
