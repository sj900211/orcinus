// Wire types for satellite editor windows (Expedition 5). A satellite hosts
// editor tabs for ONE worktree, subordinate to the app window that opened it.

/** One open file inside a satellite, as reported by its renderer. */
export type SatelliteFileEntry = {
  fileId: string
  /** Why carried alongside fileId: parents must run the local/WSL path-alias
   *  check when intercepting opens — exact-fileId matching would miss
   *  `/mnt/c/…` vs `C:\…` aliases and duplicate the file across windows. */
  filePath: string
}

/** The file a satellite opens — at boot (query params) or via satellite:openFile push. */
export type SatelliteBootFile = {
  filePath: string
  relativePath: string
  language: string
}

/** Per-parent mirror entry broadcast on every registry change. */
export type SatelliteMirrorEntry = {
  satelliteId: string
  worktreeId: string
  /** false while hidden by a workspace switch (spec 5) — raise still works. */
  visible: boolean
  files: SatelliteFileEntry[]
}
