import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handlers,
  eventListeners,
  ipcMainMock,
  fromWebContentsMock,
  appMock,
  createSatelliteWindowMock,
  isTrustedUIRendererMock,
  getSatelliteMock,
  getSatelliteByWebContentsMock,
  listSatellitesForParentMock,
  markSatelliteRaisedMock,
  onSatelliteRegistryChangedMock,
  registryChangeListeners,
  setSatelliteFilesMock,
  applyParentActiveWorktreeMock,
  listAppWindowsMock,
  activateWindowMock
} = vi.hoisted(() => {
  const map = new Map<string, (...args: unknown[]) => unknown>()
  const events = new Map<string, ((...args: unknown[]) => void)[]>()
  const changeListeners: (() => void)[] = []
  return {
    handlers: map,
    eventListeners: events,
    ipcMainMock: {
      removeHandler: vi.fn((channel: string) => map.delete(channel)),
      removeAllListeners: vi.fn((channel: string) => {
        events.delete(channel)
      }),
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn),
      on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
        events.set(channel, [...(events.get(channel) ?? []), listener])
      })
    },
    fromWebContentsMock: vi.fn((): unknown => null),
    appMock: { focus: vi.fn() },
    createSatelliteWindowMock: vi.fn(),
    isTrustedUIRendererMock: vi.fn((_sender: unknown) => true),
    getSatelliteMock: vi.fn((_satelliteId: string): unknown => null),
    getSatelliteByWebContentsMock: vi.fn((_sender: unknown): unknown => null),
    listSatellitesForParentMock: vi.fn((_target: unknown): unknown[] => []),
    markSatelliteRaisedMock: vi.fn(),
    onSatelliteRegistryChangedMock: vi.fn((listener: () => void) => {
      changeListeners.push(listener)
      return () => {
        const index = changeListeners.indexOf(listener)
        if (index !== -1) {
          changeListeners.splice(index, 1)
        }
      }
    }),
    registryChangeListeners: changeListeners,
    setSatelliteFilesMock: vi.fn(),
    applyParentActiveWorktreeMock: vi.fn(),
    listAppWindowsMock: vi.fn((): unknown[] => []),
    activateWindowMock: vi.fn()
  }
})

vi.mock('electron', () => ({
  ipcMain: ipcMainMock,
  app: appMock,
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))
vi.mock('../window/create-satellite-window', () => ({
  createSatelliteWindow: createSatelliteWindowMock
}))
vi.mock('../window/satellite-window-registry', () => ({
  applyParentActiveWorktree: applyParentActiveWorktreeMock,
  getSatellite: getSatelliteMock,
  getSatelliteByWebContents: getSatelliteByWebContentsMock,
  listSatellitesForParent: listSatellitesForParentMock,
  markSatelliteRaised: markSatelliteRaisedMock,
  onSatelliteRegistryChanged: onSatelliteRegistryChangedMock,
  setSatelliteFiles: setSatelliteFilesMock
}))
vi.mock('../window/window-affinity-router', () => ({ listAppWindows: listAppWindowsMock }))
vi.mock('../window/focus-existing-window', () => ({ activateWindow: activateWindowMock }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import { registerSatelliteWindowHandlers } from './satellite-window'

type TestRecord = {
  satelliteId: string
  worktreeId: string
  files: { fileId: string; filePath: string }[]
  hiddenByWorkspaceSwitch: boolean
  hiddenWithParent: boolean
  minimizedBeforeHide: boolean
  window: {
    isDestroyed: () => boolean
    close: ReturnType<typeof vi.fn>
    destroy: ReturnType<typeof vi.fn>
    webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
  }
}

function makeRecord(satelliteId: string, worktreeId = 'repo::wt-1'): TestRecord {
  return {
    satelliteId,
    worktreeId,
    files: [],
    hiddenByWorkspaceSwitch: false,
    hiddenWithParent: false,
    minimizedBeforeHide: false,
    window: {
      isDestroyed: () => false,
      close: vi.fn(),
      destroy: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() }
    }
  }
}

function makeCreatedWindow(): {
  on: ReturnType<typeof vi.fn>
  webContents: {
    on: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
    isCrashed: () => boolean
  }
} {
  return {
    on: vi.fn(),
    webContents: { on: vi.fn(), send: vi.fn(), isDestroyed: () => false, isCrashed: () => false }
  }
}

const bootFile = { filePath: 'C:\\repo\\a.ts', relativePath: 'a.ts', language: 'typescript' }
const parentSender = { id: 1 }

function emit(channel: string, ...args: unknown[]): void {
  for (const listener of eventListeners.get(channel) ?? []) {
    listener(...args)
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  handlers.clear()
  eventListeners.clear()
  registryChangeListeners.length = 0
  isTrustedUIRendererMock.mockReturnValue(true)
  getSatelliteByWebContentsMock.mockReturnValue(null)
  registerSatelliteWindowHandlers()
})

describe('satelliteWindow:open', () => {
  it('creates a satellite for a trusted parent and returns its id', () => {
    const parent = { id: 'parent-window' }
    fromWebContentsMock.mockReturnValue(parent)
    createSatelliteWindowMock.mockReturnValue({ satelliteId: 'sat-1', window: makeCreatedWindow() })

    const result = handlers.get('satelliteWindow:open')!(
      { sender: parentSender },
      'repo::wt-1',
      bootFile
    )

    expect(createSatelliteWindowMock).toHaveBeenCalledWith(parent, 'repo::wt-1', bootFile)
    expect(result).toEqual({ satelliteId: 'sat-1' })
  })

  it('rejects untrusted senders, satellite senders, and malformed payloads', () => {
    isTrustedUIRendererMock.mockReturnValue(false)
    expect(
      handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)
    ).toBeNull()

    isTrustedUIRendererMock.mockReturnValue(true)
    // Why: satellites are trusted renderers too — a satellite-of-satellite would
    // be invisible to every mirror and never subordinated.
    getSatelliteByWebContentsMock.mockReturnValue(makeRecord('sat-x'))
    expect(
      handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)
    ).toBeNull()

    getSatelliteByWebContentsMock.mockReturnValue(null)
    expect(handlers.get('satelliteWindow:open')!({ sender: parentSender }, '', bootFile)).toBeNull()
    expect(
      handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', {
        filePath: 'x'
      })
    ).toBeNull()
    expect(createSatelliteWindowMock).not.toHaveBeenCalled()
  })

  it('re-queues pushes after a satellite renderer navigation (reload) un-readies it', () => {
    const parent = { id: 'parent-window' }
    fromWebContentsMock.mockReturnValue(parent)
    const created = makeCreatedWindow()
    createSatelliteWindowMock.mockReturnValue({ satelliteId: 'sat-1', window: created })
    void handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)

    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    void handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', bootFile)
    expect(record.window.webContents.send).toHaveBeenCalledTimes(1)

    // Main-frame navigation (View→Reload) invalidates ready.
    const navListener = created.webContents.on.mock.calls.find(
      (call) => call[0] === 'did-start-navigation'
    )?.[1] as (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
    navListener({}, 'app://reload', false, true)

    void handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', bootFile)
    expect(record.window.webContents.send).toHaveBeenCalledTimes(1)

    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    expect(record.window.webContents.send).toHaveBeenCalledTimes(2)
  })
})

describe('satelliteWindow:moveFile and the boot queue', () => {
  it('queues pushes until the satellite reports ready, then flushes in order', () => {
    const record = makeRecord('sat-1')
    getSatelliteMock.mockImplementation((id: string) => (id === 'sat-1' ? record : null))

    void handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', bootFile)
    expect(record.window.webContents.send).not.toHaveBeenCalled()

    getSatelliteByWebContentsMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })

    expect(record.window.webContents.send).toHaveBeenCalledWith('satellite:openFile', bootFile)
  })

  it('sends immediately once ready', () => {
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })

    void handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', bootFile)

    expect(record.window.webContents.send).toHaveBeenCalledWith('satellite:openFile', bootFile)
  })
})

describe('satelliteWindow:raise', () => {
  it('tolerates a stale mirror and raises live satellites via the registry flag reset', () => {
    getSatelliteMock.mockReturnValue(null)
    void handlers.get('satelliteWindow:raise')!({ sender: parentSender }, 'gone')
    expect(activateWindowMock).not.toHaveBeenCalled()

    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:raise')!({ sender: parentSender }, 'sat-1')

    expect(markSatelliteRaisedMock).toHaveBeenCalledWith('sat-1')
    expect(activateWindowMock).toHaveBeenCalledWith(
      record.window,
      appMock,
      process.platform,
      setTimeout
    )
  })
})

describe('satelliteWindow:reportOpenFiles', () => {
  it('updates the registry mirror and closes an emptied satellite (owner decision D1)', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    const files = [{ fileId: 'f1', filePath: 'C:\\repo\\a.ts' }]
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, files, 1)
    expect(setSatelliteFilesMock).toHaveBeenCalledWith('sat-1', files)
    expect(record.window.close).not.toHaveBeenCalled()

    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 0)
    expect(record.window.close).toHaveBeenCalledTimes(1)
  })

  it('keeps a satellite alive while a non-edit surface remains (empty mirror, surfaces > 0)', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 1)
    expect(setSatelliteFilesMock).toHaveBeenCalledWith('sat-1', [])
    expect(record.window.close).not.toHaveBeenCalled()
  })

  it('falls back to the mirror length when the count is missing or malformed', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [])
    expect(record.window.close).toHaveBeenCalledTimes(1)
  })

  it('ignores unknown senders and malformed lists', () => {
    getSatelliteByWebContentsMock.mockReturnValue(null)
    emit('satelliteWindow:reportOpenFiles', { sender: {} }, [])
    expect(setSatelliteFilesMock).not.toHaveBeenCalled()

    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [{ bad: true }])
    expect(setSatelliteFilesMock).not.toHaveBeenCalled()
  })
})

describe('native close intercept (dirty drain)', () => {
  function openSatellite(): {
    created: ReturnType<typeof makeCreatedWindow>
    closeListener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
  } {
    fromWebContentsMock.mockReturnValue({ id: 'parent-window' })
    const created = makeCreatedWindow()
    createSatelliteWindowMock.mockReturnValue({ satelliteId: 'sat-1', window: created })
    void handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)
    const closeListener = created.on.mock.calls.find(
      (call) => call[0] === 'close'
    )?.[1] as (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    return { created, closeListener }
  }

  it('intercepts the close only while the renderer reports dirty files', () => {
    const { created, closeListener } = openSatellite()
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    // No dirty report yet (boot phase) - close passes through untouched.
    const bootEvent = { preventDefault: vi.fn() }
    closeListener(bootEvent)
    expect(bootEvent.preventDefault).not.toHaveBeenCalled()

    const files = [{ fileId: 'f1', filePath: 'C:\\repo\\a.ts' }]
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, files, 1, 1)
    const vetoEvent = { preventDefault: vi.fn() }
    closeListener(vetoEvent)
    expect(vetoEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(created.webContents.send).toHaveBeenCalledWith('satelliteWindow:closeRequested')

    // Dirtiness settled - the next close passes again.
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, files, 1, 0)
    const cleanEvent = { preventDefault: vi.fn() }
    closeListener(cleanEvent)
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled()
  })

  it('never intercepts a crashed renderer (window must stay closable)', () => {
    const { created, closeListener } = openSatellite()
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 1, 3)

    created.webContents.isCrashed = () => true
    const event = { preventDefault: vi.fn() }
    closeListener(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('a renderer reload resets the dirty gate (stale dirtiness must not wedge the close)', () => {
    const { created, closeListener } = openSatellite()
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 1, 2)

    const navListener = created.webContents.on.mock.calls.find(
      (call) => call[0] === 'did-start-navigation'
    )?.[1] as (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
    navListener({}, 'app://reload', false, true)

    const event = { preventDefault: vi.fn() }
    closeListener(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('confirmClose destroys the drained satellite', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    emit('satelliteWindow:confirmClose', { sender: record.window.webContents })
    expect(record.window.destroy).toHaveBeenCalledTimes(1)
  })
})

describe('satelliteWindow:activeWorktreeChanged', () => {
  it('applies subordination for the sender window', () => {
    const parent = { id: 'parent-window' }
    fromWebContentsMock.mockReturnValue(parent)

    emit('satelliteWindow:activeWorktreeChanged', { sender: parentSender }, 'repo::wt-2')

    expect(applyParentActiveWorktreeMock).toHaveBeenCalledWith(parent, 'repo::wt-2')
  })

  it('rejects untrusted senders', () => {
    isTrustedUIRendererMock.mockReturnValue(false)
    emit('satelliteWindow:activeWorktreeChanged', { sender: parentSender }, 'repo::wt-2')
    expect(applyParentActiveWorktreeMock).not.toHaveBeenCalled()
  })
})

describe('mirror broadcast', () => {
  it('sends each app window only ITS satellites with flag-derived visibility', () => {
    const parentA = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() }
    }
    const parentB = {
      isDestroyed: () => false,
      webContents: { isDestroyed: () => false, send: vi.fn() }
    }
    listAppWindowsMock.mockReturnValue([parentA, parentB])
    const record = makeRecord('sat-1')
    record.files = [{ fileId: 'f1', filePath: 'C:\\repo\\a.ts' }]
    record.hiddenByWorkspaceSwitch = true
    listSatellitesForParentMock.mockImplementation((target: unknown) =>
      target === parentA ? [record] : []
    )

    for (const listener of registryChangeListeners) {
      listener()
    }

    expect(parentA.webContents.send).toHaveBeenCalledWith('satelliteWindow:mirrorChanged', [
      {
        satelliteId: 'sat-1',
        worktreeId: 'repo::wt-1',
        visible: false,
        files: record.files
      }
    ])
    expect(parentB.webContents.send).toHaveBeenCalledWith('satelliteWindow:mirrorChanged', [])
  })
})
