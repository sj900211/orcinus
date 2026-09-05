import { useAppStore } from '@/store'
import { projectKeyForWorkspaceKey } from '../../../shared/project-window-key'

/**
 * Raise-instead-of-switch: a workspace whose PROJECT is owned by another app window
 * must focus that window, not re-activate here. Returns true when the raise was
 * dispatched (caller returns `false` without side effects). `bypass` is for internal
 * flows that must not bounce — see ActivateOtherWindowGuardOpts.
 *
 * Why raise the window only (no worktree forwarding): the owning window already shows
 * that project's rows, so cross-window worktree-activation forwarding is dead weight —
 * dropping it removes the fragile forwarding bug class.
 */
export function raiseOtherWindowForWorkspaceKey(workspaceKey: string, bypass?: boolean): boolean {
  if (bypass) {
    return false
  }
  const projectKey = projectKeyForWorkspaceKey(workspaceKey)
  if (!useAppStore.getState().projectKeysInOtherWindows.has(projectKey)) {
    return false
  }
  void window.api.projectWindow?.raise?.(projectKey)
  return true
}

export type ActivateOtherWindowGuardOpts = {
  /** Skip the raise-instead-of-switch guard. Use sparingly: takeover nav-away (the target was
   *  just vetted as un-windowed, and bouncing there could loop) and history replay that must
   *  not re-raise. Every other caller should let the guard run. */
  bypassOtherWindowGuard?: boolean
}
