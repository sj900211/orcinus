import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type {
  SatelliteCursorHit,
  SatelliteMirrorEntry,
  SatelliteMovedFile
} from '../../shared/satellite-window-payloads'
import { areLocalWindowsWslPathAliases } from '../../shared/cross-platform-path'
import { createSatelliteWindow } from '../window/create-satellite-window'
import { activateWindow } from '../window/focus-existing-window'
import { hitTestSatelliteAtCursor } from '../window/satellite-window-hit-test'
import {
  applyParentActiveWorktree,
  getParentLastActiveWorktree,
  getSatellite,
  getSatelliteByWebContents,
  markSatelliteRaised,
  onParentRendererNavigation,
  onSatelliteRegistryChanged,
  setSatelliteFiles
} from '../window/satellite-window-registry'
import { isTrustedUIRenderer } from './ui'
import { isBootFile, isFileEntryList, isMovedFile } from './satellite-window-payload-validation'
import {
  hasPendingOpenFiles,
  clearAllSatellitePushState,
  isSatelliteRendererGone,
  markSatelliteReadyAndFlush,
  pushOpenFile,
  wouldClobberSatelliteResidentDirtyFile
} from './satellite-push-queue'
import { broadcastMirror, buildMirrorEntriesFor } from './satellite-window-mirror'
import {
  acknowledgeSeededSatelliteFiles,
  clearAllSatelliteLifecycleState,
  mergeUnackedSeededSatelliteFiles,
  setSatelliteDirtyOpenFileCount,
  upsertPersistedSatelliteFile,
  wireSatelliteWindowLifecycle
} from './satellite-window-lifecycle'
import {
  clearAllParentMirrorReadiness,
  clearParentMirrorReady,
  isParentMirrorReady,
  markParentMirrorReady
} from './satellite-parent-readiness'

// IPC for satellite editor windows (Expedition 5, dungeon 3). Mirrors the
// project-window handler structure: one module-level registry subscription,
// trusted-sender gates on every channel, per-recipient mirror payloads.

// Why module-level: handlers may re-register (tests); keep exactly one registry subscription.
let unsubscribeRegistryBroadcast: (() => void) | null = null
let unsubscribeParentNavigation: (() => void) | null = null

export function registerSatelliteWindowHandlers(store?: Store): void {
  ipcMain.removeHandler('satelliteWindow:open')
  ipcMain.removeHandler('satelliteWindow:moveFile')
  ipcMain.removeHandler('satelliteWindow:raise')
  ipcMain.removeHandler('satelliteWindow:hitTestCursor')
  ipcMain.removeHandler('satelliteWindow:ready')
  ipcMain.removeHandler('satelliteWindow:getMirror')
  ipcMain.removeHandler('satelliteWindow:activateFile')
  ipcMain.removeHandler('satelliteWindow:moveFileBack')
  ipcMain.removeAllListeners('satelliteWindow:reportOpenFiles')
  ipcMain.removeAllListeners('satelliteWindow:activeWorktreeChanged')
  ipcMain.removeAllListeners('satelliteWindow:stageSession')
  ipcMain.removeAllListeners('satelliteWindow:stageSessionSync')
  ipcMain.removeAllListeners('satelliteWindow:bootFailed')
  unsubscribeParentNavigation?.()
  unsubscribeParentNavigation = onParentRendererNavigation(clearParentMirrorReady)
  unsubscribeRegistryBroadcast?.()
  unsubscribeRegistryBroadcast = onSatelliteRegistryChanged(broadcastMirror)
  clearAllSatellitePushState()
  clearAllParentMirrorReadiness()
  clearAllSatelliteLifecycleState()

  ipcMain.handle(
    'satelliteWindow:open',
    (event, worktreeId: unknown, file: unknown): { satelliteId: string } | null => {
      if (!isTrustedUIRenderer(event.sender)) {
        console.warn('[satellite-window] open rejected: untrusted sender', event.sender.id)
        return null
      }
      // Why: satellites are trusted renderers too, but a satellite-of-satellite
      // would be invisible to every mirror and never subordinated — reject.
      if (getSatelliteByWebContents(event.sender)) {
        console.warn('[satellite-window] open rejected: satellites cannot open satellites')
        return null
      }
      if (typeof worktreeId !== 'string' || worktreeId.length === 0 || !isBootFile(file)) {
        console.warn('[satellite-window] open rejected: invalid payload')
        return null
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (!parent) {
        return null
      }
      const { satelliteId, window } = createSatelliteWindow(parent, worktreeId, file)
      wireSatelliteWindowLifecycle(window, satelliteId, store)
      return { satelliteId }
    }
  )

  // Why {ok} (owner decision D14): a TRUE move closes the parent tab only after
  // main accepted the payload — the old void return hid every silent-drop path
  // (stale record, destroyed frame) and would have lost carried drafts.
  ipcMain.handle(
    'satelliteWindow:moveFile',
    (event, satelliteId: unknown, file: unknown): { ok: boolean } => {
      if (!isTrustedUIRenderer(event.sender)) {
        console.warn('[satellite-window] moveFile rejected: untrusted sender', event.sender.id)
        return { ok: false }
      }
      if (typeof satelliteId !== 'string' || !isMovedFile(file)) {
        console.warn('[satellite-window] moveFile rejected: invalid payload')
        return { ok: false }
      }
      const record = getSatellite(satelliteId)
      // Review C5/C6: refuse pushes that would strand or clobber data.
      if (
        !record ||
        isSatelliteRendererGone(record) ||
        wouldClobberSatelliteResidentDirtyFile(record, file)
      ) {
        return { ok: false }
      }
      pushOpenFile(satelliteId, file)
      upsertPersistedSatelliteFile(store, satelliteId, record.worktreeId, file)
      return { ok: true }
    }
  )

  ipcMain.handle('satelliteWindow:raise', (event, satelliteId: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[satellite-window] raise rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof satelliteId !== 'string') {
      return
    }
    const record = getSatellite(satelliteId)
    if (!record) {
      // The requesting renderer's mirror can be momentarily stale after a close.
      return
    }
    // Why: a deliberate raise overrides subordination — the user asked for the
    // window; the registry notify also refreshes the mirror's visible flags.
    markSatelliteRaised(satelliteId)
    activateWindow(record.window, app, process.platform, setTimeout)
  })

  // Dungeon 6 (tab drag-out, D20/D21): which satellite of the SENDER's window
  // is under the OS cursor at drop time. Main-side on purpose — cursor point
  // and window bounds share the DIP space, so the renderer never has to map
  // client coordinates across mixed-DPI monitors.
  ipcMain.handle('satelliteWindow:hitTestCursor', (event): SatelliteCursorHit | null => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[satellite-window] hitTestCursor rejected: untrusted sender', event.sender.id)
      return null
    }
    // Satellites are trusted renderers too, but they host no tab drag-out.
    if (getSatelliteByWebContents(event.sender)) {
      return null
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    return parent ? hitTestSatelliteAtCursor(parent) : null
  })

  // Dungeon 5: late-subscriber mirror snapshot — the change-driven broadcast
  // (and the did-finish-load re-broadcast) can land before the renderer's
  // subscription mounts, leaving interception blind after a reload.
  ipcMain.handle('satelliteWindow:getMirror', (event): SatelliteMirrorEntry[] => {
    if (!isTrustedUIRenderer(event.sender)) {
      return []
    }
    // The snapshot fetch doubles as the parent's "renderer can apply pushes"
    // signal (cleared again on its next main-frame navigation).
    markParentMirrorReady(event.sender.id)
    const target = BrowserWindow.fromWebContents(event.sender)
    return target ? buildMirrorEntriesFor(target) : []
  })

  // Open-interception raise + tab activation (spec 2 / D17). Membership is
  // re-checked against the LIVE registry files: the renderer's mirror can be
  // stale for two async hops, and pushing a just-closed file would re-open it
  // in the satellite the user closed it in.
  ipcMain.handle(
    'satelliteWindow:activateFile',
    (event, satelliteId: unknown, file: unknown): { ok: boolean } => {
      if (!isTrustedUIRenderer(event.sender)) {
        return { ok: false }
      }
      if (typeof satelliteId !== 'string' || !isBootFile(file)) {
        return { ok: false }
      }
      const record = getSatellite(satelliteId)
      if (!record || isSatelliteRendererGone(record)) {
        return { ok: false }
      }
      const isMember = record.files.some(
        (entry) =>
          entry.filePath === file.filePath ||
          areLocalWindowsWslPathAliases(entry.filePath, file.filePath)
      )
      if (!isMember) {
        return { ok: false }
      }
      markSatelliteRaised(satelliteId)
      activateWindow(record.window, app, process.platform, setTimeout)
      // A push of an already-open path activates + focuses its tab.
      pushOpenFile(satelliteId, file)
      return { ok: true }
    }
  )

  // Move Back (D6/D18): one file returns from a satellite to its parent. The
  // invoke ACK gates the satellite's local closeFile — a drop must keep the
  // satellite tab (mirror of the D14 move contract).
  ipcMain.handle('satelliteWindow:moveFileBack', (event, file: unknown): { ok: boolean } => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record || !isMovedFile(file)) {
      return { ok: false }
    }
    const parent = record.parentWindow
    if (
      parent.isDestroyed() ||
      parent.webContents.isDestroyed() ||
      parent.webContents.isCrashed() ||
      // A reloading/crashed parent cannot apply the push — keep the satellite
      // tab (a false ok would delete the file from both windows, C15/C2).
      !isParentMirrorReady(parent.webContents.id)
    ) {
      return { ok: false }
    }
    try {
      parent.webContents.send('satellite:filesMovedBack', {
        worktreeId: record.worktreeId,
        files: [file]
      })
    } catch {
      return { ok: false }
    }
    // D18: raise the parent only when the file lands in its ACTIVE worktree —
    // a background-worktree return must not yank the user's focus.
    if (getParentLastActiveWorktree(parent) === record.worktreeId) {
      activateWindow(parent, app, process.platform, setTimeout)
    }
    return { ok: true }
  })

  // Satellite renderer signals its boot finished; flush queued pushes.
  ipcMain.handle('satelliteWindow:ready', (event): void => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record) {
      return
    }
    markSatelliteReadyAndFlush(record.satelliteId)
  })

  ipcMain.on(
    'satelliteWindow:reportOpenFiles',
    (event, files: unknown, openSurfaceCount: unknown, dirtyOpenFileCount: unknown): void => {
      const record = getSatelliteByWebContents(event.sender)
      if (!record || !isFileEntryList(files)) {
        return
      }
      setSatelliteFiles(record.satelliteId, files)
      acknowledgeSeededSatelliteFiles(
        record.satelliteId,
        files.map((entry) => entry.filePath)
      )
      setSatelliteDirtyOpenFileCount(record.satelliteId, dirtyOpenFileCount)
      // Why a separate count: the mirror carries edit-mode files only, but a
      // satellite showing a non-edit surface (markdown preview) is not empty.
      const surfaces =
        typeof openSurfaceCount === 'number' &&
        Number.isInteger(openSurfaceCount) &&
        openSurfaceCount >= 0
          ? openSurfaceCount
          : files.length
      // Owner decision D1: a satellite whose last open surface closed has no function — close it.
      if (surfaces === 0 && !record.window.isDestroyed()) {
        record.window.close()
      }
    }
  )

  // Terminal boot failure (post-review C1/C7): the restore entry must not
  // zombie across launches, and a subordination-hidden restored window must
  // become visible so the user can read the error and close it.
  ipcMain.on('satelliteWindow:bootFailed', (event): void => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record) {
      return
    }
    store?.removeSatelliteWindowSession(record.satelliteId)
    markSatelliteRaised(record.satelliteId)
    if (!record.window.isDestroyed() && !record.window.isVisible()) {
      record.window.showInactive()
    }
  })

  // Continuous session staging (5-7): the latest snapshot per satellite is
  // what restart restores. Bounds are captured main-side (minimized windows
  // report iconic bounds — keep the previous rectangle then).
  const applyStagedSession = (event: Electron.IpcMainEvent, files: unknown): void => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record || !store || !Array.isArray(files) || !files.every((file) => isMovedFile(file))) {
      return
    }
    // Post-review C8: undelivered queued pushes mean the renderer's snapshot is
    // pre-restore — persisting it would clobber the seeded entry's drafts.
    if (hasPendingOpenFiles(record.satelliteId)) {
      return
    }
    const bounds =
      !record.window.isDestroyed() && !record.window.isMinimized()
        ? record.window.getBounds()
        : store
            .getSatelliteWindowSessions()
            .find((candidate) => candidate.satelliteId === record.satelliteId)?.bounds
    store.setSatelliteWindowSession({
      satelliteId: record.satelliteId,
      worktreeId: record.worktreeId,
      files: mergeUnackedSeededSatelliteFiles(
        store,
        record.satelliteId,
        files as SatelliteMovedFile[]
      ),
      ...(bounds ? { bounds } : {})
    })
  }
  ipcMain.on('satelliteWindow:stageSession', (event, files: unknown): void => {
    applyStagedSession(event, files)
  })
  // Why sendSync (beforeunload cannot await): returnValue is set FIRST so a
  // validation bail can never hang the closing renderer.
  ipcMain.on('satelliteWindow:stageSessionSync', (event, files: unknown): void => {
    event.returnValue = true
    applyStagedSession(event, files)
  })

  // Spec 5: the parent reports its active worktree; subordinate satellites
  // hide/show. The registry notify covers the mirror broadcast on real changes.
  ipcMain.on('satelliteWindow:activeWorktreeChanged', (event, worktreeId: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      return
    }
    if (typeof worktreeId !== 'string' || worktreeId.length === 0) {
      return
    }
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) {
      return
    }
    applyParentActiveWorktree(senderWindow, worktreeId)
  })
}
