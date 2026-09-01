import type {
  SatelliteFilesMovedBack,
  SatelliteMovedFile
} from '../../../shared/satellite-window-payloads'
import { requestEditorSaveQuiesce } from '@/components/editor/editor-autosave'
import { editorSelectionCache, scrollTopCache } from '@/lib/scroll-cache'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'

// TRUE-move transport for satellite editor windows (dungeon 5, decisions
// D7/D14/D18/D19): capture in the source window, carry over IPC, apply via
// applyMovedEditorFile in the destination window. Both directions share one
// capture (parent -> satellite move-out; satellite -> parent Move Back).
//
// Capture ordering (recon-verified):
// - Capture AFTER quiesce: an in-flight autosave that completed during the
//   await already cleaned the file — it then moves clean, which is correct.
// - markFileDirty(false) BEFORE the async IPC: autosave re-arms while a dirty
//   draft sits in the store; a save landing mid-move would re-baseline
//   lastKnownDiskSignature AFTER capture and fake a disk conflict at the
//   destination. The draft stays in editorDrafts (flag-only), so failure
//   paths restore the dirty flag losslessly.
// - closeFile LAST, only on ACK (D14 {ok} contract).
async function captureMovedEditorFilePayload({
  fileId,
  language,
  unifiedTabId
}: {
  fileId: string
  language: string
  unifiedTabId?: string
}): Promise<{ payload: SatelliteMovedFile; restoreDirty: () => void } | null> {
  await requestEditorSaveQuiesce({ fileId })

  const state = useAppStore.getState()
  const current = state.openFiles.find((candidate) => candidate.id === fileId)
  if (!current) {
    // Closed while quiescing — nothing left to move.
    return null
  }
  const draft = current.isDirty ? state.editorDrafts[fileId] : undefined
  const viewStateKey = unifiedTabId ? `${current.filePath}::${unifiedTabId}` : current.filePath
  const cursorLine = state.editorCursorLine[fileId]
  const scrollTop = scrollTopCache.get(viewStateKey)
  const selections = editorSelectionCache.get(viewStateKey)
  const markdownViewMode = state.markdownViewMode[fileId]

  const payload: SatelliteMovedFile = {
    filePath: current.filePath,
    relativePath: current.relativePath,
    language,
    // Why together-or-not-at-all: the destination arms its disk-baseline
    // verification gate only when BOTH exist (hydrate-editor-session contract).
    ...(draft !== undefined
      ? {
          dirtyDraftContent: draft,
          ...(current.lastKnownDiskSignature !== undefined
            ? { lastKnownDiskSignature: current.lastKnownDiskSignature }
            : {})
        }
      : {}),
    ...(cursorLine !== undefined ? { cursorLine } : {}),
    ...(scrollTop !== undefined ? { scrollTop } : {}),
    ...(selections !== undefined && selections.length > 0
      ? {
          selections: selections.map((sel) => ({
            selectionStartLineNumber: sel.selectionStartLineNumber,
            selectionStartColumn: sel.selectionStartColumn,
            positionLineNumber: sel.positionLineNumber,
            positionColumn: sel.positionColumn
          }))
        }
      : {}),
    ...(markdownViewMode !== undefined ? { markdownViewMode } : {})
  }

  const wasDirty = current.isDirty === true
  if (wasDirty) {
    state.markFileDirty(fileId, false)
  }
  return {
    payload,
    restoreDirty: () => {
      const state = useAppStore.getState()
      // Post-review C6: an external-change reload can have DELETED the parked
      // draft while the tab looked clean — restore the captured content too,
      // unless the user typed newer content meanwhile (their draft wins).
      if (payload.dirtyDraftContent !== undefined && state.editorDrafts[fileId] === undefined) {
        state.setEditorDraft(fileId, payload.dirtyDraftContent)
      }
      if (wasDirty) {
        useAppStore.getState().markFileDirty(fileId, true)
      }
    }
  }
}

/** Parent window: TRUE move of one tab into a NEW satellite (spec 1). */
export async function moveEditorFileToNewSatellite({
  file,
  language,
  unifiedTabId
}: {
  file: OpenFile
  /** Resolved language from the tab menu (matches the previous open() call). */
  language: string
  /** The moved unified tab's id — Monaco view-state caches are keyed
   *  `${filePath}::${unifiedTabId}` (EditorContent contract). */
  unifiedTabId?: string
}): Promise<boolean> {
  const captured = await captureMovedEditorFilePayload({ fileId: file.id, language, unifiedTabId })
  if (!captured) {
    return false
  }
  try {
    const opened = await window.api.satelliteWindow.open(file.worktreeId, {
      filePath: captured.payload.filePath,
      relativePath: captured.payload.relativePath,
      language
    })
    if (!opened) {
      captured.restoreDirty()
      return false
    }
    const pushed = await window.api.satelliteWindow.moveFile(opened.satelliteId, captured.payload)
    if (!pushed?.ok) {
      captured.restoreDirty()
      return false
    }
  } catch {
    captured.restoreDirty()
    return false
  }
  useAppStore.getState().closeFile(file.id)
  return true
}

/** Satellite window: return one tab to the parent (D6 Move Back). */
export async function moveEditorFileBackToParent({
  file,
  language,
  unifiedTabId
}: {
  file: OpenFile
  language: string
  unifiedTabId?: string
}): Promise<boolean> {
  const captured = await captureMovedEditorFilePayload({ fileId: file.id, language, unifiedTabId })
  if (!captured) {
    return false
  }
  try {
    const result = await window.api.satelliteWindow.moveFileBack?.(captured.payload)
    if (!result?.ok) {
      captured.restoreDirty()
      return false
    }
  } catch {
    captured.restoreDirty()
    return false
  }
  // The last tab closing empties the report and D1 closes this window.
  useAppStore.getState().closeFile(file.id)
  return true
}

/** Parent window: apply files returned by a satellite (Move Back / fold-back). */
export function applySatelliteReturnedFiles(data: SatelliteFilesMovedBack): void {
  const before = useAppStore.getState()
  const isBackgroundWorktree = data.worktreeId !== before.activeWorktreeId
  const previousActive = isBackgroundWorktree
    ? { activeFileId: before.activeFileId, activeTabType: before.activeTabType }
    : null
  for (const file of data.files) {
    useAppStore.getState().applyMovedEditorFile({ ...file, worktreeId: data.worktreeId })
  }
  if (previousActive) {
    // D18: a return into a non-active worktree must not yank the visible
    // surface — openFile flips the global active pointers, so restore them;
    // the per-worktree maps keep the returned file active in its own worktree.
    useAppStore.setState(previousActive)
  }
}
