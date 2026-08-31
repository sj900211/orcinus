import { BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'node:path'
import { is } from '@electron-toolkit/utils'
import { installPrivilegedWindowNavigationPolicy } from './privileged-window-navigation'
import {
  addTrustedUIRendererWebContentsId,
  isTrustedUIRenderer,
  removeTrustedUIRendererWebContentsId
} from '../ipc/ui'

// Editor child window (Expedition 5 spike): hosts ONE editor tab in its own
// BrowserWindow, subordinate to the window it was opened from — when that
// parent closes, the child closes with it (registry-and-hooks idiom; the
// Electron `parent:` option is deliberately unused repo-wide because its
// auto-destroy would bypass any dirty-close protocol).
//
// Spike boundaries (dungeon 1): singleton child, native frame (popout
// rationale), no zoom plumbing, cascade uses plain close() with no dirty
// protocol — the move/dirty/persistence protocol is dungeon-2 design work.

const MIN_WIDTH = 480
const MIN_HEIGHT = 360
const DEFAULT_WIDTH = 1100
const DEFAULT_HEIGHT = 760
// Why a separate in-memory partition: Chromium shares zoom by origin; an
// isolated session keeps the child's zoom window-local (dashboard precedent).
const EDITOR_CHILD_PARTITION = 'orcinus-editor-child'

export type EditorChildWindowBootParams = {
  filePath: string
  relativePath: string
  worktreeId: string
  language: string
}

let editorChildWindow: BrowserWindow | null = null

export function getEditorChildWindow(): BrowserWindow | null {
  return editorChildWindow &&
    !editorChildWindow.isDestroyed() &&
    !editorChildWindow.webContents.isDestroyed()
    ? editorChildWindow
    : null
}

function loadEditorChildWindow(window: BrowserWindow, params: EditorChildWindowBootParams): void {
  const search = new URLSearchParams({
    'orca-editor-file': params.filePath,
    'orca-editor-relative': params.relativePath,
    'orca-worktree': params.worktreeId,
    'orca-editor-language': params.language
  }).toString()
  // Why the catch: closing the window mid-load rejects the load promise with
  // ERR_ABORTED — expected teardown, not an error worth an unhandled rejection.
  // Why the branch: mirror loadDashboardPopout — the dev server serves the
  // third HTML entry, prod loads the emitted file.
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(`${process.env.ELECTRON_RENDERER_URL}/editor.html?${search}`).catch(() => {})
  } else {
    window.loadFile(join(__dirname, '../renderer/editor.html'), { search }).catch(() => {})
  }
}

export function createOrFocusEditorChildWindow(
  parent: BrowserWindow | null,
  params: EditorChildWindowBootParams
): BrowserWindow {
  const existing = getEditorChildWindow()
  if (existing) {
    // Why destroy-and-recreate instead of navigating in place: an in-place
    // navigation never destroys the sender, so the old worktree's FS watcher
    // leaks and the cascade stays bound to the ORIGINAL opener window. The
    // spike has no dirty protocol yet, so unsaved child edits are dropped
    // here — the move/dirty design is dungeon-2 work.
    existing.destroy()
  }

  const window = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    title: `${params.relativePath} — Orcinus`,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0a0a0a' : '#ffffff',
    // Why native frame: movable/closable on every platform without
    // reimplementing the main window's custom titlebar chrome (popout rationale).
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      partition: EDITOR_CHILD_PARTITION,
      webviewTag: false
    }
  })
  installPrivilegedWindowNavigationPolicy(window.webContents)
  // Why: isolated sessions do not inherit the main session's deny-by-default permission policy.
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  // Why: Monaco's context-menu Paste routes through ui:performNativePaste,
  // which is trusted-sender gated — join the additional trusted set the way
  // workspace windows do, and leave on 'closed'.
  // Why captured: by the time 'closed' fires the webContents is destroyed and
  // reading window.webContents.id throws — the spike's close-time error.
  const trustedWebContentsId = window.webContents.id
  addTrustedUIRendererWebContentsId(trustedWebContentsId)
  editorChildWindow = window

  // Cascade: the child is subordinate to the window that opened it.
  const closeChildWithParent = (): void => {
    if (editorChildWindow === window && !window.isDestroyed()) {
      window.close()
    }
  }
  parent?.on('closed', closeChildWithParent)

  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) {
      window.show()
    }
  })

  window.on('closed', () => {
    // Spike diagnostics: proves the running main bundle carries the captured-id
    // fix (stale-bundle suspicion from the close-error audit). Remove at cleanup.
    console.log('[editor-child] closed (v2 handler)')
    removeTrustedUIRendererWebContentsId(trustedWebContentsId)
    parent?.removeListener('closed', closeChildWithParent)
    if (editorChildWindow === window) {
      editorChildWindow = null
    }
  })

  loadEditorChildWindow(window, params)
  return window
}

function isBootParams(value: unknown): value is EditorChildWindowBootParams {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (['filePath', 'relativePath', 'worktreeId', 'language'] as const).every(
    (key) => typeof record[key] === 'string' && record[key] !== ''
  )
}

export function registerEditorChildWindowHandlers(): void {
  ipcMain.removeHandler('editorChildWindow:open')

  ipcMain.handle('editorChildWindow:open', (event, args: unknown): void => {
    // Why the gate: only app windows (main/workspace) may spawn editor children.
    if (!isTrustedUIRenderer(event.sender) || !isBootParams(args)) {
      return
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    createOrFocusEditorChildWindow(parent, args)
  })
}
