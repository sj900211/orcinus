import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  replyListeners,
  eventListeners,
  ipcMainMock,
  fromWebContentsMock,
  appMock,
  createProjectWindowMock,
  isTrustedUIRendererMock,
  getProjectWindowMock,
  listProjectWindowProjectKeysMock,
  onProjectWindowRegistryChangedMock,
  rekeyProjectWindowMock,
  registerProjectWindowMock,
  registryChangeListeners,
  getRoutedMainWindowMock,
  resolveProjectKeyForWorkspaceKeyMock,
  activateWindowMock
} = vi.hoisted(() => {
  const map = new Map<string, (...args: unknown[]) => unknown>()
  const listeners: ((...args: unknown[]) => void)[] = []
  const events = new Map<string, ((...args: unknown[]) => void)[]>()
  const changeListeners: (() => void)[] = []
  return {
    handlers: map,
    replyListeners: listeners,
    eventListeners: events,
    ipcMainMock: {
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn((channel: string) => {
        events.delete(channel)
      }),
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        if (channel === 'session:checkpointReply') {
          listeners.push(listener)
          return
        }
        events.set(channel, [...(events.get(channel) ?? []), listener])
      }),
      removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        const index = listeners.indexOf(listener)
        if (channel === 'session:checkpointReply' && index !== -1) {
          listeners.splice(index, 1)
        }
      })
    },
    fromWebContentsMock: vi.fn((): unknown => null),
    appMock: { focus: vi.fn() },
    createProjectWindowMock: vi.fn(),
    isTrustedUIRendererMock: vi.fn((_sender: unknown) => false),
    getProjectWindowMock: vi.fn((_projectKey: string): unknown => undefined),
    listProjectWindowProjectKeysMock: vi.fn((): string[] => []),
    onProjectWindowRegistryChangedMock: vi.fn((listener: () => void) => {
      changeListeners.push(listener)
      return () => {
        const index = changeListeners.indexOf(listener)
        if (index !== -1) {
          changeListeners.splice(index, 1)
        }
      }
    }),
    rekeyProjectWindowMock: vi.fn((): string => 'rekeyed'),
    registerProjectWindowMock: vi.fn(),
    registryChangeListeners: changeListeners,
    getRoutedMainWindowMock: vi.fn((): unknown => null),
    resolveProjectKeyForWorkspaceKeyMock: vi.fn(
      (workspaceKey: string): string => workspaceKey.split('::')[0]
    ),
    activateWindowMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  app: appMock,
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))
vi.mock('../window/create-project-window', () => ({
  createOrFocusProjectWindow: createProjectWindowMock
}))
vi.mock('../window/project-window-registry', () => ({
  getProjectWindow: getProjectWindowMock,
  listProjectWindowProjectKeys: listProjectWindowProjectKeysMock,
  onProjectWindowRegistryChanged: onProjectWindowRegistryChangedMock,
  rekeyProjectWindow: rekeyProjectWindowMock,
  registerProjectWindow: registerProjectWindowMock
}))
vi.mock('../window/window-affinity-router', () => ({
  getRoutedMainWindow: getRoutedMainWindowMock,
  resolveProjectKeyForWorkspaceKey: resolveProjectKeyForWorkspaceKeyMock
}))
vi.mock('../window/focus-existing-window', () => ({ activateWindow: activateWindowMock }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import {
  registerProjectWindowHandlers,
  PROJECT_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS
} from './project-window'

const mainSender = { id: 1 }
const untrustedSender = { id: 3 }

type TestWindow = {
  isDestroyed: () => boolean
  webContents: {
    id: number
    isDestroyed: () => boolean
    send: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
  }
}

function makeTestWindow(webContentsId = 1): TestWindow {
  return {
    isDestroyed: () => false,
    webContents: {
      id: webContentsId,
      isDestroyed: () => false,
      send: vi.fn(),
      once: vi.fn()
    }
  }
}

function makeMainWindow(): TestWindow {
  return makeTestWindow(1)
}

function sentCheckpointRequestId(mainWindow: TestWindow): string {
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

function fireActiveProjectChanged(sender: unknown, projectKey: unknown): void {
  for (const listener of eventListeners.get('projectWindow:activeProjectChanged') ?? []) {
    listener({ sender }, projectKey)
  }
}

function openProjectsPayloads(window: TestWindow): string[][] {
  return window.webContents.send.mock.calls
    .filter((c: unknown[]) => c[0] === 'projectWindow:openProjectsChanged')
    .map((c: unknown[]) => c[1] as string[])
}

/** Registry fixture: projectKey → owner window, plus the key list the broadcaster reads. */
function stubRegistry(entries: Record<string, TestWindow>): void {
  listProjectWindowProjectKeysMock.mockReturnValue(Object.keys(entries))
  getProjectWindowMock.mockImplementation(
    (projectKey: string) => (entries[projectKey] ?? null) as never
  )
}

describe('registerProjectWindowHandlers', () => {
  const store = { marker: 'store' }

  beforeEach(() => {
    handlers.clear()
    replyListeners.length = 0
    eventListeners.clear()
    registryChangeListeners.length = 0
    isTrustedUIRendererMock.mockImplementation((sender) => sender === mainSender)
    getProjectWindowMock.mockReturnValue(undefined)
    listProjectWindowProjectKeysMock.mockReturnValue([])
    getRoutedMainWindowMock.mockReturnValue(null)
    fromWebContentsMock.mockReturnValue(null)
    rekeyProjectWindowMock.mockReturnValue('rekeyed')
    registerProjectWindowHandlers(store as never)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  it('re-registers idempotently by removing the previous handler first', () => {
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith('projectWindow:open')
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith('projectWindow:raise')
    expect(ipcMainMock.removeAllListeners).toHaveBeenCalledWith(
      'projectWindow:activeProjectChanged'
    )
    expect(handlers.has('projectWindow:open')).toBe(true)
    expect(handlers.has('projectWindow:raise')).toBe(true)

    // Re-registration replaces (not stacks) the registry-change subscription.
    registerProjectWindowHandlers(store as never)
    expect(registryChangeListeners).toHaveLength(1)
  })

  it('opens only for a trusted renderer with a non-empty project key and a valid optional worktree', async () => {
    const open = handlers.get('projectWindow:open')!

    await open({ sender: untrustedSender } as never, 'repo-1')
    await open({ sender: mainSender } as never, '')
    await open({ sender: mainSender } as never, 7)
    await open({ sender: mainSender } as never, undefined)
    await open({ sender: mainSender } as never, 'repo-1', 7)
    await open({ sender: mainSender } as never, 'repo-1', '')
    expect(createProjectWindowMock).not.toHaveBeenCalled()

    createProjectWindowMock.mockReturnValue(makeTestWindow(20))
    await open({ sender: mainSender } as never, 'repo-1')
    expect(createProjectWindowMock).toHaveBeenCalledWith(store, 'repo-1', {
      getKeybindings: expect.any(Function)
    })
  })

  it('forwards the optional initial worktree into the created window options', async () => {
    createProjectWindowMock.mockReturnValue(makeTestWindow(20))

    await handlers.get('projectWindow:open')!(
      { sender: mainSender } as never,
      'repo-1',
      'repo-1::/wt/a'
    )

    expect(createProjectWindowMock).toHaveBeenCalledWith(store, 'repo-1', {
      worktreeId: 'repo-1::/wt/a',
      getKeybindings: expect.any(Function)
    })
  })

  it('routes getKeybindings through the keybinding service overrides', async () => {
    const overrides = { 'zoom.in': ['Mod+Y'] }
    const keybindings = { getOverrides: vi.fn(() => overrides) }
    handlers.clear()
    registerProjectWindowHandlers(store as never, keybindings as never)
    createProjectWindowMock.mockReturnValue(makeTestWindow(20))

    await handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')

    const options = createProjectWindowMock.mock.calls[0]?.[2] as {
      getKeybindings: () => unknown
    }
    expect(options.getKeybindings()).toBe(overrides)
  })

  it('checkpoints the main window session before opening and proceeds on the reply', async () => {
    const mainWindow = makeMainWindow()
    getRoutedMainWindowMock.mockReturnValue(mainWindow)
    createProjectWindowMock.mockReturnValue(makeTestWindow(20))

    const opening = handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')
    const requestId = sentCheckpointRequestId(mainWindow)
    expect(createProjectWindowMock).not.toHaveBeenCalled()

    fireCheckpointReply(mainWindow.webContents, { requestId, ok: true })
    await opening

    expect(createProjectWindowMock).toHaveBeenCalledWith(store, 'repo-1', {
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
    createProjectWindowMock.mockReturnValue(makeTestWindow(20))

    const opening = handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')
    const requestId = sentCheckpointRequestId(mainWindow)

    fireCheckpointReply({ id: 999, isDestroyed: () => false }, { requestId, ok: true })
    fireCheckpointReply(mainWindow.webContents, { requestId: 'someone-elses', ok: true })
    await Promise.resolve()
    expect(createProjectWindowMock).not.toHaveBeenCalled()

    fireCheckpointReply(mainWindow.webContents, { requestId, ok: true })
    await opening
    expect(createProjectWindowMock).toHaveBeenCalledTimes(1)
  })

  it('opens with the stale session when the checkpoint times out', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const mainWindow = makeMainWindow()
      getRoutedMainWindowMock.mockReturnValue(mainWindow)
      createProjectWindowMock.mockReturnValue(makeTestWindow(20))

      const opening = handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')
      expect(createProjectWindowMock).not.toHaveBeenCalled()

      vi.advanceTimersByTime(PROJECT_WINDOW_SESSION_CHECKPOINT_TIMEOUT_MS)
      await opening

      expect(createProjectWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[project-window] session checkpoint timed out; opening with stale session'
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
      createProjectWindowMock.mockReturnValue(makeTestWindow(20))

      const opening = handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')
      fireCheckpointReply(mainWindow.webContents, {
        requestId: sentCheckpointRequestId(mainWindow),
        ok: false
      })
      await opening

      expect(createProjectWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[project-window] session checkpoint failed; opening with stale session'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('opens without a checkpoint when no main window is routed', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      createProjectWindowMock.mockReturnValue(makeTestWindow(20))
      await handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')
      expect(createProjectWindowMock).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith(
        '[project-window] no main window to checkpoint the session; opening with persisted session'
      )
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('skips the checkpoint when the project already has a window (focus path)', async () => {
    const mainWindow = makeMainWindow()
    getRoutedMainWindowMock.mockReturnValue(mainWindow)
    const existing = makeTestWindow(20)
    getProjectWindowMock.mockReturnValue(existing as never)
    createProjectWindowMock.mockReturnValue(existing)

    await handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')

    expect(mainWindow.webContents.send).not.toHaveBeenCalled()
    expect(createProjectWindowMock).toHaveBeenCalledTimes(1)
    // Focus path: no did-finish-load re-send is armed for an already-loaded window.
    expect(existing.webContents.once).not.toHaveBeenCalled()
  })

  it('re-sends the tailored snapshot to a NEW project window on did-finish-load', async () => {
    const projectWindow = makeTestWindow(20)
    createProjectWindowMock.mockReturnValue(projectWindow)

    await handlers.get('projectWindow:open')!({ sender: mainSender } as never, 'repo-1')

    const onceCall = projectWindow.webContents.once.mock.calls.find(
      (c: unknown[]) => c[0] === 'did-finish-load'
    )
    expect(onceCall).toBeDefined()
    stubRegistry({ 'repo-1': projectWindow })
    ;(onceCall![1] as () => void)()
    // Own project excluded: the list is "open in OTHER windows" for this recipient.
    expect(openProjectsPayloads(projectWindow)).toEqual([[]])
  })

  describe('registry change broadcast', () => {
    it("sends per-recipient payloads excluding each window's own projects", () => {
      const mainWindow = makeMainWindow()
      const projectWindowA = makeTestWindow(20)
      const projectWindowB = makeTestWindow(30)
      getRoutedMainWindowMock.mockReturnValue(mainWindow)
      stubRegistry({ 'repo-a': projectWindowA, 'folder:fw-b': projectWindowB })

      for (const listener of registryChangeListeners) {
        listener()
      }

      expect(openProjectsPayloads(mainWindow)).toEqual([['repo-a', 'folder:fw-b']])
      expect(openProjectsPayloads(projectWindowA)).toEqual([['folder:fw-b']])
      expect(openProjectsPayloads(projectWindowB)).toEqual([['repo-a']])
    })

    it('skips destroyed windows without failing the broadcast', () => {
      const mainWindow = makeMainWindow()
      const deadProjectWindow = makeTestWindow(20)
      deadProjectWindow.isDestroyed = () => true
      getRoutedMainWindowMock.mockReturnValue(mainWindow)
      stubRegistry({ 'repo-a': deadProjectWindow })

      for (const listener of registryChangeListeners) {
        listener()
      }

      expect(openProjectsPayloads(mainWindow)).toEqual([['repo-a']])
      expect(deadProjectWindow.webContents.send).not.toHaveBeenCalled()
    })
  })

  describe('projectWindow:raise', () => {
    it('raises the live owner window via the shared cross-platform activate path', async () => {
      const projectWindow = makeTestWindow(20)
      getProjectWindowMock.mockReturnValue(projectWindow as never)

      await handlers.get('projectWindow:raise')!({ sender: mainSender } as never, 'repo-1')

      expect(activateWindowMock).toHaveBeenCalledWith(
        projectWindow,
        appMock,
        process.platform,
        setTimeout
      )
      // Raise-only: the owner window already shows this project's rows, so nothing is forwarded.
      expect(projectWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('never forwards worktree activation into the owner window (raise is sufficient)', async () => {
      const projectWindow = makeTestWindow(20)
      getProjectWindowMock.mockReturnValue(projectWindow as never)

      await handlers.get('projectWindow:raise')!({ sender: mainSender } as never, 'repo-1')

      expect(activateWindowMock).toHaveBeenCalledTimes(1)
      expect(projectWindow.webContents.send).not.toHaveBeenCalled()
    })

    it('rejects untrusted senders and invalid keys, and no-ops without a window', async () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const raise = handlers.get('projectWindow:raise')!
        await raise({ sender: untrustedSender } as never, 'repo-1')
        await raise({ sender: mainSender } as never, '')
        await raise({ sender: mainSender } as never, 7)
        getProjectWindowMock.mockReturnValue(null as never)
        await raise({ sender: mainSender } as never, 'repo-closed')
        expect(activateWindowMock).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })

  describe('projectWindow:activeProjectChanged', () => {
    it('re-keys the sender window and replies with its tailored snapshot', () => {
      const projectWindow = makeTestWindow(20)
      fromWebContentsMock.mockReturnValue(projectWindow)
      rekeyProjectWindowMock.mockReturnValue('rekeyed')
      stubRegistry({ 'repo-2': projectWindow })

      fireActiveProjectChanged(mainSender, 'repo-2')

      expect(rekeyProjectWindowMock).toHaveBeenCalledWith(projectWindow, 'repo-2')
      expect(openProjectsPayloads(projectWindow)).toEqual([[]])
    })

    it('logs and keeps the registry when the target project is owned by another window', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const projectWindow = makeTestWindow(20)
        const otherWindow = makeTestWindow(30)
        fromWebContentsMock.mockReturnValue(projectWindow)
        rekeyProjectWindowMock.mockReturnValue('conflict')
        stubRegistry({ 'repo-owned': otherWindow })

        fireActiveProjectChanged(mainSender, 'repo-owned')

        expect(warnSpy).toHaveBeenCalledWith(
          '[project-window] re-key ignored: project owned by another window',
          'repo-owned'
        )
        // The conflicted sender still gets the snapshot so its raise guard knows the owner.
        expect(openProjectsPayloads(projectWindow)).toEqual([['repo-owned']])
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('registers a not-registered sender (the main window) onto a free project', () => {
      const mainWindow = makeMainWindow()
      fromWebContentsMock.mockReturnValue(mainWindow)
      rekeyProjectWindowMock.mockReturnValue('not-registered')
      getProjectWindowMock.mockReturnValue(undefined)

      fireActiveProjectChanged(mainSender, 'repo-1')

      expect(registerProjectWindowMock).toHaveBeenCalledWith('repo-1', mainWindow)
      // The sender still gets a snapshot so its other-windows set hydrates.
      expect(openProjectsPayloads(mainWindow)).toEqual([[]])
    })

    it('does not register a not-registered sender onto a project owned by another window', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const mainWindow = makeMainWindow()
        const otherWindow = makeTestWindow(2)
        fromWebContentsMock.mockReturnValue(mainWindow)
        rekeyProjectWindowMock.mockReturnValue('not-registered')
        getProjectWindowMock.mockReturnValue(otherWindow)

        fireActiveProjectChanged(mainSender, 'repo-owned')

        expect(registerProjectWindowMock).not.toHaveBeenCalled()
        expect(warnSpy).toHaveBeenCalledWith(
          '[project-window] register ignored: project owned by another window',
          'repo-owned'
        )
      } finally {
        warnSpy.mockRestore()
      }
    })

    it('rejects untrusted senders and invalid project keys before touching the registry', () => {
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        fireActiveProjectChanged(untrustedSender, 'repo-1')
        fireActiveProjectChanged(mainSender, '')
        fireActiveProjectChanged(mainSender, 42)
        expect(rekeyProjectWindowMock).not.toHaveBeenCalled()
      } finally {
        warnSpy.mockRestore()
      }
    })
  })
})
