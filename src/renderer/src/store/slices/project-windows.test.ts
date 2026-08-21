import { describe, expect, it } from 'vitest'
import { createTestStore } from './store-test-helpers'

describe('project-windows slice', () => {
  it('starts with no projects in other windows', () => {
    const store = createTestStore()
    expect(store.getState().projectKeysInOtherWindows.size).toBe(0)
  })

  it('replaces the snapshot wholesale on every push (per-recipient contract)', () => {
    const store = createTestStore()
    store.getState().setProjectKeysInOtherWindows(['repo-1', 'folder:fw-1'])
    expect([...store.getState().projectKeysInOtherWindows]).toEqual(['repo-1', 'folder:fw-1'])

    store.getState().setProjectKeysInOtherWindows(['repo-2'])
    const snapshot = store.getState().projectKeysInOtherWindows
    expect(snapshot.has('repo-2')).toBe(true)
    expect(snapshot.has('repo-1')).toBe(false)

    store.getState().setProjectKeysInOtherWindows([])
    expect(store.getState().projectKeysInOtherWindows.size).toBe(0)
  })

  it('publishes a new set identity so subscribers see the change', () => {
    const store = createTestStore()
    const before = store.getState().projectKeysInOtherWindows
    store.getState().setProjectKeysInOtherWindows(['repo-1'])
    expect(store.getState().projectKeysInOtherWindows).not.toBe(before)
  })
})
