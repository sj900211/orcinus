import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  getProjectWindow,
  listProjectWindowProjectKeys,
  onProjectWindowRegistryChanged,
  registerProjectWindow,
  rekeyProjectWindow,
  unregisterProjectWindow,
  unregisterProjectWindowInstance
} from './project-window-registry'

function makeWindow(): BrowserWindow & { destroyed: boolean } {
  const window = {
    destroyed: false,
    isDestroyed(): boolean {
      return window.destroyed
    }
  }
  return window as unknown as BrowserWindow & { destroyed: boolean }
}

const registered: BrowserWindow[] = []

function register(projectKey: string, window: BrowserWindow): void {
  registerProjectWindow(projectKey, window)
  registered.push(window)
}

describe('project-window-registry', () => {
  afterEach(() => {
    // Reset the module-level map between tests (instance-scoped: rekeys may have moved keys).
    for (const window of registered) {
      unregisterProjectWindowInstance(window)
    }
    registered.length = 0
  })

  it('returns a registered live window and null for unknown projects', () => {
    const window = makeWindow()
    register('repo-1', window)

    expect(getProjectWindow('repo-1')).toBe(window)
    expect(getProjectWindow('repo-unknown')).toBeNull()
  })

  it('keys folder workspace projects by their folder: key', () => {
    const window = makeWindow()
    register('folder:fw-1', window)

    expect(getProjectWindow('folder:fw-1')).toBe(window)
  })

  it('returns null for a destroyed window without unregistering a replacement', () => {
    const window = makeWindow()
    register('repo-1', window)
    window.destroyed = true

    expect(getProjectWindow('repo-1')).toBeNull()

    const replacement = makeWindow()
    register('repo-1', replacement)
    // A late 'closed' from the first window must not evict the replacement.
    unregisterProjectWindow('repo-1', window)
    expect(getProjectWindow('repo-1')).toBe(replacement)
  })

  it('refuses a second live registration for the same project (windows <= projects invariant)', () => {
    const window = makeWindow()
    register('repo-1', window)

    // A duplicate live registration means a caller raced past focus-if-exists.
    expect(() => registerProjectWindow('repo-1', makeWindow())).toThrow(
      /duplicate project window registration/
    )
    expect(getProjectWindow('repo-1')).toBe(window)
  })

  it('unregisters only the stored instance', () => {
    const window = makeWindow()
    register('repo-1', window)

    unregisterProjectWindow('repo-1', makeWindow())
    expect(getProjectWindow('repo-1')).toBe(window)

    unregisterProjectWindow('repo-1', window)
    expect(getProjectWindow('repo-1')).toBeNull()
  })

  it('lists only projects whose windows are still live', () => {
    const live = makeWindow()
    const dead = makeWindow()
    register('repo-live', live)
    register('repo-dead', dead)
    dead.destroyed = true

    expect(listProjectWindowProjectKeys()).toEqual(['repo-live'])
  })

  it('notifies registry listeners on register and unregister, and unsubscribe stops them', () => {
    const listener = vi.fn()
    const unsubscribe = onProjectWindowRegistryChanged(listener)
    try {
      const window = makeWindow()
      register('repo-1', window)
      expect(listener).toHaveBeenCalledTimes(1)

      // No membership change (wrong instance) → no notification.
      unregisterProjectWindow('repo-1', makeWindow())
      expect(listener).toHaveBeenCalledTimes(1)

      unregisterProjectWindow('repo-1', window)
      expect(listener).toHaveBeenCalledTimes(2)

      unsubscribe()
      register('repo-1', window)
      expect(listener).toHaveBeenCalledTimes(2)
    } finally {
      unsubscribe()
    }
  })

  it('unregisters every entry owned by a window instance with a single notification', () => {
    const listener = vi.fn()
    const unsubscribe = onProjectWindowRegistryChanged(listener)
    try {
      const window = makeWindow()
      const other = makeWindow()
      register('repo-1', window)
      register('repo-2', window)
      register('repo-other', other)
      listener.mockClear()

      unregisterProjectWindowInstance(window)

      expect(listProjectWindowProjectKeys()).toEqual(['repo-other'])
      expect(listener).toHaveBeenCalledTimes(1)

      // A window with no entries left is a silent no-op.
      unregisterProjectWindowInstance(window)
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      unsubscribe()
    }
  })

  describe('rekeyProjectWindow', () => {
    it('moves the registration to the new project and notifies once', () => {
      const listener = vi.fn()
      const unsubscribe = onProjectWindowRegistryChanged(listener)
      try {
        const window = makeWindow()
        register('repo-old', window)
        listener.mockClear()

        expect(rekeyProjectWindow(window, 'repo-new')).toBe('rekeyed')

        expect(getProjectWindow('repo-old')).toBeNull()
        expect(getProjectWindow('repo-new')).toBe(window)
        expect(listener).toHaveBeenCalledTimes(1)
      } finally {
        unsubscribe()
      }
    })

    it('is a silent noop when the window is already keyed to that project', () => {
      const listener = vi.fn()
      const unsubscribe = onProjectWindowRegistryChanged(listener)
      try {
        const window = makeWindow()
        register('repo-1', window)
        listener.mockClear()

        expect(rekeyProjectWindow(window, 'repo-1')).toBe('noop')
        expect(getProjectWindow('repo-1')).toBe(window)
        expect(listener).not.toHaveBeenCalled()
      } finally {
        unsubscribe()
      }
    })

    it('refuses to steal a project owned by another live window', () => {
      const window = makeWindow()
      const owner = makeWindow()
      register('repo-mine', window)
      register('repo-owned', owner)

      expect(rekeyProjectWindow(window, 'repo-owned')).toBe('conflict')

      expect(getProjectWindow('repo-mine')).toBe(window)
      expect(getProjectWindow('repo-owned')).toBe(owner)
    })

    it('may take over a project whose previous owner window was destroyed', () => {
      const window = makeWindow()
      const deadOwner = makeWindow()
      register('repo-mine', window)
      register('repo-owned', deadOwner)
      deadOwner.destroyed = true

      expect(rekeyProjectWindow(window, 'repo-owned')).toBe('rekeyed')
      expect(getProjectWindow('repo-owned')).toBe(window)
      expect(getProjectWindow('repo-mine')).toBeNull()
    })

    it('rejects windows with no registration at all', () => {
      expect(rekeyProjectWindow(makeWindow(), 'repo-1')).toBe('not-registered')
      expect(getProjectWindow('repo-1')).toBeNull()
    })
  })
})
