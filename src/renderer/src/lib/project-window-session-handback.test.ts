import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getWindowBootContextMock, getStateMock, buildPayloadMock, collectKeysMock } = vi.hoisted(
  () => ({
    getWindowBootContextMock: vi.fn(),
    getStateMock: vi.fn(),
    buildPayloadMock: vi.fn(),
    collectKeysMock: vi.fn()
  })
)

vi.mock('../startup/window-boot-context', () => ({
  getWindowBootContext: getWindowBootContextMock
}))
vi.mock('../startup/project-window-boot-workspace', () => ({
  collectProjectWorkspaceKeys: collectKeysMock
}))
vi.mock('../store', () => ({ useAppStore: { getState: getStateMock } }))
vi.mock('./workspace-session', () => ({ buildWorkspaceSessionPayload: buildPayloadMock }))

import { stageProjectWindowSessionHandback } from './project-window-session-handback'

describe('stageProjectWindowSessionHandback', () => {
  const handbackProjectSessionSync = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('window', { api: { session: { handbackProjectSessionSync } } })
    getStateMock.mockReturnValue({ marker: 'state' })
    buildPayloadMock.mockReturnValue({ tabsByWorktree: { 'repo-1::/wt/a': [] } })
    collectKeysMock.mockReturnValue(['repo-1::/wt/a'])
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('hands the project slice to main for a workspace window', () => {
    getWindowBootContextMock.mockReturnValue({ role: 'workspace', projectKey: 'repo-1' })

    stageProjectWindowSessionHandback()

    expect(handbackProjectSessionSync).toHaveBeenCalledWith({
      projectKey: 'repo-1',
      workspaceKeys: ['repo-1::/wt/a'],
      session: { tabsByWorktree: { 'repo-1::/wt/a': [] } }
    })
  })

  it('is a no-op for the main window (it is the writer, not a handback source)', () => {
    getWindowBootContextMock.mockReturnValue({ role: 'main' })

    stageProjectWindowSessionHandback()

    expect(handbackProjectSessionSync).not.toHaveBeenCalled()
    expect(buildPayloadMock).not.toHaveBeenCalled()
  })

  it('is a no-op when the project owns no hydrated worktrees yet', () => {
    getWindowBootContextMock.mockReturnValue({ role: 'workspace', projectKey: 'repo-1' })
    collectKeysMock.mockReturnValue([])

    stageProjectWindowSessionHandback()

    expect(handbackProjectSessionSync).not.toHaveBeenCalled()
  })

  it('swallows a build failure so it cannot block the closing window teardown', () => {
    getWindowBootContextMock.mockReturnValue({ role: 'workspace', projectKey: 'repo-1' })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    buildPayloadMock.mockImplementation(() => {
      throw new Error('serialize failed')
    })

    expect(() => stageProjectWindowSessionHandback()).not.toThrow()
    expect(handbackProjectSessionSync).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
  })
})
