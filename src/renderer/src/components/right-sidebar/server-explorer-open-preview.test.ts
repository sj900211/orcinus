import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getStateMock, openFileMock, toastErrorMock } = vi.hoisted(() => ({
  getStateMock: vi.fn(),
  openFileMock: vi.fn(),
  toastErrorMock: vi.fn()
}))

vi.mock('@/store', () => ({ useAppStore: { getState: getStateMock } }))
vi.mock('sonner', () => ({ toast: { error: toastErrorMock } }))

import { openServerFilePreview } from './server-explorer-open-preview'

describe('openServerFilePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a read-only, SFTP-routed preview tab owned by the active worktree', () => {
    getStateMock.mockReturnValue({
      activeWorktreeId: 'wt-1',
      activeGroupIdByWorktree: { 'wt-1': 'grp-1' },
      openFile: openFileMock
    })
    openServerFilePreview('host-1', '/remote/dir/app.ts', 'app.ts')

    expect(openFileMock).toHaveBeenCalledTimes(1)
    const [file, options] = openFileMock.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>]
    expect(file).toMatchObject({
      filePath: '/remote/dir/app.ts',
      relativePath: '/remote/dir/app.ts',
      worktreeId: 'wt-1',
      runtimeEnvironmentId: null,
      mode: 'edit',
      readOnly: true,
      isPreview: true,
      sftpTargetId: 'host-1'
    })
    expect(typeof file.language).toBe('string')
    expect(options).toMatchObject({
      preview: true,
      suppressActiveRuntimeFallback: true,
      targetGroupId: 'grp-1'
    })
  })

  it('refuses with a toast when no workspace is active, opening no tab', () => {
    getStateMock.mockReturnValue({ activeWorktreeId: null, openFile: openFileMock })
    openServerFilePreview('host-1', '/remote/x.txt', 'x.txt')

    expect(openFileMock).not.toHaveBeenCalled()
    expect(toastErrorMock).toHaveBeenCalledTimes(1)
  })
})
