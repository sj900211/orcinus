// Wire types for satellite editor windows (Expedition 5). A satellite hosts
// editor tabs for ONE worktree, subordinate to the app window that opened it.

/** One open file inside a satellite, as reported by its renderer. */
export type SatelliteFileEntry = {
  fileId: string
  /** Why carried alongside fileId: parents must run the local/WSL path-alias
   *  check when intercepting opens — exact-fileId matching would miss
   *  `/mnt/c/…` vs `C:\…` aliases and duplicate the file across windows. */
  filePath: string
  /** Why carried: interception activations and crashed-satellite salvage
   *  rebuild boot files from mirror entries alone. */
  relativePath: string
  language: string
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

/** A plain-object Monaco selection (structural twin of monaco ISelection —
 *  shared code must not import monaco types). */
export type SatelliteEditorSelection = {
  selectionStartLineNumber: number
  selectionStartColumn: number
  positionLineNumber: number
  positionColumn: number
}

/** True-move payload (dungeon 5, decision D7 draft-carry): a boot file plus the
 *  state closeFile destroys in the parent. All extras optional — a clean move
 *  carries none, and the satellite treats unknown view-mode strings as absent.
 *  dirtyDraftContent + lastKnownDiskSignature travel TOGETHER or not at all:
 *  the satellite only arms its disk-baseline verification gate when both exist
 *  (hydrate-editor-session contract — flag without signature kills autosave). */
export type SatelliteMovedFile = SatelliteBootFile & {
  dirtyDraftContent?: string
  lastKnownDiskSignature?: string
  cursorLine?: number
  scrollTop?: number
  selections?: SatelliteEditorSelection[]
  markdownViewMode?: string
}

/** Files returning from a satellite to its parent (Move Back / fold-back). */
export type SatelliteFilesMovedBack = {
  worktreeId: string
  files: SatelliteMovedFile[]
}

/** Window rectangle persisted with a satellite session. */
export type SatelliteWindowBounds = {
  x: number
  y: number
  width: number
  height: number
}

/** One satellite window persisted for restore-at-launch (spec revision 5-7):
 *  the renderer stages this continuously (debounced + a synchronous final
 *  stage in beforeunload), and main recreates the window at next launch via
 *  the existing open + moveFile-push-queue path (drafts ride the pushes). */
export type PersistedSatelliteWindowSession = {
  satelliteId: string
  worktreeId: string
  files: SatelliteMovedFile[]
  bounds?: SatelliteWindowBounds
}

/** Main-side cursor hit test result (dungeon 6 tab drag-out): which satellite
 *  of the REQUESTING parent window sits under the OS cursor. Main answers this
 *  itself via screen.getCursorScreenPoint() — cursor point and window bounds
 *  share the DIP coordinate space, so no renderer coordinate mapping (and no
 *  mixed-DPI math) is ever involved. */
export type SatelliteCursorHit = {
  satelliteId: string
  worktreeId: string
}
