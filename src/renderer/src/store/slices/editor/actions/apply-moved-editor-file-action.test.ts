import { expect, it, vi } from 'vitest'
import { createTestStore } from '@/store/slices/store-test-helpers'

// Why error too: the unregistered fixture worktree has no file owner, which openFile only toasts.
vi.mock('sonner', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))

// Fork: a satellite move restores a dirty tab, and its buffer record must hold what the view shows.
it('restores a moved dirty draft through the buffer record', () => {
  const store = createTestStore()
  const id = store.getState().applyMovedEditorFile({
    filePath: '/repo/a.ts',
    relativePath: 'a.ts',
    language: 'typescript',
    worktreeId: 'wt-1',
    dirtyDraftContent: 'd',
    lastKnownDiskSignature: 's'
  })

  const state = store.getState()
  expect(state.openFiles.find((file) => file.id === id)?.isDirty).toBe(true)
  expect(state.editorBuffers[state.editorBufferIdOf[id] ?? id]).toMatchObject({
    isDirty: true,
    lastKnownDiskSignature: 's'
  })
  expect(state.editorDrafts[id]).toBe('d')
})
