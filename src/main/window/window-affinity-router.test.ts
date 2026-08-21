import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  _resetWindowAffinityRouterForTest,
  broadcastToAppWindows,
  clearMainWindowForRouting,
  getRoutedMainWindow,
  listAppWindows,
  resolveProjectKeyForWorkspaceKey,
  resolvePtyOwnerWindow,
  resolveWorktreeOwnerWindow,
  sendToPtyOwner,
  sendToWorktreeOwner,
  setMainWindowForRouting,
  setProjectKeyResolverForRouting,
  setPtyWorktreeResolverForRouting
} from './window-affinity-router'
import { registerProjectWindow, unregisterProjectWindow } from './project-window-registry'

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
  const register = (projectKey: string, window: FakeWindow): void => {
    registerProjectWindow(projectKey, asWindow(window))
    registered.push([projectKey, window])
  }

  afterEach(() => {
    for (const [projectKey, window] of registered.splice(0)) {
      unregisterProjectWindow(projectKey, asWindow(window))
    }
    _resetWindowAffinityRouterForTest()
  })

  describe('resolveProjectKeyForWorkspaceKey', () => {
    it('maps folder keys to themselves without consulting the injected resolver', () => {
      const resolver = vi.fn(() => 'never')
      setProjectKeyResolverForRouting(resolver)
      expect(resolveProjectKeyForWorkspaceKey('folder:fw-1')).toBe('folder:fw-1')
      expect(resolver).not.toHaveBeenCalled()
    })

    it('prefers the injected runtime resolver for worktree ids', () => {
      setProjectKeyResolverForRouting((worktreeId) =>
        worktreeId === 'repo-1::/wt' ? 'repo-1' : undefined
      )
      expect(resolveProjectKeyForWorkspaceKey('repo-1::/wt')).toBe('repo-1')
    })

    it('falls back to the repoId prefix parse before injection or on resolver misses', () => {
      expect(resolveProjectKeyForWorkspaceKey('repo-2::/wt')).toBe('repo-2')
      setProjectKeyResolverForRouting(() => undefined)
      expect(resolveProjectKeyForWorkspaceKey('repo-2::/wt')).toBe('repo-2')
      // Separator-less keys own themselves.
      expect(resolveProjectKeyForWorkspaceKey('repo-bare')).toBe('repo-bare')
    })
  })

  it('resolves EVERY worktree of a project to its project window and falls back to main', () => {
    const main = createWindow()
    const projectWindow = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('repo-1', projectWindow)

    expect(resolveWorktreeOwnerWindow('repo-1::/wt/a')).toBe(projectWindow)
    // Sibling worktree of the same project routes to the SAME window (project ownership).
    expect(resolveWorktreeOwnerWindow('repo-1::/wt/b')).toBe(projectWindow)
    expect(resolveWorktreeOwnerWindow('repo-other::/wt')).toBe(main)
    expect(resolveWorktreeOwnerWindow(undefined)).toBe(main)
  })

  it('resolves folder workspace keys to their own project window', () => {
    const main = createWindow()
    const folderWindow = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('folder:fw-1', folderWindow)

    expect(resolveWorktreeOwnerWindow('folder:fw-1')).toBe(folderWindow)
    expect(resolveWorktreeOwnerWindow('folder:fw-other')).toBe(main)
  })

  it('ignores destroyed project and main windows', () => {
    const main = createWindow()
    const deadProjectWindow = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(main))
    register('repo-1', deadProjectWindow)

    expect(resolveWorktreeOwnerWindow('repo-1::/wt')).toBe(main)

    const deadMain = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(deadMain))
    expect(getRoutedMainWindow()).toBeNull()
    expect(resolveWorktreeOwnerWindow('repo-other::/wt')).toBeNull()
  })

  it('resolves a pty through the injected worktree resolver into project ownership', () => {
    const main = createWindow()
    const projectWindow = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('repo-1', projectWindow)
    setPtyWorktreeResolverForRouting((ptyId) => (ptyId === 'pty-owned' ? 'repo-1::/wt' : undefined))

    expect(resolvePtyOwnerWindow('pty-owned')).toBe(projectWindow)
    expect(resolvePtyOwnerWindow('pty-unknown')).toBe(main)

    setPtyWorktreeResolverForRouting(null)
    expect(resolvePtyOwnerWindow('pty-owned')).toBe(main)
  })

  it('sends to the owner window only and reports delivery', () => {
    const main = createWindow()
    const projectWindow = createWindow()
    setMainWindowForRouting(asWindow(main))
    register('repo-1', projectWindow)
    setPtyWorktreeResolverForRouting(() => 'repo-1::/wt')

    expect(sendToPtyOwner('pty-1', 'pty:data', { id: 'pty-1', data: 'x' })).toBe(true)
    expect(projectWindow.webContents.send).toHaveBeenCalledWith('pty:data', {
      id: 'pty-1',
      data: 'x'
    })
    expect(main.webContents.send).not.toHaveBeenCalled()

    expect(
      sendToWorktreeOwner('repo-other::/wt', 'ui:sleepWorktree', { worktreeId: 'repo-other::/wt' })
    ).toBe(true)
    expect(main.webContents.send).toHaveBeenCalledWith('ui:sleepWorktree', {
      worktreeId: 'repo-other::/wt'
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

  it('broadcasts to the main window plus every live project window', () => {
    const main = createWindow()
    const projectWindowA = createWindow()
    const dead = createWindow({ destroyed: true })
    setMainWindowForRouting(asWindow(main))
    register('repo-a', projectWindowA)
    register('repo-dead', dead)

    expect(listAppWindows()).toEqual([main, projectWindowA])
    expect(broadcastToAppWindows('repos:changed')).toBe(true)
    expect(main.webContents.send).toHaveBeenCalledWith('repos:changed')
    expect(projectWindowA.webContents.send).toHaveBeenCalledWith('repos:changed')
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
