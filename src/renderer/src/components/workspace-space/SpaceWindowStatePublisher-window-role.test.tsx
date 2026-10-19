// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock('@/store', () => ({ useAppStore: { getState: vi.fn(), subscribe: vi.fn() } }))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorktree: vi.fn() }))

import { SpaceWindowStatePublisher } from './SpaceWindowStatePublisher'

const onWindowStateRequested = vi.fn(() => () => {})
let root: Root

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { workspaceSpace: { publishWindowState: vi.fn(), onWindowStateRequested } }
  })
  root = createRoot(document.createElement('div'))
})
afterEach(async () => {
  await act(async () => root.unmount())
  window.history.replaceState(null, '', '/')
})

// Fork: every window renders App, so only the primary may publish or the Space window shows the last writer.
it('stays inert in a project window', async () => {
  window.history.replaceState(null, '', '/?orca-project=repo-1')
  await act(async () => root.render(<SpaceWindowStatePublisher />))
  expect(onWindowStateRequested).not.toHaveBeenCalled()
})

it('listens for Space window requests in the main window', async () => {
  await act(async () => root.render(<SpaceWindowStatePublisher />))
  expect(onWindowStateRequested).toHaveBeenCalledOnce()
})
