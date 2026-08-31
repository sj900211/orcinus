export type EditorChildWindowApi = {
  /** Open (or retarget) the standalone editor child window for one file (Expedition 5 spike). */
  open: (args: {
    filePath: string
    relativePath: string
    worktreeId: string
    language: string
  }) => Promise<void>
}
