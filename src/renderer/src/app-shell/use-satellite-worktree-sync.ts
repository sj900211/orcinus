import { useEffect } from 'react'
import { useAppStore } from '../store'

/**
 * Sibling of the project-window active-project reporter, at WORKTREE
 * granularity: satellites are subordinate to the workspace they were opened
 * from (spec 5), and the project-level reporter deliberately swallows
 * intra-project worktree switches. Null/landing is not reported — satellites
 * keep their last hide/show state (same rationale as the project reporter).
 */
export function useSatelliteWorktreeSync(): void {
  useEffect(() => {
    let lastReported: string | null = null
    const report = (workspaceKey: string | null): void => {
      if (!workspaceKey || workspaceKey === lastReported) {
        return
      }
      lastReported = workspaceKey
      window.api.satelliteWindow?.notifyActiveWorktreeChanged?.(workspaceKey)
    }
    report(useAppStore.getState().activeWorktreeId)
    return useAppStore.subscribe((state, prevState) => {
      if (state.activeWorktreeId !== prevState.activeWorktreeId) {
        report(state.activeWorktreeId)
      }
    })
  }, [])
}
