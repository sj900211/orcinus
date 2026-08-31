import { randomUUID } from 'node:crypto'
import { BrowserWindow, nativeTheme } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import { addTrustedUIRendererWebContentsId, removeTrustedUIRendererWebContentsId } from '../ipc/ui'
import {
  registerSatellite,
  shouldRevealSatelliteOnReady,
  unregisterSatellite
} from './satellite-window-registry'
import type { SatelliteBootFile } from '../../shared/satellite-window-payloads'

// Satellite editor window factory (Expedition 5): a native-frame window that
// hosts editor tabs for ONE worktree, subordinate to the app window that
// opened it (registry-and-hooks cascade; the Electron `parent:` option stays
// deliberately unused — its auto-destroy would bypass any dirty protocol).
// The spike's singleton and destroy-and-recreate retarget are gone: satellites
// are never renavigated — a new file is an IPC push into the live renderer,
// a new worktree is a new satellite.

const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 760
const CASCADE_OFFSET = 32

function loadSatelliteWindow(
  window: BrowserWindow,
  satelliteId: string,
  worktreeId: string,
  bootFile: SatelliteBootFile
): void {
  const search = new URLSearchParams({
    'orca-satellite-id': satelliteId,
    'orca-worktree': worktreeId,
    'orca-editor-file': bootFile.filePath,
    'orca-editor-relative': bootFile.relativePath,
    'orca-editor-language': bootFile.language
  }).toString()
  // Why the catch: closing the window mid-load rejects with ERR_ABORTED —
  // expected teardown, not an unhandled rejection.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/editor.html?${search}`).catch(() => {})
  } else {
    window.loadFile(join(__dirname, '../renderer/editor.html'), { search }).catch(() => {})
  }
}

export function createSatelliteWindow(
  parent: BrowserWindow,
  worktreeId: string,
  bootFile: SatelliteBootFile
): { satelliteId: string; window: BrowserWindow } {
  const satelliteId = randomUUID()
  // Why the minimized check: a minimized win32 window reports iconic bounds
  // (~-32000) — a cascade offset from those would spawn the satellite off-screen.
  const parentBounds = parent.isDestroyed() || parent.isMinimized() ? null : parent.getBounds()

  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    ...(parentBounds
      ? { x: parentBounds.x + CASCADE_OFFSET, y: parentBounds.y + CASCADE_OFFSET }
      : {}),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: `${bootFile.relativePath} — Orcinus`,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    // Why native frame: movable/closable everywhere without reimplementing the
    // main window's custom titlebar chrome (dashboard-popout rationale).
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      // Why per-satellite partition (owner decision D3): Chromium shares zoom
      // by origin per session — an isolated session gives each satellite an
      // independent zoom level. Accepted cost: Electron never releases a
      // Session, so each open/close cycle retains one for process lifetime.
      partition: `orcinus-satellite-${satelliteId}`,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  // Why: isolated sessions do not inherit the main session's deny-by-default permission policy.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)

  // Why: Monaco's context-menu Paste routes through the trusted-sender-gated
  // ui:performNativePaste — join the additional trusted set like workspace
  // windows. Captured now: reading webContents.id inside 'closed' throws.
  const trustedWebContentsId = window.webContents.id
  addTrustedUIRendererWebContentsId(trustedWebContentsId)

  registerSatellite({
    satelliteId,
    window,
    parentWindow: parent,
    worktreeId,
    files: [],
    hiddenByWorkspaceSwitch: false,
    hiddenWithParent: false,
    minimizedBeforeHide: false,
    trustedWebContentsId
  })

  window.once('ready-to-show', () => {
    // Why the registry consult: the parent may have switched worktrees (or
    // tray-hidden) while this satellite was still booting invisibly — an
    // unconditional show() would reveal it over the wrong workspace and no
    // correcting report would arrive until the NEXT switch.
    if (!window.isDestroyed() && shouldRevealSatelliteOnReady(satelliteId)) {
      window.show()
    }
  })

  window.on('closed', () => {
    removeTrustedUIRendererWebContentsId(trustedWebContentsId)
    unregisterSatellite(satelliteId, window)
  })

  loadSatelliteWindow(window, satelliteId, worktreeId, bootFile)
  return { satelliteId, window }
}
