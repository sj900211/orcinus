import { app, BrowserWindow, ipcMain } from 'electron'
import { createSatelliteWindow } from '../window/create-satellite-window'
import {
  applyParentActiveWorktree,
  getSatellite,
  getSatelliteByWebContents,
  listSatellitesForParent,
  markSatelliteRaised,
  onSatelliteRegistryChanged,
  setSatelliteFiles
} from '../window/satellite-window-registry'
import { activateWindow } from '../window/focus-existing-window'
import { listAppWindows } from '../window/window-affinity-router'
import { isTrustedUIRenderer } from './ui'
import type {
  SatelliteBootFile,
  SatelliteFileEntry,
  SatelliteMirrorEntry
} from '../../shared/satellite-window-payloads'

// IPC for satellite editor windows (Expedition 5, dungeon 3). Mirrors the
// project-window handler structure: one module-level registry subscription,
// trusted-sender gates on every channel, per-recipient mirror payloads.

function isBootFile(value: unknown): value is SatelliteBootFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (['filePath', 'relativePath', 'language'] as const).every(
    (key) => typeof record[key] === 'string' && record[key] !== ''
  )
}

function isFileEntryList(value: unknown): value is SatelliteFileEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).fileId === 'string' &&
        typeof (entry as Record<string, unknown>).filePath === 'string'
    )
  )
}

// Why a boot queue: moveFile pushes can race the satellite's mini-hydration;
// files sent before the renderer's satelliteWindow:ready are flushed on it.
// A renderer reload un-readies its satellite (did-start-navigation hook below)
// so post-reload pushes queue again instead of vanishing into a loading page.
const pendingOpenFilesBySatelliteId = new Map<string, SatelliteBootFile[]>()
// Last dirty-file count each satellite reported; gates the native-close intercept.
const dirtyOpenFileCountBySatelliteId = new Map<string, number>()
const readySatelliteIds = new Set<string>()

function clearSatelliteIpcState(satelliteId: string): void {
  dirtyOpenFileCountBySatelliteId.delete(satelliteId)
  pendingOpenFilesBySatelliteId.delete(satelliteId)
  readySatelliteIds.delete(satelliteId)
}

function pushOpenFile(satelliteId: string, file: SatelliteBootFile): void {
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

/**
 * Per-recipient mirror: each app window receives only ITS satellites — the
 * mirror drives that parent's open-interception and menu gating, and other
 * windows have no use for it.
 */
function sendMirrorTo(target: BrowserWindow): void {
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return
  }
  const entries: SatelliteMirrorEntry[] = listSatellitesForParent(target).map((record) => ({
    satelliteId: record.satelliteId,
    worktreeId: record.worktreeId,
    // Why flag-derived (not isVisible()): a booting satellite is invisible but
    // functional, and win32 reports minimized windows as visible — the mirror
    // contract is "hidden by subordination", which only the flags encode.
    visible: !record.hiddenByWorkspaceSwitch && !record.hiddenWithParent,
    files: record.files
  }))
  try {
    target.webContents.send('satelliteWindow:mirrorChanged', entries)
  } catch {
    // Why: a frame disposed mid-send must not fail the registry mutation that triggered the broadcast.
  }
}

function broadcastMirror(): void {
  for (const target of listAppWindows()) {
    sendMirrorTo(target)
  }
}

// Why module-level: handlers may re-register (tests); keep exactly one registry subscription.
let unsubscribeRegistryBroadcast: (() => void) | null = null

export function registerSatelliteWindowHandlers(): void {
  ipcMain.removeHandler('satelliteWindow:open')
  ipcMain.removeHandler('satelliteWindow:moveFile')
  ipcMain.removeHandler('satelliteWindow:raise')
  ipcMain.removeHandler('satelliteWindow:ready')
  ipcMain.removeAllListeners('satelliteWindow:reportOpenFiles')
  ipcMain.removeAllListeners('satelliteWindow:activeWorktreeChanged')
  ipcMain.removeAllListeners('satelliteWindow:confirmClose')
  unsubscribeRegistryBroadcast?.()
  unsubscribeRegistryBroadcast = onSatelliteRegistryChanged(broadcastMirror)
  pendingOpenFilesBySatelliteId.clear()
  readySatelliteIds.clear()
  dirtyOpenFileCountBySatelliteId.clear()

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
      // IPC-side lifecycle: a main-frame renderer navigation (View→Reload,
      // crash recovery) invalidates ready — pushes must queue again; close
      // drops this module's per-satellite state.
      window.webContents.on(
        'did-start-navigation',
        (_event, _url, _isInPlace, isMainFrame): void => {
          if (isMainFrame) {
            readySatelliteIds.delete(satelliteId)
            // A reload resets the renderer store - stale dirtiness must not
            // intercept a close against a booting renderer with no listener.
            dirtyOpenFileCountBySatelliteId.delete(satelliteId)
          }
        }
      )
      // Post-review fix: intercept the native close ONLY while the renderer
      // reports dirty files - it drains them through its save dialog, then
      // confirms. Boot/crashed states pass through untouched, and View->Reload
      // (no 'close' event) never reaches this path, so a vetoed reload can no
      // longer be converted into a window close.
      window.on('close', (closeEvent) => {
        if (window.webContents.isDestroyed() || window.webContents.isCrashed()) {
          return
        }
        if ((dirtyOpenFileCountBySatelliteId.get(satelliteId) ?? 0) === 0) {
          return
        }
        closeEvent.preventDefault()
        window.webContents.send('satelliteWindow:closeRequested')
      })
      window.on('closed', () => clearSatelliteIpcState(satelliteId))
      return { satelliteId }
    }
  )

  ipcMain.handle('satelliteWindow:moveFile', (event, satelliteId: unknown, file: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[satellite-window] moveFile rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof satelliteId !== 'string' || !isBootFile(file)) {
      console.warn('[satellite-window] moveFile rejected: invalid payload')
      return
    }
    pushOpenFile(satelliteId, file)
  })

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

  // Satellite renderer signals its boot finished; flush queued pushes.
  ipcMain.handle('satelliteWindow:ready', (event): void => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record) {
      return
    }
    readySatelliteIds.add(record.satelliteId)
    const queue = pendingOpenFilesBySatelliteId.get(record.satelliteId)
    pendingOpenFilesBySatelliteId.delete(record.satelliteId)
    for (const file of queue ?? []) {
      pushOpenFile(record.satelliteId, file)
    }
  })

  ipcMain.on(
    'satelliteWindow:reportOpenFiles',
    (event, files: unknown, openSurfaceCount: unknown, dirtyOpenFileCount: unknown): void => {
      const record = getSatelliteByWebContents(event.sender)
      if (!record || !isFileEntryList(files)) {
        return
      }
      setSatelliteFiles(record.satelliteId, files)
      dirtyOpenFileCountBySatelliteId.set(
        record.satelliteId,
        typeof dirtyOpenFileCount === 'number' &&
          Number.isInteger(dirtyOpenFileCount) &&
          dirtyOpenFileCount >= 0
          ? dirtyOpenFileCount
          : 0
      )
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

  // The renderer finished draining its dirty files for an intercepted close.
  ipcMain.on('satelliteWindow:confirmClose', (event): void => {
    const record = getSatelliteByWebContents(event.sender)
    if (!record || record.window.isDestroyed()) {
      return
    }
    // Why destroy(): it skips the 'close' intercept and beforeunload - the
    // renderer just drained, nothing is left to guard - while 'closed' still
    // fires so registry/IPC cleanup stays intact.
    record.window.destroy()
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
