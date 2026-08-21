import { describe, expect, it, type vi } from 'vitest'
import { createHarnessStoreState, loadIpcEventsHarness } from './ipc-events-test-harness'

describe('useIpcEvents projectWindow:openProjectsChanged subscription', () => {
  it('mirrors every push into the store snapshot setter', async () => {
    const storeState = createHarnessStoreState({ tabsByWorktree: {} })
    const harness = await loadIpcEventsHarness(storeState)
    harness.useIpcEvents()

    harness.openProjectsChanged(['repo-1', 'folder:fw-1'])
    harness.openProjectsChanged([])

    const setter = storeState.setProjectKeysInOtherWindows as ReturnType<typeof vi.fn>
    expect(setter.mock.calls).toEqual([[['repo-1', 'folder:fw-1']], [[]]])
  })
})
