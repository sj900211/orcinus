import { afterEach, describe, expect, it } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  getWorkspaceWindow,
  listWorkspaceWindowWorktreeIds,
  registerWorkspaceWindow,
  unregisterWorkspaceWindow
} from './workspace-window-registry'

function makeWindow(): BrowserWindow & { destroyed: boolean } {
  const window = {
    destroyed: false,
    isDestroyed(): boolean {
      return window.destroyed
    }
  }
  return window as unknown as BrowserWindow & { destroyed: boolean }
}

const registered: [string, BrowserWindow][] = []

function register(worktreeId: string, window: BrowserWindow): void {
  registerWorkspaceWindow(worktreeId, window)
  registered.push([worktreeId, window])
}

describe('workspace-window-registry', () => {
  afterEach(() => {
    // Reset the module-level map between tests.
    for (const [worktreeId, window] of registered) {
      unregisterWorkspaceWindow(worktreeId, window)
    }
    registered.length = 0
  })

  it('returns a registered live window and null for unknown worktrees', () => {
    const window = makeWindow()
    register('wt-1', window)

    expect(getWorkspaceWindow('wt-1')).toBe(window)
    expect(getWorkspaceWindow('wt-unknown')).toBeNull()
  })

  it('returns null for a destroyed window without unregistering a replacement', () => {
    const window = makeWindow()
    register('wt-1', window)
    window.destroyed = true

    expect(getWorkspaceWindow('wt-1')).toBeNull()

    const replacement = makeWindow()
    register('wt-1', replacement)
    // A late 'closed' from the first window must not evict the replacement.
    unregisterWorkspaceWindow('wt-1', window)
    expect(getWorkspaceWindow('wt-1')).toBe(replacement)
  })

  it('unregisters only the stored instance', () => {
    const window = makeWindow()
    register('wt-1', window)

    unregisterWorkspaceWindow('wt-1', makeWindow())
    expect(getWorkspaceWindow('wt-1')).toBe(window)

    unregisterWorkspaceWindow('wt-1', window)
    expect(getWorkspaceWindow('wt-1')).toBeNull()
  })

  it('lists only worktrees whose windows are still live', () => {
    const live = makeWindow()
    const dead = makeWindow()
    register('wt-live', live)
    register('wt-dead', dead)
    dead.destroyed = true

    expect(listWorkspaceWindowWorktreeIds()).toEqual(['wt-live'])
  })
})
