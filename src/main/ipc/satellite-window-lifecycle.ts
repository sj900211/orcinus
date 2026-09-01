import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import type { SatelliteMovedFile } from '../../shared/satellite-window-payloads'
import { isAppQuitting } from '../app-quit-state'
import {
  clearSatellitePushState,
  isSatelliteReady,
  pushOpenFile,
  unreadySatellite,
  wasSatelliteEverReady
} from './satellite-push-queue'

// Per-satellite window lifecycle (split from satellite-window.ts for the
// max-lines rule): the dirty-block close intercept, restore-entry bookkeeping,
// and the queued-push snapshot seeding.

// Last dirty-file count each satellite reported; gates the dirty-block close
// intercept (spec revision 5-7). Written UNCONDITIONALLY per report — the
// registry equality-skip would eat pure dirty flips.
const dirtyOpenFileCountBySatelliteId = new Map<string, number>()
// Satellites whose close was ALLOWED as a clean user close of a READY window —
// the one death that removes the persisted restore entry.
const cleanUserCloseSatelliteIds = new Set<string>()
// Cascade closes bypass the dirty-block (parent already gone) while still
// running beforeunload's final sync stage (post-review C3) — one-shot marks.
const closeBypassSatelliteIds = new Set<string>()

export function markSatelliteCloseBypass(satelliteId: string): void {
  closeBypassSatelliteIds.add(satelliteId)
}

export function setSatelliteDirtyOpenFileCount(satelliteId: string, reported: unknown): void {
  dirtyOpenFileCountBySatelliteId.set(
    satelliteId,
    typeof reported === 'number' && Number.isInteger(reported) && reported >= 0 ? reported : 0
  )
}

/** Handler re-registration (tests) must not inherit stale lifecycle state. */
export function clearAllSatelliteLifecycleState(): void {
  dirtyOpenFileCountBySatelliteId.clear()
  cleanUserCloseSatelliteIds.clear()
  closeBypassSatelliteIds.clear()
}

/** Queued-push snapshot seeding: a draft accepted for a still-booting
 *  satellite exists nowhere else — persist it so a crash-mid-boot restores it. */
export function upsertPersistedSatelliteFile(
  store: Store | undefined,
  satelliteId: string,
  worktreeId: string,
  file: SatelliteMovedFile
): void {
  if (!store) {
    return
  }
  const existing = store
    .getSatelliteWindowSessions()
    .find((candidate) => candidate.satelliteId === satelliteId)
  const files = [
    ...(existing?.files ?? []).filter((candidate) => candidate.filePath !== file.filePath),
    file
  ]
  store.setSatelliteWindowSession({
    satelliteId,
    worktreeId,
    files,
    ...(existing?.bounds ? { bounds: existing.bounds } : {})
  })
}

/** Per-satellite lifecycle wiring shared by the open IPC and restore-at-launch
 *  (a restored window must get the same reload/close/closed handling). */
export function wireSatelliteWindowLifecycle(
  window: BrowserWindow,
  satelliteId: string,
  store?: Store
): void {
  // A main-frame renderer navigation (View→Reload, crash recovery) invalidates
  // ready — pushes must queue again.
  window.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame): void => {
    if (!isMainFrame) {
      return
    }
    unreadySatellite(satelliteId)
    // Owner-found first-reload bug: the boot navigation can fire BEFORE this
    // listener attaches (loadURL runs inside createSatelliteWindow), so
    // counting navigations misclassifies the first user reload as boot.
    // Deterministic gate instead: only a satellite that has been READY at
    // least once can be user-reloaded.
    if (!wasSatelliteEverReady(satelliteId)) {
      return
    }
    // Reload self-restore (post-review C5/C10): the fresh renderer boots with
    // ONLY the URL boot file; re-push the persisted entry so tabs and dirty
    // drafts survive View→Reload — the pushes queue while unready and flush on
    // the reloaded renderer's ready, exactly like restore-at-launch.
    const persisted = store
      ?.getSatelliteWindowSessions()
      .find((candidate) => candidate.satelliteId === satelliteId)
    for (const file of persisted?.files ?? []) {
      pushOpenFile(satelliteId, file)
    }
  })
  // Dirty-block intercept (spec revision 5-7): a READY satellite holding
  // unsaved files cannot be closed — nothing moves, nothing is discarded.
  // Guard order matters: crashed/destroyed and unready renderers pass through
  // (they can never answer a notice), and quit closes freely (the staged
  // snapshot already captured everything; beforeunload adds a final sync stage).
  window.on('close', (closeEvent) => {
    if (window.webContents.isDestroyed() || window.webContents.isCrashed()) {
      return
    }
    if (closeBypassSatelliteIds.delete(satelliteId)) {
      // Cascade close: allowed regardless of dirtiness (the parent is gone);
      // no clean mark — the entry survives for restore-at-launch.
      return
    }
    if (!isSatelliteReady(satelliteId)) {
      return
    }
    if (isAppQuitting()) {
      return
    }
    if ((dirtyOpenFileCountBySatelliteId.get(satelliteId) ?? 0) > 0) {
      closeEvent.preventDefault()
      window.webContents.send('satelliteWindow:closeRequested')
      return
    }
    cleanUserCloseSatelliteIds.add(satelliteId)
  })
  // prependListener: runs before the registry's own 'closed' unregister hook.
  window.prependListener('closed', () => {
    if (cleanUserCloseSatelliteIds.delete(satelliteId)) {
      // Clean user close = the tabs were deliberately discarded; every other
      // death (quit, cascade destroy, crash, mid-boot kill) keeps the entry
      // so the satellite restores at next launch.
      store?.removeSatelliteWindowSession(satelliteId)
    }
    dirtyOpenFileCountBySatelliteId.delete(satelliteId)
    closeBypassSatelliteIds.delete(satelliteId)
    clearSatellitePushState(satelliteId)
  })
}
