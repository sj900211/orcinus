import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { createMainWindowMock, loadMainWindowMock, getFocusedWindowMock } = vi.hoisted(() => ({
  createMainWindowMock: vi.fn(),
  loadMainWindowMock: vi.fn(),
  getFocusedWindowMock: vi.fn((): unknown => null)
}))

vi.mock('electron', () => ({
  BrowserWindow: { getFocusedWindow: getFocusedWindowMock }
}))
vi.mock('./createMainWindow', () => ({
  createMainWindow: createMainWindowMock,
  loadMainWindow: loadMainWindowMock
}))

import { createOrFocusWorkspaceWindow } from './create-workspace-window'
import { getWorkspaceWindow } from './workspace-window-registry'

type FakeWindow = {
  destroyed: boolean
  minimized: boolean
  isDestroyed: () => boolean
  isMinimized: () => boolean
  restore: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  emit: (event: string) => void
}

function makeFakeWindow(): FakeWindow {
  const handlers: Record<string, ((...args: unknown[]) => void)[]> = {}
  const window: FakeWindow = {
    destroyed: false,
    minimized: false,
    isDestroyed: () => window.destroyed,
    isMinimized: () => window.minimized,
    restore: vi.fn(() => {
      window.minimized = false
    }),
    focus: vi.fn(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      ;(handlers[event] ||= []).push(cb)
    }),
    emit: (event: string) => {
      for (const cb of handlers[event] ?? []) {
        cb()
      }
    }
  }
  return window
}

const openWindows: FakeWindow[] = []

describe('createOrFocusWorkspaceWindow', () => {
  beforeEach(() => {
    createMainWindowMock.mockImplementation(() => {
      const window = makeFakeWindow()
      openWindows.push(window)
      return window
    })
  })

  afterEach(() => {
    // Reset the module-level registry between tests by closing every created window.
    for (const window of openWindows) {
      window.destroyed = true
      window.emit('closed')
    }
    openWindows.length = 0
    vi.clearAllMocks()
    getFocusedWindowMock.mockReturnValue(null)
  })

  it('creates a deferred-load workspace window, registers it, and loads the worktree query param', () => {
    const store = { marker: 'store' }
    const getKeybindings = vi.fn()

    const window = createOrFocusWorkspaceWindow(store as never, 'wt one/1', { getKeybindings })

    expect(createMainWindowMock).toHaveBeenCalledWith(store, {
      role: 'workspace',
      deferLoad: true,
      getKeybindings
    })
    expect(getWorkspaceWindow('wt one/1')).toBe(window)
    expect(loadMainWindowMock).toHaveBeenCalledWith(window, {
      search: 'orca-worktree=wt%20one%2F1'
    })
  })

  it('offsets the new window from the focused window bounds', () => {
    getFocusedWindowMock.mockReturnValue({
      getBounds: () => ({ x: 100, y: 50, width: 1280, height: 720 })
    })

    createOrFocusWorkspaceWindow(null, 'wt-2')

    expect(createMainWindowMock).toHaveBeenCalledWith(null, {
      role: 'workspace',
      deferLoad: true,
      initialBounds: { x: 132, y: 82, width: 1280, height: 720 },
      getKeybindings: undefined
    })
  })

  it('focuses the existing window instead of creating a second one', () => {
    const first = createOrFocusWorkspaceWindow(null, 'wt-3')
    const second = createOrFocusWorkspaceWindow(null, 'wt-3')

    expect(second).toBe(first)
    expect(createMainWindowMock).toHaveBeenCalledTimes(1)
    expect(loadMainWindowMock).toHaveBeenCalledTimes(1)
    expect((first as unknown as FakeWindow).focus).toHaveBeenCalledTimes(1)
  })

  it('restores a minimized existing window when re-requested', () => {
    const window = createOrFocusWorkspaceWindow(null, 'wt-4') as unknown as FakeWindow
    window.minimized = true

    createOrFocusWorkspaceWindow(null, 'wt-4')

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('unregisters on close so the next request opens a fresh window', () => {
    const first = createOrFocusWorkspaceWindow(null, 'wt-5') as unknown as FakeWindow
    first.destroyed = true
    first.emit('closed')

    expect(getWorkspaceWindow('wt-5')).toBeNull()

    const second = createOrFocusWorkspaceWindow(null, 'wt-5')
    expect(second).not.toBe(first)
    expect(createMainWindowMock).toHaveBeenCalledTimes(2)
  })
})
