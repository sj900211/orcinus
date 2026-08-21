import type { WorkspaceSessionState } from './workspace-session-state-types'

/**
 * Reverse of the open-time checkpoint: when a project (role 'workspace') window is
 * closing, it hands its project's live tab/terminal slice to the main window — the
 * single session writer — which MERGES it (scoped to `workspaceKeys`) and persists.
 * Carries the daemon/remote session ids so main's subsequent reattach finds the live
 * sessions instead of failing with 'No conversation found with session ID'.
 */
export type ProjectWindowSessionHandback = {
  /** The project the closing window owned (a repoId or a `folder:` workspace key). */
  projectKey: string
  /** The exact worktree/workspace keys to replace on merge, so other projects' tabs survive. */
  workspaceKeys: string[]
  /** The closing window's full serialized session; only `workspaceKeys` slices are merged. */
  session: WorkspaceSessionState
}
