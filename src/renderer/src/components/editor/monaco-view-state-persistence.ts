import type { MutableRefObject } from 'react'
import type { editor } from 'monaco-editor'
import { editorSelectionCache, scrollTopCache, setWithLRU } from '@/lib/scroll-cache'

type MonacoViewStateTrackingParams = {
  editorInstance: editor.IStandaloneCodeEditor
  filePath: string
  viewStateKey: string
  scrollThrottleTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>
  setEditorCursorLine: (fileId: string, line: number) => void
}

export function installMonacoViewStateTracking(params: MonacoViewStateTrackingParams): {
  cursorPositionSub: { dispose: () => void }
  scrollStateSub: { dispose: () => void }
} {
  const { editorInstance, filePath, viewStateKey, scrollThrottleTimerRef, setEditorCursorLine } =
    params

  // Track cursor line for "copy path to line" feature
  const pos = editorInstance.getPosition()
  if (pos) {
    setEditorCursorLine(filePath, pos.lineNumber)
  }
  const cursorPositionSub = editorInstance.onDidChangeCursorPosition((e) => {
    setEditorCursorLine(filePath, e.position.lineNumber)
  })

  // Why: only the resting scroll position matters, so trailing-throttle writes (~150ms) instead of writing every 60fps frame.
  const scrollStateSub = editorInstance.onDidScrollChange((e) => {
    if (scrollThrottleTimerRef.current !== null) {
      clearTimeout(scrollThrottleTimerRef.current)
    }
    scrollThrottleTimerRef.current = setTimeout(() => {
      setWithLRU(scrollTopCache, viewStateKey, e.scrollTop)
      scrollThrottleTimerRef.current = null
    }, 150)
  })

  return { cursorPositionSub, scrollStateSub }
}

export function restoreMonacoViewState(
  editorInstance: editor.IStandaloneCodeEditor,
  viewStateKey: string
): void {
  const savedSelections = editorSelectionCache.get(viewStateKey)
  const savedScrollTop = scrollTopCache.get(viewStateKey)
  if (savedScrollTop !== undefined || savedSelections) {
    // Why: Monaco renders synchronously so one RAF suffices; focus inside it to avoid a scroll-0 flash before restore.
    requestAnimationFrame(() => {
      if (savedSelections) {
        editorInstance.setSelections(savedSelections)
      }
      if (savedScrollTop !== undefined) {
        editorInstance.setScrollTop(savedScrollTop)
      }
      editorInstance.focus()
    })
  } else {
    editorInstance.focus()
  }
}

// Why: takes the ref, not the instance — the caller runs this from an effect cleanup, where reading `.current` inline trips the ref-in-cleanup lint.
export function snapshotMonacoViewState(
  editorRef: MutableRefObject<editor.IStandaloneCodeEditor | null>,
  viewStateKey: string
): void {
  const ed = editorRef.current
  if (ed) {
    setWithLRU(scrollTopCache, viewStateKey, ed.getScrollTop())
    const selections = ed.getSelections()
    if (selections) {
      setWithLRU(editorSelectionCache, viewStateKey, selections)
    }
  }
}

// Live-editor flush registry (dungeon-6 cursor fix): editorSelectionCache is
// otherwise written only by the UNMOUNT snapshot, so capturing a still-mounted
// (actively edited) tab shipped stale/absent selections — and the destination
// places the caret ONLY from selections. TRUE-move captures flush first.
const liveViewStateFlushByKey = new Map<string, () => void>()

export function registerMonacoViewStateFlush(viewStateKey: string, flush: () => void): () => void {
  liveViewStateFlushByKey.set(viewStateKey, flush)
  return () => {
    // Identity-guarded: a stale unregister must not evict a newer mount.
    if (liveViewStateFlushByKey.get(viewStateKey) === flush) {
      liveViewStateFlushByKey.delete(viewStateKey)
    }
  }
}

/** Flush the LIVE mounted editor's selections+scroll for this key into the
 *  caches. No-op when no editor is mounted under the key. */
export function flushLiveMonacoViewState(viewStateKey: string): void {
  liveViewStateFlushByKey.get(viewStateKey)?.()
}

/** Focus-free re-apply for an ALREADY-MOUNTED editor. Why it exists: restore
 *  is otherwise mount-once — a seed landing AFTER mount (new-satellite boot
 *  race: the boot tab mounts clean before the queued move push applies) was
 *  never consumed. Never focuses: Move Back can target a hidden-but-mounted
 *  background-worktree editor and must not steal keyboard focus. */
export function reapplyMonacoViewState(
  editorInstance: editor.IStandaloneCodeEditor,
  viewStateKey: string
): void {
  const savedSelections = editorSelectionCache.get(viewStateKey)
  const savedScrollTop = scrollTopCache.get(viewStateKey)
  if (savedSelections) {
    editorInstance.setSelections(savedSelections)
  }
  if (savedScrollTop !== undefined) {
    editorInstance.setScrollTop(savedScrollTop)
  }
}

const liveViewStateReapplyByKey = new Map<string, () => void>()

export function registerMonacoViewStateReapply(
  viewStateKey: string,
  reapply: () => void
): () => void {
  liveViewStateReapplyByKey.set(viewStateKey, reapply)
  return () => {
    if (liveViewStateReapplyByKey.get(viewStateKey) === reapply) {
      liveViewStateReapplyByKey.delete(viewStateKey)
    }
  }
}

/** Schedule a seed re-apply on the mounted editor AFTER the current task:
 *  the seeding store write triggers a React commit whose content-sync bridge
 *  can full-range-replace disk→draft (resetting the caret) — a 0ms timer runs
 *  after that commit and its layout effects. No-op when nothing is mounted. */
export function scheduleLiveMonacoViewStateReapply(viewStateKey: string): void {
  if (!liveViewStateReapplyByKey.has(viewStateKey)) {
    return
  }
  setTimeout(() => {
    liveViewStateReapplyByKey.get(viewStateKey)?.()
  }, 0)
}
