import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  replyListeners,
  ipcMainMock,
  createWorkspaceWindowMock,
  isTrustedUIRendererMock,
  getWorkspaceWindowMock,
  getRoutedMainWindowMock
} = vi.hoisted(() => {
  const map = new Map<string, (...args: unknown[]) => unknown>()
  const listeners: ((...args: unknown[]) => void)[] = []
  return {
    handlers: map,
    replyListeners: listeners,
    ipcMainMock: {
      removeHandler: vi.fn(),
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === 'session:checkpointReply') {
          listeners.push(listener)
        }
      }),
      removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const index = listeners.indexOf(listener)
        if (channel === 'session:checkpointReply' && index !== -1) {
          listeners.splice(index, 1)
        }
      })
    },
    createWorkspaceWindowMock: vi.fn(),
    isTrustedUIRendererMock: vi.fn((_sender: unknown) => false),
    getWorkspaceWindowMock: vi.fn(() => undefined),
    getRoutedMainWindowMock: vi.fn((): unknown => null)
  }
})

vi.mock('electron', () => ({ ipcMain: ipcMainMock }))
vi.mock('../window/create-workspace-window', () => ({
  createOrFocusWorkspaceWindow: createWorkspaceWindowMock
}))
vi.mock('../window/workspace-window-registry', () => ({
  getWorkspaceWindow: getWorkspaceWindowMock
}))
vi.mock('../window/window-affinity-router', () => ({
  getRoutedMainWindow: getRoutedMainWindowMock
}))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import {
  registerWorkspaceWindowHandlers,
  WORKSPACE_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS
} from './workspace-window'

const mainSender = { id: 1 }
const untrustedSender = { id: 3 }

function makeMainWindow() {
  return {
    webContents: {
      id: 1,
      isDestroyed: () => false,
      send: vi.fn()
    }
  }
}

function sentCheckpointRequestId(mainWindow: ReturnType<typeof makeMainWindow>): string {
  const call = mainWindow.webContents.send.mock.calls.find(
    (c: unknown[]) => c[0] === 'session:checkpointRequest'
  )
  expect(call).toBeDefined()
  return (call![1] as { requestId: string }).requestId
}

function fireCheckpointReply(sender: unknown, reply: { requestId: string; ok: boolean }): void {
  // Snapshot: a settling listener removes itself from replyListeners mid-iteration.
  for (const listener of replyListeners.slice()) {
    listener({ sender }, reply)
  }
}

describe('registerWorkspaceWindowHandlers', () => {
  const store = { marker: 'store' }

  beforeEach(() => {
    handlers.clear()
    replyListeners.length = 0
    isTrustedUIRendererMock.mockImplementation((sender) => sender === mainSender)
    getWorkspaceWindowMock.mockReturnValue(undefined)
    getRoutedMainWindowMock.mockReturnValue(null)
    registerWorkspaceWindowHandlers(store as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('re-registers idempotently by removing the previous handler first', () => {
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith('workspaceWindow:open')
    expect(handlers.has('workspaceWindow:open')).toBe(true)
  })

  it('opens only for a trusted renderer with a non-empty worktree id', async () => {
    const open = handlers.get('workspaceWindow:open')!

    await open({ sender: untrustedSender } as never, 'wt-1')
    await open({ sender: mainSender } as never, '')
    await open({ sender: mainSender } as never, 7)
    await open({ sender: mainSender } as never, undefined)
    expect(createWorkspaceWindowMock).not.toHaveBeenCalled()

    await open({ sender: mainSender } as never, 'wt-1')
    expect(createWorkspaceWindowMock).toHaveBeenCalledWith(store, 'wt-1', {
      getKeybindings: expect.any(Function)
    })
  })

  it('routes getKeybindings through the keybinding service overrides', async () => {
    const overrides = { 'zoom.in': ['Mod+Y'] }
    const keybindings = { getOverrides: vi.fn(() => overrides) }
    handlers.clear()
    registerWorkspaceWindowHandlers(store as never, keybindings as never)

    await handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')

    const options = createWorkspaceWindowMock.mock.calls[0]?.[2] as {
      getKeybindings: () => unknown
    }
    expect(options.getKeybindings()).toBe(overrides)
  })

  it('checkpoints the main window session before opening and proceeds on the reply', async () => {
    const mainWindow = makeMainWindow()
    getRoutedMainWindowMock.mockReturnValue(mainWindow)

    const opening = handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')
    const requestId = sentCheckpointRequestId(mainWindow)
    expect(createWorkspaceWindowMock).not.toHaveBeenCalled()

    fireCheckpointReply(mainWindow.webContents, { requestId, ok: true })
    await opening

    expect(createWorkspaceWindowMock).toHaveBeenCalledWith(store, 'wt-1', {
      getKeybindings: expect.any(Function)
    })
    // The per-request reply listener must not outlive the open.
    expect(ipcMainMock.removeListener).toHaveBeenCalledWith(
      'session:checkpointReply',
      expect.any(Function)
    )
    expect(replyListeners).toHaveLength(0)
  })

  it('ignores replies from other senders and other request ids', async () => {
    const mainWindow = makeMainWindow()
    getRoutedMainWindowMock.mockReturnValue(mainWindow)

    const opening = handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')
    const requestId = sentCheckpointRequestId(mainWindow)

    fireCheckpointReply({ id: 999, isDestroyed: () => false }, { requestId, ok: true })
    fireCheckpointReply(mainWindow.webContents, { requestId: 'someone-elses', ok: true })
    await Promise.resolve()
    expect(createWorkspaceWindowMock).not.toHaveBeenCalled()

    fireCheckpointReply(mainWindow.webContents, { requestId, ok: true })
    await opening
    expect(createWorkspaceWindowMock).toHaveBeenCalledTimes(1)
  })

  it('opens with the stale session when the checkpoint times out', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mainWindow = makeMainWindow()
      getRoutedMainWindowMock.mockReturnValue(mainWindow)

      const opening = handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')
      expect(createWorkspaceWindowMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(WORKSPACE_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS)
      await opening

      expect(createWorkspaceWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[workspace-window] session checkpoint timed out; opening with stale session'
      )
      expect(replyListeners).toHaveLength(0)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('still opens (with a warning) when a failed checkpoint replies ok:false', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mainWindow = makeMainWindow()
      getRoutedMainWindowMock.mockReturnValue(mainWindow)

      const opening = handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')
      fireCheckpointReply(mainWindow.webContents, {
        requestId: sentCheckpointRequestId(mainWindow),
        ok: false
      })
      await opening

      expect(createWorkspaceWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[workspace-window] session checkpoint failed; opening with stale session'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('opens without a checkpoint when no main window is routed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')
      expect(createWorkspaceWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[workspace-window] no main window to checkpoint the session; opening with persisted session'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips the checkpoint when the worktree already has a workspace window (focus path)', async () => {
    const mainWindow = makeMainWindow()
    getRoutedMainWindowMock.mockReturnValue(mainWindow)
    getWorkspaceWindowMock.mockReturnValue({ marker: 'existing' } as never)

    await handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    expect(createWorkspaceWindowMock).toHaveBeenCalledTimes(1)
  })
})
