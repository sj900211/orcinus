import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  applyParentActiveWorktree,
  getSatellite,
  getSatelliteByWebContents,
  listSatellitesForParent,
  markSatelliteRaised,
  onSatelliteRegistryChanged,
  registerSatellite,
  resetSatelliteRegistryForTests,
  setSatelliteFiles,
  shouldRevealSatelliteOnReady,
  unregisterSatellite,
  type SatelliteRecord
} from './satellite-window-registry'

type TestWindow = BrowserWindow & {
  destroyed: boolean
  visible: boolean
  minimized: boolean
  listeners: Record<string, (() => void)[]>
  hide: ReturnType<typeof vi.fn>
  showInactive: ReturnType<typeof vi.fn>
  minimize: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
}

function makeWindow(): TestWindow {
  const window = {
    destroyed: false,
    visible: true,
    minimized: false,
    listeners: {} as Record<string, (() => void)[]>,
    webContents: {
      isDestroyed: (): boolean => false,
      isLoading: (): boolean => false,
      on: vi.fn(),
      removeListener: vi.fn()
    },
    isDestroyed(): boolean {
      return window.destroyed
    },
    isVisible(): boolean {
      return window.visible
    },
    isMinimized(): boolean {
      return window.minimized
    },
    hide: vi.fn(() => {
      window.visible = false
    }),
    showInactive: vi.fn(() => {
      window.visible = true
    }),
    minimize: vi.fn(() => {
      window.minimized = true
    }),
    destroy: vi.fn((): void => {
      window.destroyed = true
    }),
    close: vi.fn(),
    on(event: string, listener: () => void): void {
      window.listeners[event] = [...(window.listeners[event] ?? []), listener]
    },
    removeListener(event: string, listener: () => void): void {
      const list = window.listeners[event] ?? []
      const index = list.indexOf(listener)
      if (index !== -1) {
        list.splice(index, 1)
      }
    }
  }
  return window as unknown as TestWindow
}

function fire(window: TestWindow, event: string): void {
  for (const listener of window.listeners[event] ?? []) {
    listener()
  }
}

let nextId = 0
function makeRecord(
  parent: TestWindow,
  worktreeId: string,
  window: TestWindow = makeWindow()
): SatelliteRecord {
  nextId += 1
  return {
    satelliteId: `sat-${nextId}`,
    window,
    parentWindow: parent,
    worktreeId,
    files: [],
    hiddenByWorkspaceSwitch: false,
    hiddenWithParent: false,
    minimizedBeforeHide: false,
    trustedWebContentsId: nextId
  }
}

afterEach(() => {
  resetSatelliteRegistryForTests()
})

describe('satellite-window-registry', () => {
  it('registers, resolves by id and by webContents, and refuses duplicate ids', () => {
    const parent = makeWindow()
    const record = makeRecord(parent, 'repo::wt-1')
    registerSatellite(record)

    expect(getSatellite(record.satelliteId)).toBe(record)
    expect(getSatelliteByWebContents(record.window.webContents)).toBe(record)
    expect(() => registerSatellite({ ...record })).toThrow(/duplicate satellite registration/)
  })

  it('returns null for a destroyed satellite and identity-guards unregister', () => {
    const parent = makeWindow()
    const record = makeRecord(parent, 'repo::wt-1')
    registerSatellite(record)
    ;(record.window as TestWindow).destroyed = true
    expect(getSatellite(record.satelliteId)).toBeNull()

    // A late 'closed' from a stale window must not evict a replacement record.
    unregisterSatellite(record.satelliteId, makeWindow())
    ;(record.window as TestWindow).destroyed = false
    expect(getSatellite(record.satelliteId)).toBe(record)
  })

  it('skips the registry notify when a reported file list is unchanged', () => {
    const events: string[] = []
    const parent = makeWindow()
    const record = makeRecord(parent, 'repo::wt-1')
    registerSatellite(record)
    const off = onSatelliteRegistryChanged(() => events.push('changed'))

    const files = [
      { fileId: 'f', filePath: 'C:\\a.ts', relativePath: 'a.ts', language: 'typescript' }
    ]
    setSatelliteFiles(record.satelliteId, files)
    setSatelliteFiles(record.satelliteId, [
      { fileId: 'f', filePath: 'C:\\a.ts', relativePath: 'a.ts', language: 'typescript' }
    ])

    expect(events).toHaveLength(1)
    off()
  })

  it('installs ONE hook set per parent and removes it with the last satellite', () => {
    const parent = makeWindow()
    const first = makeRecord(parent, 'repo::wt-1')
    const second = makeRecord(parent, 'repo::wt-2')

    registerSatellite(first)
    registerSatellite(second)
    expect(parent.listeners['closed']).toHaveLength(1)
    expect(parent.listeners['hide']).toHaveLength(1)
    expect(parent.listeners['show']).toHaveLength(1)

    unregisterSatellite(first.satelliteId, first.window)
    expect(parent.listeners['closed']).toHaveLength(1)

    unregisterSatellite(second.satelliteId, second.window)
    expect(parent.listeners['closed']).toHaveLength(0)
    expect(parent.listeners['hide']).toHaveLength(0)
  })

  it('parent close cascades to every live satellite, hidden ones included', () => {
    const parent = makeWindow()
    const visible = makeRecord(parent, 'repo::wt-1')
    const hidden = makeRecord(parent, 'repo::wt-2')
    registerSatellite(visible)
    registerSatellite(hidden)
    ;(hidden.window as TestWindow).visible = false
    hidden.hiddenByWorkspaceSwitch = true

    fire(parent, 'closed')

    // 5-8 C3/C11: non-quit cascade uses bypass+close() so the renderer's
    // beforeunload still stages the final snapshot before the window dies.
    expect((visible.window as TestWindow).close).toHaveBeenCalledTimes(1)
    expect((hidden.window as TestWindow).close).toHaveBeenCalledTimes(1)
  })

  it('follows a parent tray-hide down and back up, respecting worktree subordination', () => {
    const parent = makeWindow()
    const matching = makeRecord(parent, 'repo::wt-active')
    const other = makeRecord(parent, 'repo::wt-other')
    registerSatellite(matching)
    registerSatellite(other)
    applyParentActiveWorktree(parent, 'repo::wt-active')
    expect(other.hiddenByWorkspaceSwitch).toBe(true)

    fire(parent, 'hide')
    expect(matching.hiddenWithParent).toBe(true)
    expect((matching.window as TestWindow).hide).toHaveBeenCalledTimes(1)

    fire(parent, 'show')
    expect(matching.hiddenWithParent).toBe(false)
    expect((matching.window as TestWindow).showInactive).toHaveBeenCalledTimes(1)
    // Still subordinated to the other worktree — must NOT reappear.
    expect((other.window as TestWindow).showInactive).not.toHaveBeenCalled()
  })

  it('hides mismatched satellites on a workspace switch and reveals them without focus on return', () => {
    const parent = makeWindow()
    const kept = makeRecord(parent, 'repo::wt-active')
    const other = makeRecord(parent, 'repo::wt-other')
    registerSatellite(kept)
    registerSatellite(other)

    applyParentActiveWorktree(parent, 'repo::wt-active')
    expect((other.window as TestWindow).hide).toHaveBeenCalledTimes(1)
    expect(other.hiddenByWorkspaceSwitch).toBe(true)
    expect((kept.window as TestWindow).hide).not.toHaveBeenCalled()

    applyParentActiveWorktree(parent, 'repo::wt-other')
    expect((other.window as TestWindow).showInactive).toHaveBeenCalledTimes(1)
    expect(other.hiddenByWorkspaceSwitch).toBe(false)
    expect((kept.window as TestWindow).hide).toHaveBeenCalledTimes(1)
  })

  it('flags a still-invisible (booting) satellite on a mismatched switch so ready-to-show stays quiet', () => {
    const parent = makeWindow()
    const booting = makeRecord(parent, 'repo::wt-a')
    ;(booting.window as TestWindow).visible = false
    registerSatellite(booting)

    applyParentActiveWorktree(parent, 'repo::wt-b')

    expect(booting.hiddenByWorkspaceSwitch).toBe(true)
    expect((booting.window as TestWindow).hide).not.toHaveBeenCalled()
    expect(shouldRevealSatelliteOnReady(booting.satelliteId)).toBe(false)
  })

  it('hides a minimized satellite on switch and restores it minimized on return (owner verification)', () => {
    const parent = makeWindow()
    const record = makeRecord(parent, 'repo::wt-a')
    // win32 semantics: a minimized window still reports isVisible() === true.
    ;(record.window as TestWindow).minimized = true
    registerSatellite(record)

    applyParentActiveWorktree(parent, 'repo::wt-b')
    expect(record.hiddenByWorkspaceSwitch).toBe(true)
    expect((record.window as TestWindow).hide).toHaveBeenCalledTimes(1)

    applyParentActiveWorktree(parent, 'repo::wt-a')
    expect(record.hiddenByWorkspaceSwitch).toBe(false)
    // Restored to the taskbar minimized — never raised, never lost.
    expect((record.window as TestWindow).minimize).toHaveBeenCalledTimes(1)
    expect((record.window as TestWindow).showInactive).not.toHaveBeenCalled()
  })

  it('subordinates at registration when the parent already reported another worktree', () => {
    const parent = makeWindow()
    applyParentActiveWorktree(parent, 'repo::wt-current')

    const stale = makeRecord(parent, 'repo::wt-elsewhere')
    registerSatellite(stale)

    expect(stale.hiddenByWorkspaceSwitch).toBe(true)
    expect(shouldRevealSatelliteOnReady(stale.satelliteId)).toBe(false)

    const matching = makeRecord(parent, 'repo::wt-current')
    registerSatellite(matching)
    expect(shouldRevealSatelliteOnReady(matching.satelliteId)).toBe(true)
  })

  it('clears both subordination flags on a deliberate raise', () => {
    const parent = makeWindow()
    const record = makeRecord(parent, 'repo::wt-a')
    registerSatellite(record)
    record.hiddenByWorkspaceSwitch = true
    record.hiddenWithParent = true

    markSatelliteRaised(record.satelliteId)

    expect(record.hiddenByWorkspaceSwitch).toBe(false)
    expect(record.hiddenWithParent).toBe(false)
  })

  it('scopes parent listings to the instance and filters destroyed windows', () => {
    const parentA = makeWindow()
    const parentB = makeWindow()
    const a1 = makeRecord(parentA, 'repo::wt-1')
    const a2 = makeRecord(parentA, 'repo::wt-2')
    const b1 = makeRecord(parentB, 'repo::wt-1')
    registerSatellite(a1)
    registerSatellite(a2)
    registerSatellite(b1)
    ;(a2.window as TestWindow).destroyed = true

    expect(listSatellitesForParent(parentA)).toEqual([a1])
    expect(listSatellitesForParent(parentB)).toEqual([b1])
  })
})
