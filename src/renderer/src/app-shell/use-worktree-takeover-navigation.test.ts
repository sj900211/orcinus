import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Worktree } from '../../../shared/worktree/types'
import { useAppStore } from '../store'
import {
  findTakeoverNavTarget,
  installWorktreeTakeoverNavigation
} from './use-worktree-takeover-navigation'

const initialAppStoreState = useAppStore.getState()

afterEach(() => {
  vi.unstubAllGlobals()
  useAppStore.setState(initialAppStoreState, true)
})

function makeTargetState(overrides: {
  history: (string | { kind: 'task-detail' })[]
  index: number
  otherWindowProjects?: string[]
  active?: string | null
  liveIds?: string[]
}): Parameters<typeof findTakeoverNavTarget>[0] {
  const live = new Set(overrides.liveIds ?? [])
  return {
    worktreeNavHistory: overrides.history as never,
    worktreeNavHistoryIndex: overrides.index,
    projectKeysInOtherWindows: new Set(overrides.otherWindowProjects ?? []),
    activeWorktreeId: overrides.active ?? 'repo-taken::/wt/a',
    getKnownWorktreeById: ((id: string) =>
      live.has(id) ? ({ id } as unknown as Worktree) : undefined) as never
  }
}

describe('findTakeoverNavTarget', () => {
  it('back-walks to the most recent live entry whose project is not open in another window', () => {
    const state = makeTargetState({
      history: ['repo-a::/wt', 'repo-b::/wt', 'repo-taken::/wt/a'],
      index: 2,
      otherWindowProjects: ['repo-taken'],
      liveIds: ['repo-a::/wt', 'repo-b::/wt', 'repo-taken::/wt/a']
    })
    expect(findTakeoverNavTarget(state)).toBe('repo-b::/wt')
  })

  it('skips SIBLING worktrees of the windowed project, view sentinels, task-detail entries, and dead worktrees', () => {
    const state = makeTargetState({
      history: [
        'repo-dead::/wt',
        'repo-taken::/wt/sibling',
        'repo-other-window::/wt',
        'tasks',
        { kind: 'task-detail' },
        'repo-live::/wt',
        'automations',
        'repo-taken::/wt/a'
      ],
      index: 7,
      otherWindowProjects: ['repo-taken', 'repo-other-window'],
      liveIds: [
        'repo-taken::/wt/sibling',
        'repo-other-window::/wt',
        'repo-live::/wt',
        'repo-taken::/wt/a'
      ]
    })
    expect(findTakeoverNavTarget(state)).toBe('repo-live::/wt')
  })

  it('skips folder workspaces open in other windows by their own key', () => {
    const state = makeTargetState({
      history: ['folder:fw-owned', 'folder:fw-free', 'repo-taken::/wt/a'],
      index: 2,
      otherWindowProjects: ['repo-taken', 'folder:fw-owned'],
      liveIds: ['folder:fw-owned', 'folder:fw-free', 'repo-taken::/wt/a']
    })
    expect(findTakeoverNavTarget(state)).toBe('folder:fw-free')
  })

  it('skips the taken-over active id even when it repeats earlier in history', () => {
    const state = makeTargetState({
      history: ['repo-taken::/wt/a', 'repo-taken::/wt/a'],
      index: 1,
      otherWindowProjects: ['repo-taken'],
      liveIds: ['repo-taken::/wt/a']
    })
    expect(findTakeoverNavTarget(state)).toBeNull()
  })

  it('returns null when no candidate exists (empty or all-filtered history)', () => {
    expect(findTakeoverNavTarget(makeTargetState({ history: [], index: -1 }))).toBeNull()
    expect(
      findTakeoverNavTarget(
        makeTargetState({ history: ['tasks', 'repo-dead::/wt'], index: 1, liveIds: [] })
      )
    ).toBeNull()
  })

  it('clamps an out-of-range history index', () => {
    const state = makeTargetState({
      history: ['repo-live::/wt'],
      index: 5,
      liveIds: ['repo-live::/wt']
    })
    expect(findTakeoverNavTarget(state)).toBe('repo-live::/wt')
  })
})

describe('installWorktreeTakeoverNavigation', () => {
  it('clears to the landing state when the active project is taken over with no fallback', () => {
    vi.stubGlobal('window', { api: {} })
    const uninstall = installWorktreeTakeoverNavigation()
    try {
      useAppStore.setState({ activeWorktreeId: 'repo-taken::/wt/a', worktreeNavHistory: [] })
      useAppStore.getState().setProjectKeysInOtherWindows(['repo-taken'])
      expect(useAppStore.getState().activeWorktreeId).toBeNull()
    } finally {
      uninstall()
    }
  })

  it('ignores snapshot changes that do not contain the active project', () => {
    const uninstall = installWorktreeTakeoverNavigation()
    try {
      useAppStore.setState({ activeWorktreeId: 'repo-current::/wt' })
      useAppStore.getState().setProjectKeysInOtherWindows(['repo-elsewhere'])
      expect(useAppStore.getState().activeWorktreeId).toBe('repo-current::/wt')
    } finally {
      uninstall()
    }
  })

  it('does nothing after uninstall', () => {
    const uninstall = installWorktreeTakeoverNavigation()
    uninstall()
    useAppStore.setState({ activeWorktreeId: 'repo-taken::/wt/a', worktreeNavHistory: [] })
    useAppStore.getState().setProjectKeysInOtherWindows(['repo-taken'])
    expect(useAppStore.getState().activeWorktreeId).toBe('repo-taken::/wt/a')
  })
})
