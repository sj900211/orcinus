import type { SatelliteMovedFile } from '../../../shared/satellite-window-payloads'
import { flushPendingEditorChange } from '@/components/editor/editor-pending-flush'
import { useAppStore } from '@/store'

// Continuous satellite session staging (spec revision 5-7): main persists the
// latest snapshot per satellite so a restart restores the window with its
// files and dirty drafts. Debounced on store changes; beforeunload runs a
// SYNCHRONOUS final stage (app:stage-before-unload-sync precedent) so
// close/reload/quit never lose keystrokes newer than the debounce — which is
// also why the old dirty beforeunload VETO is gone: a veto during quit would
// strand the quitting flags (recon-verified hazard class).
const STAGE_DEBOUNCE_MS = 500

export function buildSatelliteSessionFiles(): SatelliteMovedFile[] {
  // Why flush first (owner-found reload bug): the rich markdown editor (and
  // ipynb) serialize input into editorDrafts on a DEBOUNCE — reading the store
  // without flushing stages a snapshot that misses the latest keystrokes, and
  // a reload then restores pre-typing content. Plain Monaco writes drafts
  // synchronously, so this is a no-op there. (The move capture path gets the
  // same guarantee via quiesce.)
  for (const file of useAppStore.getState().openFiles) {
    if (file.mode === 'edit' && file.isDirty) {
      flushPendingEditorChange(file.id)
    }
  }
  const state = useAppStore.getState()
  return state.openFiles
    .filter((file) => file.mode === 'edit')
    .map((file) => ({
      filePath: file.filePath,
      relativePath: file.relativePath,
      language: file.language,
      // Why together-or-not-at-all: restore arms the disk-baseline
      // verification gate only when both exist (hydrate-session contract).
      ...(file.isDirty && state.editorDrafts[file.id] !== undefined
        ? {
            dirtyDraftContent: state.editorDrafts[file.id],
            ...(file.lastKnownDiskSignature !== undefined
              ? { lastKnownDiskSignature: file.lastKnownDiskSignature }
              : {})
          }
        : {}),
      ...(state.editorCursorLine[file.id] !== undefined
        ? { cursorLine: state.editorCursorLine[file.id] }
        : {}),
      ...(state.markdownViewMode[file.id] !== undefined
        ? { markdownViewMode: state.markdownViewMode[file.id] }
        : {})
    }))
}

// Post-review C4: a satellite showing ONLY non-edit surfaces (markdown
// preview) stages an empty edit list — persisting it would erase the entry the
// close policy protects in-session. Keep the last non-empty snapshot instead.
function shouldSkipEmptyStage(files: SatelliteMovedFile[]): boolean {
  return files.length === 0 && useAppStore.getState().openFiles.length > 0
}

export function stageSatelliteSessionSyncNow(): void {
  try {
    const files = buildSatelliteSessionFiles()
    if (shouldSkipEmptyStage(files)) {
      return
    }
    window.api.satelliteWindow.stageSessionSync?.(files)
  } catch {
    // A failed final stage must never block the unload path.
  }
}

export function startSatelliteSessionStaging(): () => void {
  let timer: number | null = null
  const stage = (): void => {
    timer = null
    const files = buildSatelliteSessionFiles()
    if (shouldSkipEmptyStage(files)) {
      return
    }
    window.api.satelliteWindow.stageSession?.(files)
  }
  const schedule = (): void => {
    if (timer !== null) {
      window.clearTimeout(timer)
    }
    timer = window.setTimeout(stage, STAGE_DEBOUNCE_MS)
  }
  // Initial stage: a freshly booted/restored satellite must appear in the
  // persisted list even before the first edit.
  schedule()
  const unsubscribe = useAppStore.subscribe((state, prev) => {
    if (
      state.openFiles !== prev.openFiles ||
      state.editorDrafts !== prev.editorDrafts ||
      state.editorCursorLine !== prev.editorCursorLine ||
      state.markdownViewMode !== prev.markdownViewMode
    ) {
      schedule()
    }
  })
  return () => {
    unsubscribe()
    if (timer !== null) {
      window.clearTimeout(timer)
    }
  }
}
