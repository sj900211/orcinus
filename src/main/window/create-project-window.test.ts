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

import { createOrFocusProjectWindow } from './create-project-window'
import { getProjectWindow } from './project-window-registry'

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

describe('createOrFocusProjectWindow', () => {
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

  it('creates a deferred-load project window, registers it, and loads the project query param', () => {
    const store = { marker: 'store' }
    const getKeybindings = vi.fn()

    const window = createOrFocusProjectWindow(store as never, 'repo one/1', { getKeybindings })

    expect(createMainWindowMock).toHaveBeenCalledWith(store, {
      role: 'workspace',
      deferLoad: true,
      getKeybindings
    })
    expect(getProjectWindow('repo one/1')).toBe(window)
    expect(loadMainWindowMock).toHaveBeenCalledWith(window, {
      search: 'orca-project=repo%20one%2F1'
    })
  })

  it('appends the optional initial worktree as an orca-worktree param', () => {
    const window = createOrFocusProjectWindow(null, 'repo-1', { worktreeId: 'repo-1::/wt a' })

    expect(loadMainWindowMock).toHaveBeenCalledWith(window, {
      search: 'orca-project=repo-1&orca-worktree=repo-1%3A%3A%2Fwt%20a'
    })
  })

  it('offsets the new window from the focused window bounds', () => {
    getFocusedWindowMock.mockReturnValue({
      getBounds: () => ({ x: 100, y: 50, width: 1280, height: 720 })
    })

    createOrFocusProjectWindow(null, 'repo-2')

    expect(createMainWindowMock).toHaveBeenCalledWith(null, {
      role: 'workspace',
      deferLoad: true,
      initialBounds: { x: 132, y: 82, width: 1280, height: 720 },
      getKeybindings: undefined
    })
  })

  it('focuses the existing window instead of creating a second one', () => {
    const first = createOrFocusProjectWindow(null, 'repo-3')
    const second = createOrFocusProjectWindow(null, 'repo-3')

    expect(second).toBe(first)
    expect(createMainWindowMock).toHaveBeenCalledTimes(1)
    expect(loadMainWindowMock).toHaveBeenCalledTimes(1)
    expect((first as unknown as FakeWindow).focus).toHaveBeenCalledTimes(1)
  })

  it('restores a minimized existing window when re-requested', () => {
    const window = createOrFocusProjectWindow(null, 'repo-4') as unknown as FakeWindow
    window.minimized = true

    createOrFocusProjectWindow(null, 'repo-4')

    expect(window.restore).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
  })

  it('unregisters on close so the next request opens a fresh window', () => {
    const first = createOrFocusProjectWindow(null, 'repo-5') as unknown as FakeWindow
    first.destroyed = true
    first.emit('closed')

    expect(getProjectWindow('repo-5')).toBeNull()

    const second = createOrFocusProjectWindow(null, 'repo-5')
    expect(second).not.toBe(first)
    expect(createMainWindowMock).toHaveBeenCalledTimes(2)
  })
})
