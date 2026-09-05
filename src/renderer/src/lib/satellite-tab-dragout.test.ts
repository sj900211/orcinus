/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import type { TabDragItemData } from '@/components/tab-group/tab-drag-data'
import type { OpenFile } from '@/store/slices/editor'
import { useAppStore } from '@/store'
import { getConnectionId } from '@/lib/connection-context'
import { getRendererWindowSurface } from '@/lib/renderer-window-surface'
import { moveEditorFileToExistingSatellite } from '@/lib/satellite-editor-file-move'
import {
  attemptSatelliteDragoutMove,
  resolveSatelliteDragoutCandidate,
  type SatelliteDragoutCandidate
} from './satellite-tab-dragout'

vi.mock('@/lib/connection-context', () => ({ getConnectionId: vi.fn(() => null) }))
vi.mock('@/lib/renderer-window-surface', () => ({
  getRendererWindowSurface: vi.fn(() => 'app')
}))
// Keeps the REAL eligibility predicate + entity-pin helper; only the
// transport is stubbed.
vi.mock('@/components/editor/editor-autosave', () => ({
  requestEditorSaveQuiesce: vi.fn(async () => {})
}))
vi.mock('@/lib/satellite-editor-file-move', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  moveEditorFileToExistingSatellite: vi.fn(async () => 'moved')
}))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

const baseFile = {
  id: '/repo/a.ts',
  filePath: '/repo/a.ts',
  relativePath: 'a.ts',
  worktreeId: 'wt-1',
  language: 'typescript',
  mode: 'edit'
} as unknown as OpenFile

type SeedTab = { id: string; entityId: string; contentType: string; isPinned?: boolean }

function seedStore(
  file: OpenFile = baseFile,
  tabs: SeedTab[] = [{ id: 'u1', entityId: baseFile.id, contentType: 'editor' }]
): void {
  useAppStore.setState({
    openFiles: [file],
    unifiedTabsByWorktree: { 'wt-1': tabs }
  } as unknown as Parameters<typeof useAppStore.setState>[0])
}

// Production shape (review C9): visibleTabId carries the unified-tab UUID on
// the split-group surface, NOT the OpenFile id — the file resolves through
// the unified tab's entityId.
function makeDragData(overrides: Partial<TabDragItemData> = {}): TabDragItemData {
  return {
    kind: 'tab',
    worktreeId: 'wt-1',
    groupId: 'g1',
    unifiedTabId: 'u1',
    visibleTabId: 'u1',
    tabType: 'editor',
    label: 'a.ts',
    ...overrides
  }
}

const hitTestCursor = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  ;(window as unknown as { api: unknown }).api = { satelliteWindow: { hitTestCursor } }
  vi.mocked(getConnectionId).mockReturnValue(null)
  vi.mocked(getRendererWindowSurface).mockReturnValue('app')
  vi.mocked(moveEditorFileToExistingSatellite).mockResolvedValue('moved')
  seedStore()
})

describe('resolveSatelliteDragoutCandidate', () => {
  it('resolves the file through the unified tab entityId (C9 regression)', () => {
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toEqual({
      file: expect.objectContaining({ id: '/repo/a.ts' }),
      language: 'typescript',
      unifiedTabId: 'u1',
      worktreeId: 'wt-1'
    })
  })

  it('rejects non-editor drags, satellite surfaces and unknown tabs', () => {
    expect(resolveSatelliteDragoutCandidate(makeDragData({ tabType: 'terminal' }))).toBeNull()

    vi.mocked(getRendererWindowSurface).mockReturnValue('satellite')
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()
    vi.mocked(getRendererWindowSurface).mockReturnValue('app')

    expect(
      resolveSatelliteDragoutCandidate(
        makeDragData({ unifiedTabId: 'u-missing', visibleTabId: 'u-missing' })
      )
    ).toBeNull()
  })

  it('applies the shared eligibility gate (mode, remote/unhydrated repo)', () => {
    seedStore({ ...baseFile, mode: 'diff' } as unknown as OpenFile)
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()

    seedStore()
    vi.mocked(getConnectionId).mockReturnValue('ssh-1')
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()
    vi.mocked(getConnectionId).mockReturnValue(undefined)
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()
  })

  it('C11: a pinned duplicate of the file in ANY group blocks the move', () => {
    seedStore(baseFile, [
      { id: 'u1', entityId: baseFile.id, contentType: 'editor', isPinned: true }
    ])
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()

    // The dragged tab is unpinned, but a cross-group duplicate is pinned.
    seedStore(baseFile, [
      { id: 'u1', entityId: baseFile.id, contentType: 'editor' },
      { id: 'u2', entityId: baseFile.id, contentType: 'editor', isPinned: true }
    ])
    expect(resolveSatelliteDragoutCandidate(makeDragData())).toBeNull()
  })
})

describe('attemptSatelliteDragoutMove', () => {
  const candidate: SatelliteDragoutCandidate = {
    file: baseFile,
    language: 'typescript',
    unifiedTabId: 'u1',
    worktreeId: 'wt-1'
  }

  it('moves into the hit satellite of the same worktree', async () => {
    hitTestCursor.mockResolvedValue({ satelliteId: 'sat-1', worktreeId: 'wt-1' })
    await attemptSatelliteDragoutMove(candidate)
    expect(moveEditorFileToExistingSatellite).toHaveBeenCalledWith({
      file: baseFile,
      language: 'typescript',
      satelliteId: 'sat-1',
      unifiedTabId: 'u1'
    })
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('D22: miss, worktree mismatch and hit-test failure snap back silently', async () => {
    hitTestCursor.mockResolvedValue(null)
    await attemptSatelliteDragoutMove(candidate)
    hitTestCursor.mockResolvedValue({ satelliteId: 'sat-1', worktreeId: 'wt-other' })
    await attemptSatelliteDragoutMove(candidate)
    hitTestCursor.mockRejectedValue(new Error('gone'))
    await attemptSatelliteDragoutMove(candidate)
    expect(moveEditorFileToExistingSatellite).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it("C4: a pre-capture bail ('noop') stays silent; only 'failed' toasts", async () => {
    hitTestCursor.mockResolvedValue({ satelliteId: 'sat-1', worktreeId: 'wt-1' })
    vi.mocked(moveEditorFileToExistingSatellite).mockResolvedValue('noop')
    await attemptSatelliteDragoutMove(candidate)
    expect(toast.error).not.toHaveBeenCalled()

    vi.mocked(moveEditorFileToExistingSatellite).mockResolvedValue('failed')
    await attemptSatelliteDragoutMove(candidate)
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
})
