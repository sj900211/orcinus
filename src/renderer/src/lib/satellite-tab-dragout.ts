import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { OpenFile } from '@/store/slices/editor'
import type { TabDragItemData } from '@/components/tab-group/tab-drag-data'
import { getConnectionId } from '@/lib/connection-context'
import { getRendererWindowSurface } from '@/lib/renderer-window-surface'
import {
  isEditorFileEntityPinned,
  isEditorFileMovableToSatellite,
  moveEditorFileToExistingSatellite
} from '@/lib/satellite-editor-file-move'

// Dungeon 6 (tab drag-out, D9/D20/D22): a tab released OUTSIDE the window may
// land on a satellite. dnd-kit cannot express that drop (its closestCenter
// fallback keeps an in-window `over` target), so commitTabDragDrop calls this
// pair instead: resolve synchronously at drag end (a 0ms missed-end timer
// clears the drag state right after release), then hit-test + move detached.

export type SatelliteDragoutCandidate = {
  file: OpenFile
  language: string
  unifiedTabId: string
  worktreeId: string
}

/** Synchronous half: is this drag's tab movable into a satellite at all?
 *  null = ineligible — the caller just snaps back (D22 silent). */
export function resolveSatelliteDragoutCandidate(
  activeData: TabDragItemData
): SatelliteDragoutCandidate | null {
  // tabType gate: terminal/browser/simulator tabs ride the same DndContext
  // (simulator even renders through EditorFileTab with a synthetic id — the
  // openFiles lookup below misses it by construction).
  if (activeData.tabType !== 'editor' || getRendererWindowSurface() === 'satellite') {
    return null
  }
  const state = useAppStore.getState()
  // Review C9: visibleTabId is a unified-tab UUID on the split-group surface
  // (the only surface wired to commitTabDragDrop) — the OpenFile id lives in
  // the unified tab's entityId. A direct visibleTabId lookup never matches.
  const unifiedTab = (state.unifiedTabsByWorktree[activeData.worktreeId] ?? []).find(
    (tab) => tab.id === activeData.unifiedTabId
  )
  const file = state.openFiles.find(
    (candidate) =>
      candidate.id === (unifiedTab?.entityId ?? activeData.visibleTabId) &&
      candidate.worktreeId === activeData.worktreeId
  )
  if (!file) {
    return null
  }
  const eligible = isEditorFileMovableToSatellite({
    file,
    // Review C11: pin gate at ENTITY level — closeFile removes the whole
    // file, so a pinned duplicate in ANY split group must block the move.
    isPinned: isEditorFileEntityPinned(state.unifiedTabsByWorktree[activeData.worktreeId], file.id),
    repoConnectionId: getConnectionId(file.worktreeId)
  })
  if (!eligible) {
    return null
  }
  // Only edit-mode tabs pass the gate, so file.language IS the resolved
  // language the move menu would pass (diff/conflict overrides never apply).
  return {
    file,
    language: file.language,
    unifiedTabId: activeData.unifiedTabId,
    worktreeId: activeData.worktreeId
  }
}

/** Async half (detached from the drag): satellite under the cursor →
 *  same-worktree gate → TRUE move. D22: a miss, a cross-worktree window or a
 *  hit-test failure is a silent snap-back — nothing was captured yet, the tab
 *  simply stays. Only a move that failed AFTER capture gets a toast. */
export async function attemptSatelliteDragoutMove(
  candidate: SatelliteDragoutCandidate
): Promise<void> {
  let hit: { satelliteId: string; worktreeId: string } | null = null
  try {
    hit = await window.api.satelliteWindow.hitTestCursor()
  } catch {
    return
  }
  if (!hit || hit.worktreeId !== candidate.worktreeId) {
    return
  }
  const outcome = await moveEditorFileToExistingSatellite({
    file: candidate.file,
    language: candidate.language,
    satelliteId: hit.satelliteId,
    unifiedTabId: candidate.unifiedTabId
  })
  // Review C4: 'noop' (file closed during quiesce — nothing captured,
  // nothing lost) stays silent; only a post-capture refusal toasts.
  if (outcome === 'failed') {
    toast.error(translate('editorChild.dragMoveFailed', 'Could not move the file to that window.'))
  }
}
