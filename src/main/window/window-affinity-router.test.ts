import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  _resetWindowAffinityRouterForTest,
  broadcastToAppWindows,
  clearMainWindowForRouting,
  getRoutedMainWindow,
  listAppWindows,
  resolvePtyOwnerWindow,
  resolveWorktreeOwnerWindow,
  sendToPtyOwner,
  sendToWorktreeOwner,
  setMainWindowForRouting,
  setPtyWorktreeResolverForRouting
} from './window-affinity-router'
import { registerWorkspaceWindow, unregisterWorkspaceWindow } from './workspace-window-registry'

type FakeWindow = {
  isDestroyed: () => boolean
  webContents: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
}

function createWindow(overrides: { destroyed?: boolean } = {}): FakeWindow {
  return {
    isDestroyed: () => overrides.destroyed === true,
    webContents: { isDestroyed: () => false, send: vi.fn() }
  }
}

const asWindow = (window: FakeWindow): BrowserWindow => window as unknown as BrowserWindow

describe('window-affinity-router', () => {
  const registered: [string, FakeWindow][] = []
  const register = (worktreeId: string, window: FakeWindow): void => {
    registerWorkspaceWindow(worktreeId, asWindow(window))
    registered.push([worktreeId, window])
  }

  afterEach(() => {
    for (const [worktreeId, window] of registered.splice(0)) {
      unregisterWorkspaceWindow(worktreeId, asWindow(window))
    }
    _resetWindowAffinityRouterForTest()
  })

  it('resolves a worktree to its workspace window and falls back to the main window', () => {
    const main = createWindow()
    const workspace = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('wt-1', workspace)

    expect(resolveWorktreeOwnerWindow('wt-1')).toBe(workspace)
    expect(resolveWorktreeOwnerWindow('wt-other')).toBe(main)
    expect(resolveWorktreeOwnerWindow(undefined)).toBe(main)
  })

  it('ignores destroyed workspace and main windows', () => {
    const main = createWindow()
    const deadWorkspace = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(main))
    register('wt-1', deadWorkspace)

    expect(resolveWorktreeOwnerWindow('wt-1')).toBe(main)

    const deadMain = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(deadMain))
    expect(getRoutedMainWindow()).toBeNull()
    expect(resolveWorktreeOwnerWindow('wt-other')).toBeNull()
  })

  it('resolves a pty through the injected worktree resolver', () => {
    const main = createWindow()
    const workspace = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('wt-1', workspace)
    setPtyWorktreeResolverForRouting((ptyId) => (ptyId === 'pty-owned' ? 'wt-1' : undefined))

    expect(resolvePtyOwnerWindow('pty-owned')).toBe(workspace)
    expect(resolvePtyOwnerWindow('pty-unknown')).toBe(main)

    setPtyWorktreeResolverForRouting(null)
    expect(resolvePtyOwnerWindow('pty-owned')).toBe(main)
  })

  it('sends to the owner window only and reports delivery', () => {
    const main = createWindow()
    const workspace = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('wt-1', workspace)
    setPtyWorktreeResolverForRouting(() => 'wt-1')

    expect(sendToPtyOwner('pty-1', 'pty:data', { id: 'pty-1', data: 'x' })).toBe(true)
    expect(workspace.webContents.send).toHaveBeenCalledWith('pty:data', { id: 'pty-1', data: 'x' })
    expect(main.webContents.send).not.toHaveBeenCalled()

    expect(sendToWorktreeOwner('wt-other', 'ui:sleepWorktree', { worktreeId: 'wt-other' })).toBe(
      true
    )
    expect(main.webContents.send).toHaveBeenCalledWith('ui:sleepWorktree', {
      worktreeId: 'wt-other'
    })
  })

  it('returns false when no live window can receive the send', () => {
    expect(sendToWorktreeOwner(undefined, 'ui:anything')).toBe(false)

    const throwing = createWindow()
    throwing.webContents.send.mockImplementation(() => {
      throw new Error('disposed frame')
    })
    setMainWindowForRouting(asWindow(throwing))
    expect(sendToWorktreeOwner(undefined, 'ui:anything')).toBe(false)
  })

  it('broadcasts to the main window plus every live workspace window', () => {
    const main = createWindow()
    const workspaceA = createWindow()
    const dead = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(main))
    register('wt-a', workspaceA)
    register('wt-dead', dead)

    expect(listAppWindows()).toEqual([main, workspaceA])
    expect(broadcastToAppWindows('repos:changed')).toBe(true)
    expect(main.webContents.send).toHaveBeenCalledWith('repos:changed')
    expect(workspaceA.webContents.send).toHaveBeenCalledWith('repos:changed')
    expect(dead.webContents.send).not.toHaveBeenCalled()
  })

  it('only clears the routed main window for the window that registered it', () => {
    const oldMain = createWindow()
    const newMain = createWindow()
    setMainWindowForRouting(asWindow(oldMain))
    setMainWindowForRouting(asWindow(newMain))

    // A late 'closed' from the replaced window must not evict its replacement.
    clearMainWindowForRouting(asWindow(oldMain))
    expect(getRoutedMainWindow()).toBe(newMain)

    clearMainWindowForRouting(asWindow(newMain))
    expect(getRoutedMainWindow()).toBeNull()
  })
})
