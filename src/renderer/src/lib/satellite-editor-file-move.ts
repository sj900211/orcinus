import type {
  SatelliteFilesMovedBack,
  SatelliteMovedFile
} from '../../../shared/satellite-window-payloads'
import type { Tab } from '../../../shared/tab-types'
import { requestEditorSaveQuiesce } from '@/components/editor/editor-autosave'
import { flushLiveMonacoViewState } from '@/components/editor/monaco-view-state-persistence'
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
  // Dungeon-6 cursor fix (owner-found): the selection cache is unmount-written,
  // so a still-mounted (actively edited) tab would ship stale/absent
  // selections — flush the live editor so the reads below are exact.
  flushLiveMonacoViewState(viewStateKey)
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

/** Shared TRUE-move eligibility (menu "Move to New Window" + dungeon-6 tab
 *  drag-out — ONE predicate so the two paths never drift): local plain edit
 *  tabs only. SSH/runtime/SFTP owners need broader store hydration, untitled
 *  tabs risk on-disk deletion (closeFile deletes untouched untitled files),
 *  pinned tabs are excluded because closeFile bypasses pin guards (D16), and
 *  read-only/mirrored tabs have no save path in a satellite.
 *  repoConnectionId: null = local repo (eligible); a string (remote) or
 *  undefined (repo not hydrated yet) is ineligible. The window-surface check
 *  stays at each callsite — the satellite shell renders the same menu. */
export function isEditorFileMovableToSatellite({
  file,
  isPinned,
  repoConnectionId
}: {
  file: OpenFile
  isPinned: boolean
  repoConnectionId: string | null | undefined
}): boolean {
  return (
    !isPinned &&
    file.mode === 'edit' &&
    !file.sftpTargetId &&
    !file.runtimeEnvironmentId &&
    !file.externalSshTargetId &&
    !file.readOnly &&
    !file.isUntitled &&
    !file.mirroredFromRuntimeSession &&
    repoConnectionId === null
  )
}

/** D16 pin gate at ENTITY level (review C11): closeFile removes the whole
 *  OpenFile, so a pinned duplicate of the same file in ANY split group blocks
 *  a TRUE move — the dragged/clicked tab's own flag alone misses cross-group
 *  duplicates. Content types mirror the unified close routing. */
export function isEditorFileEntityPinned(tabs: Tab[] | undefined, fileId: string): boolean {
  return (tabs ?? []).some(
    (tab) =>
      tab.entityId === fileId &&
      (tab.contentType === 'editor' ||
        tab.contentType === 'diff' ||
        tab.contentType === 'conflict-review' ||
        tab.contentType === 'check-details') &&
      tab.isPinned === true
  )
}

/** Parent window: TRUE move of one tab into an EXISTING satellite (dungeon 6
 *  tab drag-out — the "existing satellite" path deferred from D15). Same D14
 *  {ok} contract as the new-satellite move. raise comes LAST and only after
 *  the ACK: focusing the satellite any earlier would abort an in-flight drag
 *  (the tab drag sensor cancels on window focus change), and activateFile is
 *  deliberately NOT used — record.files only updates when the satellite later
 *  reports, so it would return ok:false right after the push (the push itself
 *  opens AND focuses the tab). Returns 'noop' when the file closed during the
 *  quiesce — nothing was captured, nothing lost (review C4: no toast);
 *  'failed' only when a CAPTURED payload was refused. */
export async function moveEditorFileToExistingSatellite({
  file,
  language,
  satelliteId,
  unifiedTabId
}: {
  file: OpenFile
  language: string
  satelliteId: string
  unifiedTabId?: string
}): Promise<'noop' | 'moved' | 'failed'> {
  const captured = await captureMovedEditorFilePayload({ fileId: file.id, language, unifiedTabId })
  if (!captured) {
    return 'noop'
  }
  try {
    const pushed = await window.api.satelliteWindow.moveFile(satelliteId, captured.payload)
    if (!pushed?.ok) {
      captured.restoreDirty()
      return 'failed'
    }
  } catch {
    captured.restoreDirty()
    return 'failed'
  }
  useAppStore.getState().closeFile(file.id)
  // The push opens + focuses the tab; activateFile would race record.files.
  void window.api.satelliteWindow.raise(satelliteId)
  return 'moved'
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
