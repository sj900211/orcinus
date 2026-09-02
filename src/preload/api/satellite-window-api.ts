import type {
  SatelliteBootFile,
  SatelliteCursorHit,
  SatelliteFileEntry,
  SatelliteFilesMovedBack,
  SatelliteMirrorEntry,
  SatelliteMovedFile
} from '../../shared/satellite-window-payloads'

export type SatelliteWindowApi = {
  /** Open a NEW satellite editor window for one file of a worktree (Expedition 5). */
  open: (worktreeId: string, file: SatelliteBootFile) => Promise<{ satelliteId: string } | null>
  /** Push a file into a satellite (queued until boot). ok=false means main
   *  dropped it (stale/destroyed satellite) — a TRUE move must then keep the
   *  parent tab (owner decision D14). */
  moveFile: (satelliteId: string, file: SatelliteMovedFile) => Promise<{ ok: boolean }>
  /** Reveal + focus a satellite (open-interception raise; overrides subordination-hide). */
  raise: (satelliteId: string) => Promise<void>
  /** App windows: which of THIS window's satellites sits under the OS cursor
   *  (dungeon 6 tab drag-out). Main hit-tests in DIP space — null = none. */
  hitTestCursor: () => Promise<SatelliteCursorHit | null>
  /** App windows: snapshot of THIS window's mirror (late-subscriber hydration). */
  getMirror: () => Promise<SatelliteMirrorEntry[]>
  /** App windows: raise a satellite AND activate one of its files (spec 2).
   *  Main re-checks membership against the live registry — ok=false means the
   *  mirror was stale and nothing happened. */
  activateFile: (satelliteId: string, file: SatelliteBootFile) => Promise<{ ok: boolean }>
  /** Satellite renderer only: return one file to the parent (D6 Move Back). */
  moveFileBack: (file: SatelliteMovedFile) => Promise<{ ok: boolean }>
  /** App windows: files returning from a satellite (Move Back / fold-back). */
  onFilesMovedBack: (callback: (data: SatelliteFilesMovedBack) => void) => () => void
  /** Satellite renderer only: boot finished — main flushes queued moveFile pushes. */
  notifyReady: () => Promise<void>
  /** Satellite renderer only: terminal boot failure — drop the restore entry. */
  notifyBootFailed: () => void
  /** Satellite renderer only: report the current open-file set after every change. */
  reportOpenFiles: (
    files: SatelliteFileEntry[],
    openSurfaceCount: number,
    dirtyOpenFileCount: number
  ) => void
  /** Satellite renderer only: main refused the close (dirty files, 5-7). */
  onCloseRequested: (callback: () => void) => () => void
  /** Satellite renderer only: debounced continuous session stage (restore-at-launch). */
  stageSession: (files: SatelliteMovedFile[]) => void
  /** Satellite renderer only: synchronous final stage from beforeunload. */
  stageSessionSync: (files: SatelliteMovedFile[]) => void
  /** App windows: report the active worktree so subordinate satellites hide/show. */
  notifyActiveWorktreeChanged: (worktreeId: string) => void
  /** App windows: per-recipient mirror of THIS window's satellites. */
  onMirrorChanged: (callback: (entries: SatelliteMirrorEntry[]) => void) => () => void
  /** Satellite renderer only: a file pushed into this satellite. */
  onOpenFile: (callback: (file: SatelliteMovedFile) => void) => () => void
}
