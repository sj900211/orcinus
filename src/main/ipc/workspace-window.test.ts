import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, ipcMainMock, createWorkspaceWindowMock, isTrustedUIRendererMock } = vi.hoisted(
  () => {
    const map = new Map<string, (...args: unknown[]) => unknown>()
    return {
      handlers: map,
      ipcMainMock: {
        removeHandler: vi.fn(),
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => map.set(channel, fn)
      },
      createWorkspaceWindowMock: vi.fn(),
      isTrustedUIRendererMock: vi.fn((_sender: unknown) => false)
    }
  }
)

vi.mock('electron', () => ({ ipcMain: ipcMainMock }))
vi.mock('../window/create-workspace-window', () => ({
  createOrFocusWorkspaceWindow: createWorkspaceWindowMock
}))
vi.mock('./ui', () => ({ isTrustedUIRenderer: isTrustedUIRendererMock }))

import { registerWorkspaceWindowHandlers } from './workspace-window'

const mainSender = { id: 1 }
const untrustedSender = { id: 3 }

describe('registerWorkspaceWindowHandlers', () => {
  const store = { marker: 'store' }

  beforeEach(() => {
    handlers.clear()
    isTrustedUIRendererMock.mockImplementation((sender) => sender === mainSender)
    registerWorkspaceWindowHandlers(store as never)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('re-registers idempotently by removing the previous handler first', () => {
    expect(ipcMainMock.removeHandler).toHaveBeenCalledWith('workspaceWindow:open')
    expect(handlers.has('workspaceWindow:open')).toBe(true)
  })

  it('opens only for a trusted renderer with a non-empty worktree id', () => {
    const open = handlers.get('workspaceWindow:open')!

    open({ sender: untrustedSender } as never, 'wt-1')
    open({ sender: mainSender } as never, '')
    open({ sender: mainSender } as never, 7)
    open({ sender: mainSender } as never, undefined)
    expect(createWorkspaceWindowMock).not.toHaveBeenCalled()

    open({ sender: mainSender } as never, 'wt-1')
    expect(createWorkspaceWindowMock).toHaveBeenCalledWith(store, 'wt-1', {
      getKeybindings: expect.any(Function)
    })
  })

  it('routes getKeybindings through the keybinding service overrides', () => {
    const overrides = { 'zoom.in': ['Mod+Y'] }
    const keybindings = { getOverrides: vi.fn(() => overrides) }
    handlers.clear()
    registerWorkspaceWindowHandlers(store as never, keybindings as never)

    handlers.get('workspaceWindow:open')!({ sender: mainSender } as never, 'wt-1')

    const options = createWorkspaceWindowMock.mock.calls[0]?.[2] as {
      getKeybindings: () => unknown
    }
    expect(options.getKeybindings()).toBe(overrides)
  })
})
