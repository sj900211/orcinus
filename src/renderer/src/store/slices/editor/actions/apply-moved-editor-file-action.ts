import { toast } from 'sonner'
import { scheduleLiveMonacoViewStateReapply } from '@/components/editor/monaco-view-state-persistence'
import { translate } from '@/i18n/i18n'
import type { EditorGet, EditorSet } from '../types/editor-set-get'
import type { EditorSlice } from '../types/editor-slice'
import type { MarkdownViewMode } from '../types/open-file'
import { editorSelectionCache, scrollTopCache, setWithLRU } from '@/lib/scroll-cache'

const MOVED_MARKDOWN_VIEW_MODES: readonly string[] = [
  'source',
  'rich',
  'preview'
] satisfies readonly MarkdownViewMode[]

// TRUE-move restore (dungeon 5, decision D7): a satellite receives a moved
// file with the state the parent's closeFile destroyed. Template =
// hydrate-editor-session's dirty restore — the draft, dirty flag, disk
// signature and the pendingDiskBaselineVerification gate land in ONE set()
// so no frame ever shows the tab dirty without autosave suspended.
export function createApplyMovedEditorFileAction(
  set: EditorSet,
  get: EditorGet
): Pick<EditorSlice, 'applyMovedEditorFile'> {
  return {
    applyMovedEditorFile: (file) => {
      const worktreeId = file.worktreeId
      // Why openFile first (not a bespoke insert): it owns id resolution,
      // unified-tab creation/reuse, group targeting and focus — and when the
      // boot already opened this path clean, the reuse branch merges instead
      // of duplicating. Between this and the patch below the file is CLEAN,
      // which is autosave-inert.
      const fileId = get().openFile(
        {
          filePath: file.filePath,
          relativePath: file.relativePath,
          worktreeId,
          language: file.language,
          mode: 'edit'
        },
        { focusEditor: true, suppressSatelliteInterception: true }
      )
      // Post-review C3/C8: a boot-gap duplicate (or D8 parent tab) may already
      // hold NEWER edits — never clobber a live dirty tab. The whole patch is
      // skipped (draft AND cursor/view seeds), and the discarded carried draft
      // is surfaced instead of vanishing silently.
      const existingDirty = get().openFiles.some(
        (candidate) => candidate.id === fileId && candidate.isDirty === true
      )
      if (existingDirty) {
        // Idempotent duplicate (reload re-push racing a boot push): the same
        // draft arriving twice is not a conflict — stay silent.
        if (
          file.dirtyDraftContent !== undefined &&
          get().editorDrafts[fileId] === file.dirtyDraftContent
        ) {
          return fileId
        }
        if (file.dirtyDraftContent !== undefined) {
          toast.warning(
            translate(
              'editorChild.moveBackDraftDiscarded',
              '"{{value0}}" already has unsaved local edits — the returning draft was discarded.',
              { value0: file.relativePath.split('/').pop() }
            )
          )
        }
        return fileId
      }
      const hasDraft = file.dirtyDraftContent !== undefined
      // Why together-or-not-at-all: arming the verification gate without a
      // signature permanently kills autosave (the conflict scan's queue gate
      // never picks the file up, so nothing ever clears the suspension).
      const armVerification = hasDraft && file.lastKnownDiskSignature !== undefined
      const markdownViewMode =
        file.markdownViewMode !== undefined &&
        MOVED_MARKDOWN_VIEW_MODES.includes(file.markdownViewMode)
          ? (file.markdownViewMode as MarkdownViewMode)
          : undefined
      set((s) => ({
        ...(hasDraft
          ? { editorDrafts: { ...s.editorDrafts, [fileId]: file.dirtyDraftContent as string } }
          : {}),
        openFiles: hasDraft
          ? s.openFiles.map((candidate) =>
              candidate.id === fileId
                ? {
                    ...candidate,
                    isDirty: true,
                    lastKnownDiskSignature: file.lastKnownDiskSignature,
                    pendingDiskBaselineVerification: armVerification ? true : undefined
                  }
                : candidate
            )
          : s.openFiles,
        ...(file.cursorLine !== undefined
          ? { editorCursorLine: { ...s.editorCursorLine, [fileId]: file.cursorLine } }
          : {}),
        ...(markdownViewMode !== undefined
          ? { markdownViewMode: { ...s.markdownViewMode, [fileId]: markdownViewMode } }
          : {})
      }))
      // Best-effort Monaco view-state seeds (D19 fidelity): the caches are
      // renderer-module maps keyed `${filePath}::${unifiedTabId}` — re-key
      // under THIS window's tab id (EditorContent contract).
      const tabId = (get().unifiedTabsByWorktree[worktreeId] ?? []).find(
        (tab) => tab.entityId === fileId && tab.contentType === 'editor'
      )?.id
      if (tabId) {
        const viewStateKey = `${file.filePath}::${tabId}`
        if (file.scrollTop !== undefined) {
          setWithLRU(scrollTopCache, viewStateKey, file.scrollTop)
        }
        if (file.selections !== undefined && file.selections.length > 0) {
          setWithLRU(editorSelectionCache, viewStateKey, file.selections)
        } else if (file.cursorLine !== undefined) {
          // Selections can be absent (restart staging carries cursorLine only;
          // pre-fix payloads): a collapsed caret keeps at least the line —
          // editorCursorLine alone is never read for caret placement.
          setWithLRU(editorSelectionCache, viewStateKey, [
            {
              selectionStartLineNumber: file.cursorLine,
              selectionStartColumn: 1,
              positionLineNumber: file.cursorLine,
              positionColumn: 1
            }
          ])
        }
        // Restore is mount-once: when the destination editor mounted BEFORE
        // this push (new-satellite boot race), the seeds above would never be
        // consumed — re-apply them to the live editor after this commit.
        scheduleLiveMonacoViewStateReapply(viewStateKey)
      }
      return fileId
    }
  }
}
