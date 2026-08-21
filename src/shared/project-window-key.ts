import { parseWorkspaceKey } from './workspace-scope'
import { getRepoIdFromWorktreeId } from './worktree/id'

/**
 * Project-window ownership key for a sidebar workspace key. A "project" is a git
 * repo (repoId) or a folder workspace (its own single-member project), and one
 * project is open in at most one app window.
 */
export function projectKeyForWorkspaceKey(workspaceKey: string): string {
  // Folder workspaces map to themselves; git worktree ids collapse to their repoId prefix.
  if (parseWorkspaceKey(workspaceKey)?.type === 'folder') {
    return workspaceKey
  }
  return getRepoIdFromWorktreeId(workspaceKey)
}
