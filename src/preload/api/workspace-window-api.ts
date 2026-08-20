export type WorkspaceWindowApi = {
  /** Open a standalone workspace window bootstrapped to the worktree, or focus it if already open. */
  open: (worktreeId: string) => Promise<void>
}
