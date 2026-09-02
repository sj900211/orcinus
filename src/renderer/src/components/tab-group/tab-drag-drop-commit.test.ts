/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RefObject } from 'react'
import type { DragEndEvent } from '@dnd-kit/core'
import { commitTabDragDrop } from './tab-drag-drop-commit'
import type { TabDragItemData } from './tab-drag-data'
import type { TabGroupPanelGeometrySnapshot } from './tab-group-panel-split-target'
import {
  attemptSatelliteDragoutMove,
  resolveSatelliteDragoutCandidate
} from '../../lib/satellite-tab-dragout'

vi.mock('../../lib/satellite-tab-dragout', () => ({
  attemptSatelliteDragoutMove: vi.fn(async () => {}),
  resolveSatelliteDragoutCandidate: vi.fn(() => null)
}))
vi.mock('../tab-bar/web-runtime-tab-move-mirror', () => ({ mirrorWebRuntimeTabMove: vi.fn() }))

const WT = 'wt-1'

function makeDragData(overrides: Partial<TabDragItemData> = {}): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: WT,
    groupId: 'g1',
    unifiedTabId: 'tab-1',
    visibleTabId: 'tab-1',
    tabType: 'editor',
    label: 'tab-1',
    ...overrides
  }
}

function makeEndEvent(
  activeData: TabDragItemData,
  pointer: { x: number; y: number },
  overData?: unknown
): DragEndEvent {
  return {
    active: { data: { current: activeData }, rect: { current: { initial: null } } },
    over: overData === undefined ? null : { data: { current: overData } },
    delta: { x: 0, y: 0 },
    activatorEvent: { clientX: pointer.x, clientY: pointer.y }
  } as unknown as DragEndEvent
}

function runCommit(event: DragEndEvent): {
  finishDrag: ReturnType<typeof vi.fn>
  dropUnifiedTab: ReturnType<typeof vi.fn>
  reorderUnifiedTabs: ReturnType<typeof vi.fn>
} {
  const finishDrag = vi.fn()
  const dropUnifiedTab = vi.fn(() => true)
  const reorderUnifiedTabs = vi.fn()
  commitTabDragDrop({
    event,
    worktreeId: WT,
    dragGeometryRef: { current: null } as RefObject<TabGroupPanelGeometrySnapshot | null>,
    dropUnifiedTab: dropUnifiedTab as never,
    reorderUnifiedTabs: reorderUnifiedTabs as never,
    finishDrag
  })
  return { finishDrag, dropUnifiedTab, reorderUnifiedTabs }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(resolveSatelliteDragoutCandidate).mockReturnValue(null)
})

describe('commitTabDragDrop — outside-window release (D20)', () => {
  it('snaps back instead of committing the closest-center over-tab', () => {
    const activeData = makeDragData()
    const overData = makeDragData({ unifiedTabId: 'tab-2', visibleTabId: 'tab-2' })
    const { finishDrag, dropUnifiedTab, reorderUnifiedTabs } = runCommit(
      makeEndEvent(activeData, { x: window.innerWidth + 50, y: 10 }, overData)
    )
    expect(reorderUnifiedTabs).not.toHaveBeenCalled()
    expect(dropUnifiedTab).not.toHaveBeenCalled()
    expect(finishDrag).toHaveBeenCalledWith(true)
    expect(resolveSatelliteDragoutCandidate).toHaveBeenCalledWith(activeData)
  })

  it('starts the satellite move only for an eligible candidate, after the drag finished', () => {
    const candidate = {
      file: { id: 'f' },
      language: 'typescript',
      unifiedTabId: 'tab-1',
      worktreeId: WT
    }
    vi.mocked(resolveSatelliteDragoutCandidate).mockReturnValue(candidate as never)
    const { finishDrag } = runCommit(makeEndEvent(makeDragData(), { x: -10, y: 10 }))
    expect(attemptSatelliteDragoutMove).toHaveBeenCalledWith(candidate)
    expect(vi.mocked(attemptSatelliteDragoutMove).mock.invocationCallOrder[0]).toBeGreaterThan(
      finishDrag.mock.invocationCallOrder[0]
    )
  })

  it('an ineligible tab still snaps back without a move attempt', () => {
    const { finishDrag } = runCommit(
      makeEndEvent(makeDragData({ tabType: 'terminal' }), { x: -10, y: 10 })
    )
    expect(finishDrag).toHaveBeenCalledWith(true)
    expect(attemptSatelliteDragoutMove).not.toHaveBeenCalled()
  })

  it('an inside-window release never consults the drag-out path', () => {
    runCommit(makeEndEvent(makeDragData(), { x: 100, y: 10 }))
    expect(resolveSatelliteDragoutCandidate).not.toHaveBeenCalled()
    expect(attemptSatelliteDragoutMove).not.toHaveBeenCalled()
  })

  it('title-bar (negative y) and bottom-edge releases count as outside', () => {
    runCommit(makeEndEvent(makeDragData(), { x: 100, y: -5 }))
    runCommit(makeEndEvent(makeDragData(), { x: 100, y: window.innerHeight + 5 }))
    expect(resolveSatelliteDragoutCandidate).toHaveBeenCalledTimes(2)
  })
})
