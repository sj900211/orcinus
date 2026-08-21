import { randomUUID } from 'node:crypto'
import { app, BrowserWindow, ipcMain } from 'electron'
import type { Store } from '../persistence'
import type { KeybindingService } from '../keybindings/keybinding-service'
import { createOrFocusProjectWindow } from '../window/create-project-window'
import { activateWindow } from '../window/focus-existing-window'
import {
  getProjectWindow,
  listProjectWindowProjectKeys,
  onProjectWindowRegistryChanged,
  registerProjectWindow,
  rekeyProjectWindow
} from '../window/project-window-registry'
import { getRoutedMainWindow } from '../window/window-affinity-router'
import { isTrustedUIRenderer } from './ui'

// Why 2s: covers a busy renderer's stage round-trip without making Open feel hung; on expiry the
// window opens with the last persisted session (graceful degrade).
export const PROJECT_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS = 2_000

/**
 * Ask the main window renderer to checkpoint its live session NOW so the new
 * project window hydrates this run's tabs instead of the last shutdown's.
 * Always resolves — a missing/slow/failed renderer degrades to the stale session.
 */
function requestMainWindowSessionCheckpoint(): Promise<void> {
  const mainWebContents = getRoutedMainWindow()?.webContents
  if (!mainWebContents || mainWebContents.isDestroyed()) {
    console.warn(
      '[project-window] no main window to checkpoint the session; opening with persisted session'
    )
    return Promise.resolve()
  }
  return new Promise((resolve) => {
    const requestId = randomUUID()
    const settle = (): void => {
      clearTimeout(timer)
      ipcMain.removeListener('session:checkpointReply', onReply)
      resolve()
    }
    const timer = setTimeout(() => {
      console.warn('[project-window] session checkpoint timed out; opening with stale session')
      settle()
    }, PROJECT_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS)
    const onReply = (
      event: Electron.IpcMainEvent,
      reply: { requestId?: unknown; ok?: unknown }
    ): void => {
      // Why sender-checked: the requestId is renderer-visible, so only the window that was asked may settle the open.
      if (event.sender !== mainWebContents || reply?.requestId !== requestId) {
        return
      }
      if (reply.ok !== true) {
        console.warn('[project-window] session checkpoint failed; opening with stale session')
      }
      settle()
    }
    ipcMain.on('session:checkpointReply', onReply)
    mainWebContents.send('session:checkpointRequest', { requestId })
  })
}

/**
 * Payload is per-recipient: entries owned by the target window are excluded, so every
 * renderer can treat the received list uniformly as "projects open in OTHER windows".
 */
function sendOpenProjectsTo(target: BrowserWindow, openProjectKeys: readonly string[]): void {
  if (
    target.isDestroyed() ||
    (typeof target.webContents.isDestroyed === 'function' && target.webContents.isDestroyed())
  ) {
    return
  }
  const projectKeysInOtherWindows = openProjectKeys.filter(
    (projectKey) => getProjectWindow(projectKey) !== target
  )
  try {
    target.webContents.send('projectWindow:openProjectsChanged', projectKeysInOtherWindows)
  } catch {
    // Why: a frame disposed mid-send must not fail the registry mutation that triggered the broadcast.
  }
}

function broadcastOpenProjectsChanged(): void {
  const openProjectKeys = listProjectWindowProjectKeys()
  const targets = new Set<BrowserWindow>()
  const mainWindow = getRoutedMainWindow()
  if (mainWindow) {
    targets.add(mainWindow)
  }
  for (const projectKey of openProjectKeys) {
    const window = getProjectWindow(projectKey)
    if (window) {
      targets.add(window)
    }
  }
  for (const target of targets) {
    sendOpenProjectsTo(target, openProjectKeys)
  }
}

// Why module-level: registerProjectWindowHandlers may re-register (tests); keep exactly one registry subscription.
let unsubscribeRegistryBroadcast: (() => void) | null = null

export function registerProjectWindowHandlers(store: Store, keybindings?: KeybindingService): void {
  ipcMain.removeHandler('projectWindow:open')
  ipcMain.removeHandler('projectWindow:raise')
  ipcMain.removeAllListeners('projectWindow:activeProjectChanged')
  unsubscribeRegistryBroadcast?.()
  unsubscribeRegistryBroadcast = onProjectWindowRegistryChanged(broadcastOpenProjectsChanged)

  ipcMain.handle(
    'projectWindow:open',
    async (event, projectKey: unknown, worktreeId?: unknown): Promise<void> => {
      if (!isTrustedUIRenderer(event.sender)) {
        console.warn('[project-window] open rejected: untrusted sender', event.sender.id)
        return
      }
      if (typeof projectKey !== 'string' || projectKey.length === 0) {
        // Why: a silent drop here is undiagnosable from the renderer console.
        console.warn('[project-window] open rejected: invalid projectKey', projectKey)
        return
      }
      if (worktreeId !== undefined && (typeof worktreeId !== 'string' || worktreeId.length === 0)) {
        console.warn('[project-window] open rejected: invalid worktreeId', worktreeId)
        return
      }
      // Why skipped for an existing window: focus needs no rehydration, so a checkpoint would only delay it.
      if (!getProjectWindow(projectKey)) {
        await requestMainWindowSessionCheckpoint()
      }
      const preexisting = getProjectWindow(projectKey)
      const window = createOrFocusProjectWindow(store, projectKey, {
        ...(worktreeId ? { worktreeId } : {}),
        getKeybindings: () => keybindings?.getOverrides()
      })
      if (window !== preexisting) {
        // Why: the register-time broadcast can outrun the new renderer's IPC subscription; re-send once loaded.
        window.webContents.once('did-finish-load', () =>
          sendOpenProjectsTo(window, listProjectWindowProjectKeys())
        )
      }
    }
  )

  ipcMain.handle('projectWindow:raise', (event, projectKey: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[project-window] raise rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof projectKey !== 'string' || projectKey.length === 0) {
      console.warn('[project-window] raise rejected: invalid projectKey', projectKey)
      return
    }
    const window = getProjectWindow(projectKey)
    if (!window) {
      // Why: the requesting renderer's snapshot can be momentarily stale after a close; nothing to raise.
      return
    }
    // Why raise-only (no worktree forwarding): the owner window already shows this project's
    // rows, so raising it is sufficient — dropping the forward removes the forwarding bug class.
    activateWindow(window, app, process.platform, setTimeout)
  })

  ipcMain.on('projectWindow:activeProjectChanged', (event, projectKey: unknown): void => {
    if (!isTrustedUIRenderer(event.sender)) {
      console.warn('[project-window] re-key rejected: untrusted sender', event.sender.id)
      return
    }
    if (typeof projectKey !== 'string' || projectKey.length === 0) {
      console.warn('[project-window] re-key rejected: invalid projectKey', projectKey)
      return
    }
    const senderWindow = BrowserWindow.fromWebContents(event.sender)
    if (!senderWindow) {
      return
    }
    const result = rekeyProjectWindow(senderWindow, projectKey)
    if (result === 'conflict') {
      // Why defensive only: the renderer raise guard should make a steal unreachable; keep the invariant and surface the bug.
      console.warn('[project-window] re-key ignored: project owned by another window', projectKey)
    } else if (result === 'not-registered') {
      // Why: a window owning nothing yet — the main window's first report, or any window after
      // landing — registers its active project here, so main participates in ownership like a project window.
      const currentOwner = getProjectWindow(projectKey)
      if (currentOwner && currentOwner !== senderWindow) {
        console.warn(
          '[project-window] register ignored: project owned by another window',
          projectKey
        )
      } else {
        registerProjectWindow(projectKey, senderWindow)
      }
    }
    // Why: this message doubles as "project renderer is subscribed"; the reply snapshot hydrates
    // late subscribers even if the did-finish-load send raced ahead of the renderer's listener.
    sendOpenProjectsTo(senderWindow, listProjectWindowProjectKeys())
  })
}
