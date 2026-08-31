import type {
  SatelliteBootFile,
  SatelliteFileEntry,
  SatelliteMirrorEntry
} from '../../shared/satellite-window-payloads'

export type SatelliteWindowApi = {
  /** Open a NEW satellite editor window for one file of a worktree (Expedition 5). */
  open: (worktreeId: string, file: SatelliteBootFile) => Promise<{ satelliteId: string } | null>
  /** Push another file into an existing satellite (queued until its boot finishes). */
  moveFile: (satelliteId: string, file: SatelliteBootFile) => Promise<void>
  /** Reveal + focus a satellite (open-interception raise; overrides subordination-hide). */
  raise: (satelliteId: string) => Promise<void>
  /** Satellite renderer only: boot finished — main flushes queued moveFile pushes. */
  notifyReady: () => Promise<void>
  /** Satellite renderer only: report the current open-file set after every change. */
  reportOpenFiles: (
    files: SatelliteFileEntry[],
    openSurfaceCount: number,
    dirtyOpenFileCount: number
  ) => void
  onCloseRequested: (callback: () => void) => () => void
  confirmClose: () => void
  /** App windows: report the active worktree so subordinate satellites hide/show. */
  notifyActiveWorktreeChanged: (worktreeId: string) => void
  /** App windows: per-recipient mirror of THIS window's satellites. */
  onMirrorChanged: (callback: (entries: SatelliteMirrorEntry[]) => void) => () => void
  /** Satellite renderer only: a file pushed into this satellite. */
  onOpenFile: (callback: (file: SatelliteBootFile) => void) => () => void
}
