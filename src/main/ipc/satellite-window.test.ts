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
  getParentLastActiveWorktreeMock,
  isAppQuittingMock,
  storeStubMock,
  onSatelliteRegistryChangedMock,
  onParentRendererNavigationMock,
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
    getParentLastActiveWorktreeMock: vi.fn((_parent: unknown): string | null => null),
    isAppQuittingMock: vi.fn((): boolean => false),
    storeStubMock: {
      getSatelliteWindowSessions: vi.fn((): unknown[] => []),
      setSatelliteWindowSession: vi.fn(),
      removeSatelliteWindowSession: vi.fn(),
      removeSatelliteWindowSessionsForWorktree: vi.fn()
    },
    onParentRendererNavigationMock: vi.fn((_listener: unknown) => () => {}),
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
  getParentLastActiveWorktree: getParentLastActiveWorktreeMock,
  getSatellite: getSatelliteMock,
  getSatelliteByWebContents: getSatelliteByWebContentsMock,
  listSatellitesForParent: listSatellitesForParentMock,
  markSatelliteRaised: markSatelliteRaisedMock,
  onSatelliteRegistryChanged: onSatelliteRegistryChangedMock,
  onParentRendererNavigation: onParentRendererNavigationMock,
  setSatelliteFiles: setSatelliteFilesMock
}))
vi.mock('../window/window-affinity-router', () => ({ listAppWindows: listAppWindowsMock }))
vi.mock('../window/focus-existing-window', () => ({ activateWindow: activateWindowMock }))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))
vi.mock('../app-quit-state', () => ({ isAppQuitting: isAppQuittingMock }))

import { registerSatelliteWindowHandlers } from './satellite-window'

type TestRecord = {
  satelliteId: string
  worktreeId: string
  files: { fileId: string; filePath: string; relativePath: string; language: string }[]
  parentWindow: {
    isDestroyed: () => boolean
    webContents: {
      id: number
      isDestroyed: () => boolean
      isCrashed: () => boolean
      send: ReturnType<typeof vi.fn>
    }
  }
  hiddenByWorkspaceSwitch: boolean
  hiddenWithParent: boolean
  minimizedBeforeHide: boolean
  window: {
    isDestroyed: () => boolean
    isMinimized: () => boolean
    isVisible: () => boolean
    getBounds: () => { x: number; y: number; width: number; height: number }
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
    parentWindow: {
      isDestroyed: () => false,
      webContents: { id: 77, isDestroyed: () => false, isCrashed: () => false, send: vi.fn() }
    },
    hiddenByWorkspaceSwitch: false,
    hiddenWithParent: false,
    minimizedBeforeHide: false,
    window: {
      isDestroyed: () => false,
      isMinimized: () => false,
      isVisible: () => true,
      getBounds: () => ({ x: 10, y: 20, width: 800, height: 600 }),
      close: vi.fn(),
      destroy: vi.fn(),
      webContents: { isDestroyed: () => false, send: vi.fn() }
    }
  }
}

function makeCreatedWindow(): {
  on: ReturnType<typeof vi.fn>
  prependListener: ReturnType<typeof vi.fn>
  webContents: {
    on: ReturnType<typeof vi.fn>
    send: ReturnType<typeof vi.fn>
    isDestroyed: () => boolean
    isCrashed: () => boolean
  }
} {
  return {
    on: vi.fn(),
    prependListener: vi.fn(),
    webContents: { on: vi.fn(), send: vi.fn(), isDestroyed: () => false, isCrashed: () => false }
  }
}

const bootFile = { filePath: 'C:\\repo\\a.ts', relativePath: 'a.ts', language: 'typescript' }
const parentSender = { id: 1 }
const ENTRY_A = {
  fileId: 'f1',
  filePath: 'C:\\repo\\a.ts',
  relativePath: 'a.ts',
  language: 'typescript'
}

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
  registerSatelliteWindowHandlers(storeStubMock as never)
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

describe('satelliteWindow:moveFile ok contract (D14)', () => {
  it('returns ok:false for a stale satellite and ok:true after queueing', () => {
    getSatelliteMock.mockReturnValue(null)
    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'gone', bootFile)
    ).toEqual({ ok: false })

    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', bootFile)
    ).toEqual({ ok: true })
  })

  it('accepts a rich moved-file payload and rejects malformed extras', () => {
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })

    const moved = {
      ...bootFile,
      dirtyDraftContent: 'draft text',
      lastKnownDiskSignature: 'sig',
      cursorLine: 12,
      scrollTop: 340,
      selections: [
        {
          selectionStartLineNumber: 1,
          selectionStartColumn: 2,
          positionLineNumber: 3,
          positionColumn: 4
        }
      ],
      markdownViewMode: 'rich'
    }
    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', moved)
    ).toEqual({ ok: true })
    expect(record.window.webContents.send).toHaveBeenCalledWith('satellite:openFile', moved)

    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', {
        ...bootFile,
        selections: [{ bad: true }]
      })
    ).toEqual({ ok: false })
  })
})

describe('satelliteWindow:activateFile (interception raise)', () => {
  it('raises and pushes only when the live registry still holds the file', () => {
    const record = makeRecord('sat-1')
    record.files = [
      {
        fileId: 'C:\\repo\\a.ts',
        filePath: 'C:\\repo\\a.ts',
        relativePath: 'a.ts',
        language: 'typescript'
      }
    ]
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })

    expect(
      handlers.get('satelliteWindow:activateFile')!({ sender: parentSender }, 'sat-1', bootFile)
    ).toEqual({ ok: true })
    expect(markSatelliteRaisedMock).toHaveBeenCalledWith('sat-1')
    expect(record.window.webContents.send).toHaveBeenCalledWith('satellite:openFile', bootFile)
  })

  it('refuses a stale-mirror activation (file no longer in the registry)', () => {
    const record = makeRecord('sat-1')
    record.files = []
    getSatelliteMock.mockReturnValue(record)

    expect(
      handlers.get('satelliteWindow:activateFile')!({ sender: parentSender }, 'sat-1', bootFile)
    ).toEqual({ ok: false })
    expect(markSatelliteRaisedMock).not.toHaveBeenCalled()
  })
})

describe('satelliteWindow:moveFileBack (D6 return)', () => {
  it('routes the payload to the parent and raises it for the active worktree', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    getParentLastActiveWorktreeMock.mockReturnValue('repo::wt-1')

    void handlers.get('satelliteWindow:getMirror')!({ sender: { id: 77 } })
    const moved = { ...bootFile, dirtyDraftContent: 'draft', lastKnownDiskSignature: 'sig' }
    expect(
      handlers.get('satelliteWindow:moveFileBack')!({ sender: record.window.webContents }, moved)
    ).toEqual({ ok: true })
    expect(record.parentWindow.webContents.send).toHaveBeenCalledWith('satellite:filesMovedBack', {
      worktreeId: 'repo::wt-1',
      files: [moved]
    })
    expect(activateWindowMock).toHaveBeenCalledWith(
      record.parentWindow,
      appMock,
      process.platform,
      setTimeout
    )
  })

  it('does not raise the parent for a background worktree and fails on a dead parent', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    getParentLastActiveWorktreeMock.mockReturnValue('repo::wt-OTHER')

    void handlers.get('satelliteWindow:getMirror')!({ sender: { id: 77 } })
    expect(
      handlers.get('satelliteWindow:moveFileBack')!({ sender: record.window.webContents }, bootFile)
    ).toEqual({ ok: true })
    expect(activateWindowMock).not.toHaveBeenCalled()

    const dead = makeRecord('sat-2')
    dead.parentWindow.isDestroyed = () => true
    getSatelliteByWebContentsMock.mockReturnValue(dead)
    expect(
      handlers.get('satelliteWindow:moveFileBack')!({ sender: dead.window.webContents }, bootFile)
    ).toEqual({ ok: false })
  })
})

describe('satelliteWindow:moveFileBack readiness guard', () => {
  it('keeps the satellite tab while the parent renderer never fetched the mirror', () => {
    const record = makeRecord('sat-1')
    record.parentWindow.webContents.id = 99
    getSatelliteByWebContentsMock.mockReturnValue(record)

    expect(
      handlers.get('satelliteWindow:moveFileBack')!({ sender: record.window.webContents }, bootFile)
    ).toEqual({ ok: false })
    expect(record.parentWindow.webContents.send).not.toHaveBeenCalled()
  })
})

describe('satelliteWindow:getMirror (late-subscriber snapshot)', () => {
  it('returns the mirror entries for the requesting window', () => {
    const target = { id: 'parent-window' }
    fromWebContentsMock.mockReturnValue(target)
    const record = makeRecord('sat-1')
    record.files = [
      { fileId: 'f1', filePath: 'C:\\repo\\a.ts', relativePath: 'a.ts', language: 'typescript' }
    ]
    listSatellitesForParentMock.mockReturnValue([record])

    expect(handlers.get('satelliteWindow:getMirror')!({ sender: parentSender })).toEqual([
      {
        satelliteId: 'sat-1',
        worktreeId: 'repo::wt-1',
        visible: true,
        files: record.files
      }
    ])
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

    const files = [
      { fileId: 'f1', filePath: 'C:\\repo\\a.ts', relativePath: 'a.ts', language: 'typescript' }
    ]
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

describe('dirty-block close intercept (spec revision 5-7)', () => {
  function openSatellite(): {
    created: ReturnType<typeof makeCreatedWindow>
    record: TestRecord
    closeListener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    closedListener: () => void
  } {
    fromWebContentsMock.mockReturnValue({ id: 'parent-window' })
    // A previous openSatellite in the same test left a record mapped to the
    // parent sender - the satellite-of-satellite guard would reject the open.
    getSatelliteByWebContentsMock.mockReturnValue(null)
    const created = makeCreatedWindow()
    createSatelliteWindowMock.mockReturnValue({ satelliteId: 'sat-1', window: created })
    void handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    const closeListener = created.on.mock.calls.find(
      (call) => call[0] === 'close'
    )?.[1] as (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    const closedListener = created.prependListener.mock.calls.find(
      (call) => call[0] === 'closed'
    )?.[1] as () => void
    return { created, record, closeListener, closedListener }
  }

  it('blocks a dirty close, allows a clean one, and removes the restore entry on clean user close', () => {
    const { created, record, closeListener, closedListener } = openSatellite()
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })

    const files = [ENTRY_A]
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, files, 1, 2)
    const vetoEvent = { preventDefault: vi.fn() }
    closeListener(vetoEvent)
    expect(vetoEvent.preventDefault).toHaveBeenCalledTimes(1)
    expect(created.webContents.send).toHaveBeenCalledWith('satelliteWindow:closeRequested')

    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, files, 1, 0)
    const cleanEvent = { preventDefault: vi.fn() }
    closeListener(cleanEvent)
    expect(cleanEvent.preventDefault).not.toHaveBeenCalled()

    closedListener()
    expect(storeStubMock.removeSatelliteWindowSession).toHaveBeenCalledWith('sat-1')
  })

  it('keeps the restore entry for unready and quitting deaths', () => {
    const first = openSatellite()
    // Boot phase: never became ready - the entry must survive for restore.
    const bootEvent = { preventDefault: vi.fn() }
    first.closeListener(bootEvent)
    expect(bootEvent.preventDefault).not.toHaveBeenCalled()
    first.closedListener()
    expect(storeStubMock.removeSatelliteWindowSession).not.toHaveBeenCalled()

    const second = openSatellite()
    void handlers.get('satelliteWindow:ready')!({ sender: second.record.window.webContents })
    emit('satelliteWindow:reportOpenFiles', { sender: second.record.window.webContents }, [], 1, 0)
    isAppQuittingMock.mockReturnValue(true)
    const quitEvent = { preventDefault: vi.fn() }
    second.closeListener(quitEvent)
    expect(quitEvent.preventDefault).not.toHaveBeenCalled()
    second.closedListener()
    expect(storeStubMock.removeSatelliteWindowSession).not.toHaveBeenCalled()
  })

  it('never blocks a crashed renderer (window must stay closable)', () => {
    const { created, record, closeListener } = openSatellite()
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 1, 3)

    created.webContents.isCrashed = () => true
    const event = { preventDefault: vi.fn() }
    closeListener(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})

describe('spec-revision 5-8 lifecycle fixes', () => {
  function openWired(): {
    created: ReturnType<typeof makeCreatedWindow>
    record: TestRecord
    closeListener: (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    closedListener: () => void
    navListener: (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
  } {
    fromWebContentsMock.mockReturnValue({ id: 'parent-window' })
    getSatelliteByWebContentsMock.mockReturnValue(null)
    const created = makeCreatedWindow()
    createSatelliteWindowMock.mockReturnValue({ satelliteId: 'sat-1', window: created })
    void handlers.get('satelliteWindow:open')!({ sender: parentSender }, 'repo::wt-1', bootFile)
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    const closeListener = created.on.mock.calls.find(
      (call) => call[0] === 'close'
    )?.[1] as (event: { preventDefault: ReturnType<typeof vi.fn> }) => void
    const closedListener = created.prependListener.mock.calls.find(
      (call) => call[0] === 'closed'
    )?.[1] as () => void
    const navListener = created.webContents.on.mock.calls.find(
      (call) => call[0] === 'did-start-navigation'
    )?.[1] as (event: unknown, url: string, isInPlace: boolean, isMainFrame: boolean) => void
    return { created, record, closeListener, closedListener, navListener }
  }

  it('re-pushes the persisted entry on a RELOAD navigation (not the boot load)', () => {
    const { record, navListener } = openWired()
    const moved = { ...bootFile, dirtyDraftContent: 'draft', lastKnownDiskSignature: 'sig' }
    storeStubMock.getSatelliteWindowSessions.mockReturnValue([
      { satelliteId: 'sat-1', worktreeId: 'repo::wt-1', files: [moved] }
    ])

    // Boot load: nothing re-pushed.
    navListener({}, 'app://boot', false, true)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    record.window.webContents.send.mockClear()

    // User reload: entry files queue while unready, flush on the next ready.
    navListener({}, 'app://reload', false, true)
    expect(record.window.webContents.send).not.toHaveBeenCalled()
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    expect(record.window.webContents.send).toHaveBeenCalledWith('satellite:openFile', moved)
  })

  it('bypass-marked close passes a dirty satellite and keeps its restore entry', async () => {
    const { record, closeListener, closedListener, navListener } = openWired()
    navListener({}, 'app://boot', false, true)
    void handlers.get('satelliteWindow:ready')!({ sender: record.window.webContents })
    emit('satelliteWindow:reportOpenFiles', { sender: record.window.webContents }, [], 1, 5)

    const { markSatelliteCloseBypass } = await import('./satellite-window-lifecycle')
    markSatelliteCloseBypass('sat-1')
    const event = { preventDefault: vi.fn() }
    closeListener(event)
    expect(event.preventDefault).not.toHaveBeenCalled()
    closedListener()
    expect(storeStubMock.removeSatelliteWindowSession).not.toHaveBeenCalled()
  })

  it('bootFailed drops the restore entry and reveals the hidden window', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)

    emit('satelliteWindow:bootFailed', { sender: record.window.webContents })
    expect(storeStubMock.removeSatelliteWindowSession).toHaveBeenCalledWith('sat-1')
    expect(markSatelliteRaisedMock).toHaveBeenCalledWith('sat-1')
  })

  it('ignores stage snapshots while queued pushes are undelivered', () => {
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    getSatelliteByWebContentsMock.mockReturnValue(record)
    const moved = { ...bootFile, dirtyDraftContent: 'draft', lastKnownDiskSignature: 'sig' }
    // Not ready: the push queues.
    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', moved)
    ).toEqual({ ok: true })
    storeStubMock.setSatelliteWindowSession.mockClear()

    emit('satelliteWindow:stageSession', { sender: record.window.webContents }, [bootFile])
    expect(storeStubMock.setSatelliteWindowSession).not.toHaveBeenCalled()
  })
})

describe('satelliteWindow:stageSession (restore snapshot)', () => {
  it('persists staged files with the window bounds (async and sync paths)', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    const moved = { ...bootFile, dirtyDraftContent: 'draft', lastKnownDiskSignature: 'sig' }

    emit('satelliteWindow:stageSession', { sender: record.window.webContents }, [moved])
    expect(storeStubMock.setSatelliteWindowSession).toHaveBeenCalledWith({
      satelliteId: 'sat-1',
      worktreeId: 'repo::wt-1',
      files: [moved],
      bounds: { x: 10, y: 20, width: 800, height: 600 }
    })

    storeStubMock.setSatelliteWindowSession.mockClear()
    const syncEvent = { sender: record.window.webContents, returnValue: undefined as unknown }
    emit('satelliteWindow:stageSessionSync', syncEvent, [moved])
    expect(syncEvent.returnValue).toBe(true)
    expect(storeStubMock.setSatelliteWindowSession).toHaveBeenCalledTimes(1)
  })

  it('rejects malformed payloads', () => {
    const record = makeRecord('sat-1')
    getSatelliteByWebContentsMock.mockReturnValue(record)
    emit('satelliteWindow:stageSession', { sender: record.window.webContents }, 'nope')
    expect(storeStubMock.setSatelliteWindowSession).not.toHaveBeenCalled()
  })
})

describe('moveFile seeds the restore snapshot (queued-draft safety)', () => {
  it('upserts the pushed payload into the persisted satellite entry', () => {
    const record = makeRecord('sat-1')
    getSatelliteMock.mockReturnValue(record)
    const moved = { ...bootFile, dirtyDraftContent: 'draft', lastKnownDiskSignature: 'sig' }

    expect(
      handlers.get('satelliteWindow:moveFile')!({ sender: parentSender }, 'sat-1', moved)
    ).toEqual({ ok: true })
    expect(storeStubMock.setSatelliteWindowSession).toHaveBeenCalledWith({
      satelliteId: 'sat-1',
      worktreeId: 'repo::wt-1',
      files: [moved]
    })
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
    record.files = [
      { fileId: 'f1', filePath: 'C:\\repo\\a.ts', relativePath: 'a.ts', language: 'typescript' }
    ]
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
