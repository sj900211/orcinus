export type WindowBootContext = { role: 'main' } | { role: 'workspace'; worktreeId: string }

/** Parses the `orca-worktree` query param loadMainWindow appends for workspace windows. */
export function getWindowBootContext(search: string = window.location.search): WindowBootContext {
  const worktreeId = new URLSearchParams(search).get('orca-worktree')
  return worktreeId ? { role: 'workspace', worktreeId } : { role: 'main' }
}
