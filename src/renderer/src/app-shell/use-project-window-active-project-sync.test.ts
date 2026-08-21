import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../store'
import { installProjectWindowActiveProjectSync } from './use-project-window-active-project-sync'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

function stubNotify(): ReturnType<typeof vi.fn> {
  const notifyActiveProjectChanged = vi.fn()
  vi.stubGlobal('window', { api: { projectWindow: { notifyActiveProjectChanged } } })
  return notifyActiveProjectChanged
}

describe('installProjectWindowActiveProjectSync', () => {
  it('reports the boot project immediately and only on cross-project switches after', () => {
    const notify = stubNotify()
    useAppStore.setState({ activeWorktreeId: 'repo-1::/wt/a' })
    const uninstall = installProjectWindowActiveProjectSync()
    try {
      expect(notify.mock.calls).toEqual([['repo-1']])

      // Intra-project worktree switch: registry-invisible, nothing reported.
      useAppStore.setState({ activeWorktreeId: 'repo-1::/wt/b' })
      expect(notify).toHaveBeenCalledTimes(1)

      // Cross-project switch re-keys.
      useAppStore.setState({ activeWorktreeId: 'repo-2::/wt/x' })
      expect(notify.mock.calls).toEqual([['repo-1'], ['repo-2']])

      // Folder workspaces report their own key as the project.
      useAppStore.setState({ activeWorktreeId: 'folder:fw-1' })
      expect(notify).toHaveBeenLastCalledWith('folder:fw-1')
    } finally {
      uninstall()
    }
  })

  it('keeps the last registration on landing/null (no report)', () => {
    const notify = stubNotify()
    useAppStore.setState({ activeWorktreeId: 'repo-1::/wt/a' })
    const uninstall = installProjectWindowActiveProjectSync()
    try {
      useAppStore.setState({ activeWorktreeId: null })
      expect(notify.mock.calls).toEqual([['repo-1']])

      // Returning to the SAME project after landing stays silent (still registered).
      useAppStore.setState({ activeWorktreeId: 'repo-1::/wt/b' })
      expect(notify).toHaveBeenCalledTimes(1)
    } finally {
      uninstall()
    }
  })

  it('reports nothing at install when the window has no active workspace yet', () => {
    const notify = stubNotify()
    useAppStore.setState({ activeWorktreeId: null })
    const uninstall = installProjectWindowActiveProjectSync()
    try {
      expect(notify).not.toHaveBeenCalled()
    } finally {
      uninstall()
    }
  })
})
