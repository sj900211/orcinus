export type ProjectWindowApi = {
  /** Open a standalone window owning the project (repoId or `folder:` key), or focus it if
   *  already open. `worktreeId` optionally picks the initial worktree inside the project. */
  open: (projectKey: string, worktreeId?: string) => Promise<void>
  /** Reveal + focus the window owning the project (activation raise-instead-of-switch).
   *  Raise-only: the owner window already shows this project's rows, so no worktree is forwarded. */
  raise: (projectKey: string) => Promise<void>
  /** Project windows report in-window project switches so main re-keys the registry. */
  notifyActiveProjectChanged: (projectKey: string) => void
  /** Per-recipient registry snapshot: project keys open in OTHER windows than this one. */
  onOpenProjectsChanged: (callback: (projectKeys: string[]) => void) => () => void
}
