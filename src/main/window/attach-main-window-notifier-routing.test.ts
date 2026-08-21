import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Store } from '../persistence'

const { onMock, removeListenerMock, handleMock, removeHandlerMock } = vi.hoisted(() => ({
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn()
}))

vi.mock('electron', () => ({
  app: {},
  clipboard: {},
  systemPreferences: {
    askForMediaAccess: vi.fn(),
    getMediaAccessStatus: vi.fn(() => 'granted')
  },
  ipcMain: {
    on: onMock,
    removeAllListeners: vi.fn(),
    removeListener: removeListenerMock,
    removeHandler: removeHandlerMock,
    handle: handleMock
  },
  powerMonitor: { on: vi.fn(), off: vi.fn() }
}))

vi.mock('../ipc/repos', () => ({
  registerRepoHandlers: vi.fn(),
  setRepoRemoteClientNotifier: vi.fn()
}))
vi.mock('../ipc/worktrees', () => ({ registerWorktreeHandlers: vi.fn() }))
vi.mock('../ipc/worktree-change-invalidators', () => ({ runWorktreeChangeInvalidators: vi.fn() }))
vi.mock('../ipc/pty', () => ({ getLocalPtyProvider: vi.fn(), registerPtyHandlers: vi.fn() }))
vi.mock('../memory/hydrate-local-pty-registry', () => ({ hydrateLocalPtyRegistryAtBoot: vi.fn() }))
vi.mock('../browser/browser-manager', () => ({ browserManager: { unregisterAll: vi.fn() } }))
vi.mock('../updater', () => ({
  checkForUpdates: vi.fn(),
  getUpdateStatus: vi.fn(),
  quitAndInstall: vi.fn(),
  dismissNudge: vi.fn(),
  setupAutoUpdater: vi.fn()
}))
vi.mock('../macos-tcc-prompt-notice', () => ({
  acknowledgePendingTccPromptNotice: vi.fn(),
  consumePendingTccPromptNotice: vi.fn(),
  dismissTccPromptNotice: vi.fn(),
  releasePendingTccPromptNotice: vi.fn()
}))

import { attachMainWindowServices } from './attach-main-window-services'
import { registerProjectWindow, unregisterProjectWindow } from './project-window-registry'

type MockFn = ReturnType<typeof vi.fn>

function createMainWindow(send: MockFn) {
  return {
    id: 1,
    isDestroyed: vi.fn(() => false),
    on: vi.fn(),
    once: vi.fn(),
    webContents: {
      id: 1,
      getURL: vi.fn(() => 'file:///opt/orca/renderer/index.html'),
      isDestroyed: vi.fn(() => false),
      isLoadingMainFrame: vi.fn(() => true),
      on: vi.fn(),
      send,
      reload: vi.fn(),
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn()
      }
    }
  }
}

function createWorkspaceWindow(webContentsId: number) {
  return {
    isDestroyed: vi.fn(() => false),
    webContents: {
      id: webContentsId,
      isDestroyed: vi.fn(() => false),
      send: vi.fn(),
      once: vi.fn()
    }
  }
}

function createStore(): Store {
  return {
    getProfileStorageDirectory: vi.fn(() => '/profile-a'),
    flushPendingAsync: vi.fn(() => Promise.resolve())
  } as unknown as Store
}

function createRuntime() {
  return {
    attachWindow: vi.fn(),
    setNotifier: vi.fn(),
    markRendererReloading: vi.fn(),
    markRendererReloadCancelled: vi.fn(),
    markGraphReloadFailed: vi.fn(),
    markGraphUnavailable: vi.fn()
  }
}

describe('attachMainWindowServices notifier routing (workspace windows)', () => {
  beforeEach(() => {
    onMock.mockReset()
    removeListenerMock.mockReset()
    handleMock.mockReset()
    removeHandlerMock.mockReset()
  })

  it('routes worktree-scoped notifier events to the workspace window that owns the worktree', () => {
    const mainSend = vi.fn()
    const mainWindow = createMainWindow(mainSend)
    const runtime = createRuntime()
    const workspaceWindow = createWorkspaceWindow(77)
    registerProjectWindow('wt-owned', workspaceWindow as never)
    try {
      attachMainWindowServices(mainWindow as never, createStore(), runtime as never)
      const notifier = runtime.setNotifier.mock.calls[0][0] as {
        activateWorktree: (repoId: string, worktreeId: string) => void
        sleepWorktree: (worktreeId: string) => void
        createTerminal: (worktreeId: string, opts: { command?: string; title?: string }) => void
      }

      notifier.activateWorktree('repo-1', 'wt-owned')
      notifier.sleepWorktree('wt-owned')
      notifier.createTerminal('wt-elsewhere', { command: 'ls', title: 'T' })

      expect(workspaceWindow.webContents.send.mock.calls.map(([channel]) => channel)).toEqual([
        'ui:activateWorktree',
        'ui:sleepWorktree'
      ])
      // Worktrees without a workspace window still land on the main window.
      expect(mainSend.mock.calls.map(([channel]) => channel)).toEqual(['ui:createTerminal'])
    } finally {
      unregisterProjectWindow('wt-owned', workspaceWindow as never)
    }
  })

  it('broadcasts repo/global and tab-scoped notifier events to every app window', () => {
    const mainSend = vi.fn()
    const mainWindow = createMainWindow(mainSend)
    const runtime = createRuntime()
    const workspaceWindow = createWorkspaceWindow(78)
    registerProjectWindow('wt-broadcast', workspaceWindow as never)
    try {
      attachMainWindowServices(mainWindow as never, createStore(), runtime as never)
      const notifier = runtime.setNotifier.mock.calls[0][0] as {
        reposChanged: () => void
        worktreesChanged: (repoId: string) => void
        renameTerminal: (tabId: string, title: string | null) => void
      }

      notifier.reposChanged()
      notifier.worktreesChanged('repo-1')
      notifier.renameTerminal('tab-1', 'renamed')

      for (const send of [mainSend, workspaceWindow.webContents.send]) {
        expect(send.mock.calls.map(([channel]) => channel)).toEqual([
          'repos:changed',
          'worktrees:changed',
          'ui:renameTerminal'
        ])
      }
    } finally {
      unregisterProjectWindow('wt-broadcast', workspaceWindow as never)
    }
  })

  it('reveals terminals in the owner workspace window and rejects replies from other windows', async () => {
    const mainSend = vi.fn()
    const mainWindow = createMainWindow(mainSend)
    const runtime = createRuntime()
    const workspaceWindow = createWorkspaceWindow(79)
    registerProjectWindow('wt-reveal', workspaceWindow as never)
    try {
      attachMainWindowServices(mainWindow as never, createStore(), runtime as never)
      const notifier = runtime.setNotifier.mock.calls[0][0] as {
        revealTerminalSession: (
          worktreeId: string,
          opts: { ptyId: string; title?: string }
        ) => Promise<{ tabId: string; title?: string }>
      }

      const revealPromise = notifier.revealTerminalSession('wt-reveal', {
        ptyId: 'pty-9',
        title: 'agent'
      })
      // Request went to the owner workspace window, not the main window.
      const sentPayload = workspaceWindow.webContents.send.mock.calls.find(
        ([channel]) => channel === 'ui:createTerminal'
      )?.[1] as { requestId: string }
      expect(sentPayload).toBeDefined()
      expect(mainSend).not.toHaveBeenCalledWith('ui:createTerminal', expect.anything())

      const handler = onMock.mock.calls.findLast(
        ([channel]) => channel === 'terminal:tabCreateReply'
      )?.[1] as ((event: unknown, reply: unknown) => void) | undefined
      // The main window is a trusted app window but NOT this reveal's target — its reply must be ignored.
      handler?.(
        { sender: mainWindow.webContents },
        { requestId: sentPayload.requestId, tabId: 'tab-wrong' }
      )
      expect(removeListenerMock).not.toHaveBeenCalledWith('terminal:tabCreateReply', handler)

      handler?.(
        { sender: workspaceWindow.webContents },
        { requestId: sentPayload.requestId, tabId: 'tab-9', title: 'agent' }
      )
      await expect(revealPromise).resolves.toEqual({ tabId: 'tab-9', title: 'agent' })
    } finally {
      unregisterProjectWindow('wt-reveal', workspaceWindow as never)
    }
  })
})
