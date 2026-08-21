export type WindowBootContext =
  | { role: 'main' }
  | { role: 'workspace'; projectKey: string; worktreeId?: string }

/**
 * Parses the `orca-project` query param loadMainWindow appends for project windows
 * (a repoId or `folder:` workspace key), plus the optional `orca-worktree` initial
 * worktree inside that project.
 */
export function getWindowBootContext(search: string = window.location.search): WindowBootContext {
  const params = new URLSearchParams(search)
  const projectKey = params.get('orca-project')
  if (!projectKey) {
    return { role: 'main' }
  }
  const worktreeId = params.get('orca-worktree')
  return { role: 'workspace', projectKey, ...(worktreeId ? { worktreeId } : {}) }
}
