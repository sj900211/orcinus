import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import { hitTestSatelliteAtCursor } from './satellite-window-hit-test'
import {
  registerSatellite,
  resetSatelliteRegistryForTests,
  type SatelliteRecord
} from './satellite-window-registry'

// The registry chain never touches electron VALUES at runtime, so the mock
// only needs the screen module the hit test itself reads.
const cursor = vi.hoisted(() => ({ x: 0, y: 0, unavailable: false }))
vi.mock('electron', () => ({
  screen: {
    getCursorScreenPoint: (): { x: number; y: number } => {
      if (cursor.unavailable) {
        throw new Error('screen not ready')
      }
      return { x: cursor.x, y: cursor.y }
    }
  }
}))

type Bounds = { x: number; y: number; width: number; height: number }

type TestWindow = BrowserWindow & {
  destroyed: boolean
  visible: boolean
  minimized: boolean
  bounds: Bounds
}

function makeWindow(bounds: Bounds = { x: 0, y: 0, width: 100, height: 100 }): TestWindow {
  const window = {
    destroyed: false,
    visible: true,
    minimized: false,
    bounds,
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
    getBounds(): Bounds {
      return window.bounds
    },
    hide: vi.fn(),
    showInactive: vi.fn(),
    minimize: vi.fn(),
    destroy: vi.fn(),
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

let nextId = 0
function makeSatellite(
  parent: TestWindow,
  worktreeId: string,
  bounds: Bounds
): SatelliteRecord & { window: TestWindow } {
  nextId += 1
  const record: SatelliteRecord = {
    satelliteId: `sat-${nextId}`,
    window: makeWindow(bounds),
    parentWindow: parent,
    worktreeId,
    files: [],
    hiddenByWorkspaceSwitch: false,
    hiddenWithParent: false,
    minimizedBeforeHide: false,
    trustedWebContentsId: nextId
  }
  registerSatellite(record)
  return record as SatelliteRecord & { window: TestWindow }
}

afterEach(() => {
  resetSatelliteRegistryForTests()
  cursor.unavailable = false
})

describe('hitTestSatelliteAtCursor', () => {
  it('returns the satellite under the cursor and null on a miss', () => {
    const parent = makeWindow({ x: 0, y: 0, width: 800, height: 600 })
    const satellite = makeSatellite(parent, 'repo::wt-1', {
      x: 1000,
      y: 100,
      width: 400,
      height: 300
    })

    cursor.x = 1200
    cursor.y = 200
    expect(hitTestSatelliteAtCursor(parent)).toEqual({
      satelliteId: satellite.satelliteId,
      worktreeId: 'repo::wt-1'
    })

    cursor.x = 900
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
  })

  it('D21: the parent wins while the cursor is inside its own bounds', () => {
    const parent = makeWindow({ x: 0, y: 0, width: 800, height: 600 })
    makeSatellite(parent, 'repo::wt-1', { x: 700, y: 0, width: 400, height: 300 })

    // Inside both rectangles → parent wins, even if the satellite floats above.
    cursor.x = 750
    cursor.y = 100
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()

    // A minimized parent reports phantom iconic bounds — its guard is skipped.
    parent.minimized = true
    expect(hitTestSatelliteAtCursor(parent)).not.toBeNull()
  })

  it('skips hidden, minimized, invisible and foreign-parent satellites', () => {
    const parent = makeWindow({ x: 0, y: 0, width: 100, height: 100 })
    const otherParent = makeWindow({ x: 0, y: 0, width: 100, height: 100 })
    const bounds = { x: 1000, y: 100, width: 400, height: 300 }
    cursor.x = 1100
    cursor.y = 200

    const record = makeSatellite(parent, 'repo::wt-1', bounds)
    record.hiddenByWorkspaceSwitch = true
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
    record.hiddenByWorkspaceSwitch = false
    record.hiddenWithParent = true
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
    record.hiddenWithParent = false
    record.window.minimized = true
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
    record.window.minimized = false
    record.window.visible = false
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
    record.window.destroyed = true

    makeSatellite(otherParent, 'repo::wt-1', bounds)
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
  })

  it('D21: overlapping satellites resolve by registration order', () => {
    const parent = makeWindow({ x: 0, y: 0, width: 100, height: 100 })
    const first = makeSatellite(parent, 'repo::wt-1', { x: 1000, y: 0, width: 400, height: 300 })
    makeSatellite(parent, 'repo::wt-2', { x: 1100, y: 0, width: 400, height: 300 })

    cursor.x = 1200
    cursor.y = 100
    expect(hitTestSatelliteAtCursor(parent)?.satelliteId).toBe(first.satelliteId)
  })

  it('returns null when the screen module is unavailable', () => {
    const parent = makeWindow({ x: 0, y: 0, width: 100, height: 100 })
    makeSatellite(parent, 'repo::wt-1', { x: 1000, y: 0, width: 400, height: 300 })
    cursor.unavailable = true
    expect(hitTestSatelliteAtCursor(parent)).toBeNull()
  })
})
