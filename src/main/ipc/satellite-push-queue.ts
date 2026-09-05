// Satellite boot queue + push delivery (split from satellite-window.ts for
// the max-lines rule). moveFile pushes can race the satellite's
// mini-hydration; files sent before the renderer's satelliteWindow:ready are
// flushed on it, and a renderer reload un-readies its satellite so post-reload
// pushes queue again instead of vanishing into a loading page.
import type { SatelliteMovedFile } from '../../shared/satellite-window-payloads'
import { getSatellite, type SatelliteRecord } from '../window/satellite-window-registry'
import { areLocalWindowsWslPathAliases } from '../../shared/cross-platform-path'

const pendingOpenFilesBySatelliteId = new Map<string, SatelliteMovedFile[]>()
const readySatelliteIds = new Set<string>()
// Satellites that reached ready at least once: a main-frame navigation seen
// BEFORE the first ready is part of the boot, not a user reload.
const everReadySatelliteIds = new Set<string>()

export function wasSatelliteEverReady(satelliteId: string): boolean {
  return everReadySatelliteIds.has(satelliteId)
}

export function isSatelliteReady(satelliteId: string): boolean {
  return readySatelliteIds.has(satelliteId)
}

export function unreadySatellite(satelliteId: string): void {
  readySatelliteIds.delete(satelliteId)
}

/** Drain (and clear) this satellite's undelivered queued pushes — the closed-
 *  window salvage folds them into the session instead of dropping drafts. */
export function takePendingOpenFiles(satelliteId: string): SatelliteMovedFile[] {
  const queue = pendingOpenFilesBySatelliteId.get(satelliteId) ?? []
  pendingOpenFilesBySatelliteId.delete(satelliteId)
  return queue
}

/** Post-review C8: main must ignore renderer stage snapshots while queued
 *  pushes are still undelivered — the fresh renderer would persist a clean
 *  boot-only list over the seeded restore entry. */
export function hasPendingOpenFiles(satelliteId: string): boolean {
  return (pendingOpenFilesBySatelliteId.get(satelliteId)?.length ?? 0) > 0
}

export function clearSatellitePushState(satelliteId: string): void {
  pendingOpenFilesBySatelliteId.delete(satelliteId)
  readySatelliteIds.delete(satelliteId)
  everReadySatelliteIds.delete(satelliteId)
}

export function clearAllSatellitePushState(): void {
  pendingOpenFilesBySatelliteId.clear()
  readySatelliteIds.clear()
  everReadySatelliteIds.clear()
}

export function pushOpenFile(satelliteId: string, file: SatelliteMovedFile): void {
  const record = getSatellite(satelliteId)
  if (!record) {
    return
  }
  if (!readySatelliteIds.has(satelliteId)) {
    const queue = pendingOpenFilesBySatelliteId.get(satelliteId) ?? []
    queue.push(file)
    pendingOpenFilesBySatelliteId.set(satelliteId, queue)
    return
  }
  try {
    record.window.webContents.send('satellite:openFile', file)
  } catch {
    // Why: a frame disposed mid-send must not fail the caller's move.
  }
}

/** Boot finished: flush this satellite's queued pushes in arrival order. */
export function markSatelliteReadyAndFlush(satelliteId: string): void {
  readySatelliteIds.add(satelliteId)
  everReadySatelliteIds.add(satelliteId)
  const queue = pendingOpenFilesBySatelliteId.get(satelliteId)
  pendingOpenFilesBySatelliteId.delete(satelliteId)
  for (const file of queue ?? []) {
    pushOpenFile(satelliteId, file)
  }
}

/** Renderer-gone probe for the push-accepting handlers (review C6): a crashed
 *  webContents silently drops send — an ACK would strand the file nowhere. */
export function isSatelliteRendererGone(record: SatelliteRecord): boolean {
  return (
    record.window.isDestroyed() ||
    record.window.webContents.isDestroyed() ||
    record.window.webContents.isCrashed()
  )
}

/** Review C5: a dirty payload for a file the satellite ALREADY lists is
 *  refused — an ACK would close the parent tab while the satellite's
 *  own-dirty branch can discard the carried draft (main cannot see per-file
 *  dirtiness, so refuse conservatively; the parent restores its dirty flag
 *  and toasts). A clean payload deduplicates safely — the push just
 *  activates the existing tab. */
export function wouldClobberSatelliteResidentDirtyFile(
  record: SatelliteRecord,
  file: SatelliteMovedFile
): boolean {
  return (
    file.dirtyDraftContent !== undefined &&
    record.files.some(
      (entry) =>
        entry.filePath === file.filePath ||
        areLocalWindowsWslPathAliases(entry.filePath, file.filePath)
    )
  )
}
