import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProjectWindowSessionHandback } from '../../../shared/project-window-session-handback'

const { getWindowBootContextMock, getStateMock } = vi.hoisted(() => ({
  getWindowBootContextMock: vi.fn(),
  getStateMock: vi.fn()
}))

vi.mock('../startup/window-boot-context', () => ({
  getWindowBootContext: getWindowBootContextMock
}))
vi.mock('../store', () => ({ useAppStore: { getState: getStateMock } }))

import { registerProjectWindowSessionHandbackReceiver } from './project-window-session-handback-receiver'

type HandbackCallback = (args: ProjectWindowSessionHandback) => void

function stubApi() {
  let callback: HandbackCallback | null = null
  const unsubscribe = vi.fn()
  const onProjectSessionHandback = vi.fn((cb: HandbackCallback) => {
    callback = cb
    return unsubscribe
  })
  vi.stubGlobal('window', { api: { session: { onProjectSessionHandback } } })
  return {
    fire: (args: ProjectWindowSessionHandback) => callback?.(args),
    onProjectSessionHandback,
    unsubscribe
  }
}

const handback: ProjectWindowSessionHandback = {
  projectKey: 'repo-1',
  workspaceKeys: ['repo-1::/wt/a'],
  session: { tabsByWorktree: {} } as ProjectWindowSessionHandback['session']
}

describe('registerProjectWindowSessionHandbackReceiver', () => {
  const hydrateWorkspaceSession = vi.fn()
  const hydrateTabsSession = vi.fn()
  const reconnectPersistedTerminals = vi.fn(() => Promise.resolve())

  beforeEach(() => {
    getStateMock.mockReturnValue({
      hydrateWorkspaceSession,
      hydrateTabsSession,
      reconnectPersistedTerminals
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('merges the slice scoped and reconnects only the handed-back keys (main window)', async () => {
    getWindowBootContextMock.mockReturnValue({ role: 'main' })
    const api = stubApi()

    registerProjectWindowSessionHandbackReceiver()
    api.fire(handback)
    await Promise.resolve()

    expect(hydrateWorkspaceSession).toHaveBeenCalledWith(handback.session, {
      replaceWorkspaceKeys: ['repo-1::/wt/a']
    })
    expect(hydrateTabsSession).toHaveBeenCalledWith(handback.session, {
      replaceWorkspaceKeys: ['repo-1::/wt/a']
    })
    expect(reconnectPersistedTerminals).toHaveBeenCalledWith(expect.any(AbortSignal), {
      workspaceKeys: ['repo-1::/wt/a']
    })
  })

  it('does not subscribe on a project window (only main is the writer)', () => {
    getWindowBootContextMock.mockReturnValue({ role: 'workspace', projectKey: 'repo-1' })
    const api = stubApi()

    const cleanup = registerProjectWindowSessionHandbackReceiver()

    expect(api.onProjectSessionHandback).not.toHaveBeenCalled()
    expect(() => cleanup()).not.toThrow()
  })

  it('ignores an empty-keys handback without touching the store', async () => {
    getWindowBootContextMock.mockReturnValue({ role: 'main' })
    const api = stubApi()

    registerProjectWindowSessionHandbackReceiver()
    api.fire({ ...handback, workspaceKeys: [] })
    await Promise.resolve()

    expect(hydrateWorkspaceSession).not.toHaveBeenCalled()
  })
})
