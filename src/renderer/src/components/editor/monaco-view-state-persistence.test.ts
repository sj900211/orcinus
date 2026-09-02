import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { editor, ISelection } from 'monaco-editor'
import { editorSelectionCache, scrollTopCache } from '@/lib/scroll-cache'
import {
  flushLiveMonacoViewState,
  installMonacoViewStateTracking,
  reapplyMonacoViewState,
  registerMonacoViewStateFlush,
  registerMonacoViewStateReapply,
  restoreMonacoViewState,
  scheduleLiveMonacoViewStateReapply,
  snapshotMonacoViewState
} from './monaco-view-state-persistence'

const selections: readonly ISelection[] = [
  {
    selectionStartLineNumber: 2,
    selectionStartColumn: 4,
    positionLineNumber: 5,
    positionColumn: 7
  },
  {
    selectionStartLineNumber: 9,
    selectionStartColumn: 3,
    positionLineNumber: 7,
    positionColumn: 2
  }
]

beforeEach(() => {
  editorSelectionCache.clear()
  scrollTopCache.clear()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Monaco view state persistence', () => {
  it('restores selected ranges and their direction after a tab remount', () => {
    const sourceEditor = {
      getScrollTop: () => 320,
      getSelections: () => selections
    } as unknown as editor.IStandaloneCodeEditor
    snapshotMonacoViewState({ current: sourceEditor }, 'file.ts::tab-1')

    const setSelections = vi.fn()
    const setScrollTop = vi.fn()
    const focus = vi.fn()
    const remountedEditor = {
      setSelections,
      setScrollTop,
      focus
    } as unknown as editor.IStandaloneCodeEditor
    restoreMonacoViewState(remountedEditor, 'file.ts::tab-1')

    expect(setSelections).toHaveBeenCalledWith(selections)
    expect(setScrollTop).toHaveBeenCalledWith(320)
    expect(focus).toHaveBeenCalledOnce()
  })

  it('defers selection caching until the lifecycle snapshot', () => {
    let emitCursorPosition:
      | ((event: { position: { lineNumber: number; column: number } }) => void)
      | undefined
    const editorInstance = {
      getPosition: () => ({ lineNumber: 1, column: 1 }),
      onDidChangeCursorPosition: (
        listener: (event: { position: { lineNumber: number; column: number } }) => void
      ) => {
        emitCursorPosition = listener
        return { dispose: vi.fn() }
      },
      onDidScrollChange: () => ({ dispose: vi.fn() })
    } as unknown as editor.IStandaloneCodeEditor
    const setEditorCursorLine = vi.fn()

    installMonacoViewStateTracking({
      editorInstance,
      filePath: 'file.ts',
      viewStateKey: 'file.ts::tab-1',
      scrollThrottleTimerRef: { current: null },
      setEditorCursorLine
    })
    emitCursorPosition?.({ position: { lineNumber: 12, column: 3 } })

    expect(setEditorCursorLine).toHaveBeenLastCalledWith('file.ts', 12)
    expect(editorSelectionCache.size).toBe(0)
  })
})

describe('live view-state flush registry (dungeon-6 cursor fix)', () => {
  it('flushes the mounted editor into the caches on demand and unregisters cleanly', () => {
    const liveEditor = {
      getScrollTop: () => 42,
      getSelections: () => selections
    } as unknown as editor.IStandaloneCodeEditor
    const unregister = registerMonacoViewStateFlush('file.ts::tab-9', () =>
      snapshotMonacoViewState({ current: liveEditor }, 'file.ts::tab-9')
    )

    flushLiveMonacoViewState('file.ts::tab-9')
    expect(editorSelectionCache.get('file.ts::tab-9')).toEqual(selections)
    expect(scrollTopCache.get('file.ts::tab-9')).toBe(42)

    unregister()
    editorSelectionCache.clear()
    flushLiveMonacoViewState('file.ts::tab-9')
    flushLiveMonacoViewState('missing')
    expect(editorSelectionCache.get('file.ts::tab-9')).toBeUndefined()
  })

  it('a stale unregister does not evict a newer registration for the same key', () => {
    const first = vi.fn()
    const second = vi.fn()
    const unregisterFirst = registerMonacoViewStateFlush('k', first)
    const unregisterSecond = registerMonacoViewStateFlush('k', second)
    unregisterFirst()
    flushLiveMonacoViewState('k')
    expect(second).toHaveBeenCalledOnce()
    expect(first).not.toHaveBeenCalled()
    unregisterSecond()
  })
})

describe('late-seed reapply (dungeon-6 cursor fix, round 2)', () => {
  it('reapplies seeded selections and scroll to a mounted editor without focusing', () => {
    const setSelections = vi.fn()
    const setScrollTop = vi.fn()
    const focus = vi.fn()
    const mounted = {
      setSelections,
      setScrollTop,
      focus
    } as unknown as editor.IStandaloneCodeEditor
    editorSelectionCache.set('file.ts::tab-1', selections as never)
    scrollTopCache.set('file.ts::tab-1', 88)

    reapplyMonacoViewState(mounted, 'file.ts::tab-1')
    expect(setSelections).toHaveBeenCalledWith(selections)
    expect(setScrollTop).toHaveBeenCalledWith(88)
    expect(focus).not.toHaveBeenCalled()
  })

  it('schedules the registered reapply after the current task, no-op when unmounted', async () => {
    vi.useFakeTimers()
    try {
      const reapply = vi.fn()
      const unregister = registerMonacoViewStateReapply('k', reapply)
      scheduleLiveMonacoViewStateReapply('k')
      expect(reapply).not.toHaveBeenCalled()
      vi.runAllTimers()
      expect(reapply).toHaveBeenCalledOnce()

      unregister()
      scheduleLiveMonacoViewStateReapply('k')
      vi.runAllTimers()
      expect(reapply).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
