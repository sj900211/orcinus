import { afterEach, describe, expect, it, vi } from 'vitest'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import {
  activateAndRevealFolderWorkspace,
  activateAndRevealWorkspace,
  activateAndRevealWorktree
} from './worktree-activation'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

function stubRaise(): ReturnType<typeof vi.fn> {
  const raise = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', { api: { projectWindow: { raise } } })
  return raise
}

describe('activation raise-instead-of-switch guard (project windows)', () => {
  it('raises the owning project window (no worktree forwarding) without store side effects', () => {
    const raise = stubRaise()
    const getKnownWorktreeById = vi.fn(() => undefined)
    useAppStore.setState({
      projectKeysInOtherWindows: new Set(['repo-owned']),
      getKnownWorktreeById
    } as Partial<AppState>)

    expect(activateAndRevealWorktree('repo-owned::/wt/a')).toBe(false)

    // Raise-only: the owner window already shows this project's rows, so no worktree is forwarded.
    expect(raise).toHaveBeenCalledWith('repo-owned')
    // Early return: activation never even resolved the worktree, so no state mutated.
    expect(getKnownWorktreeById).not.toHaveBeenCalled()
  })

  it('guards EVERY worktree of a windowed project, not just the one open there', () => {
    const raise = stubRaise()
    useAppStore.setState({
      projectKeysInOtherWindows: new Set(['repo-owned'])
    } as Partial<AppState>)

    expect(activateAndRevealWorktree('repo-owned::/wt/other')).toBe(false)
    expect(raise).toHaveBeenCalledWith('repo-owned')
  })

  it('bypassOtherWindowGuard skips the raise and lets activation proceed', () => {
    const raise = stubRaise()
    const getKnownWorktreeById = vi.fn(() => undefined)
    useAppStore.setState({
      projectKeysInOtherWindows: new Set(['repo-owned']),
      getKnownWorktreeById
    } as Partial<AppState>)

    // Unknown worktree still fails activation, but the guard was demonstrably skipped.
    expect(activateAndRevealWorktree('repo-owned::/wt/a', { bypassOtherWindowGuard: true })).toBe(
      false
    )

    expect(raise).not.toHaveBeenCalled()
    expect(getKnownWorktreeById).toHaveBeenCalledWith('repo-owned::/wt/a', undefined)
  })

  it('guards folder workspaces by their folder: project key (identity mapping)', () => {
    const raise = stubRaise()
    useAppStore.setState({
      projectKeysInOtherWindows: new Set([folderWorkspaceKey('fw-1')])
    } as Partial<AppState>)

    expect(activateAndRevealFolderWorkspace('fw-1')).toBe(false)
    expect(raise).toHaveBeenCalledWith('folder:fw-1')

    // The workspace dispatcher hits the same guard for sidebar folder row ids.
    raise.mockClear()
    expect(activateAndRevealWorkspace('folder:fw-1')).toBe(false)
    expect(raise).toHaveBeenCalledWith('folder:fw-1')
  })

  it('does not raise for workspaces whose project is not open elsewhere', () => {
    const raise = stubRaise()
    useAppStore.setState({
      projectKeysInOtherWindows: new Set(['repo-elsewhere'])
    } as Partial<AppState>)

    // Unknown id fails activation, but the failure is a lookup miss — not a raise.
    expect(activateAndRevealWorktree('repo-free::/wt/a')).toBe(false)
    expect(raise).not.toHaveBeenCalled()
  })
})
