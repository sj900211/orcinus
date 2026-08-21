import { describe, expect, it } from 'vitest'
import type { Worktree } from '../../../shared/worktree/types'
import {
  collectProjectWindowReconnectKeys,
  collectProjectWorkspaceKeys,
  resolveProjectBootWorkspaceKey
} from './project-window-boot-workspace'

function worktree(id: string): Worktree {
  return { id } as unknown as Worktree
}

function makeState(overrides: {
  worktreesByRepo?: Record<string, Worktree[]>
  lastVisitedAtByWorktreeId?: Record<string, number>
}) {
  return {
    worktreesByRepo: overrides.worktreesByRepo ?? {},
    lastVisitedAtByWorktreeId: overrides.lastVisitedAtByWorktreeId ?? {}
  }
}

describe('collectProjectWorkspaceKeys', () => {
  it('returns every hydrated worktree of a git project, deduped', () => {
    const state = makeState({
      worktreesByRepo: {
        'repo-1': [worktree('repo-1::/a'), worktree('repo-1::/b'), worktree('repo-1::/a')],
        'repo-2': [worktree('repo-2::/x')]
      }
    })
    expect(collectProjectWorkspaceKeys(state, 'repo-1')).toEqual(['repo-1::/a', 'repo-1::/b'])
  })

  it('returns the folder key itself for a folder workspace project', () => {
    expect(collectProjectWorkspaceKeys(makeState({}), 'folder:fw-1')).toEqual(['folder:fw-1'])
  })

  it('returns empty for an unknown git project', () => {
    expect(collectProjectWorkspaceKeys(makeState({}), 'repo-unknown')).toEqual([])
  })
})

describe('collectProjectWindowReconnectKeys', () => {
  it('appends an explicit boot worktree the hydrated catalog lags', () => {
    const state = makeState({ worktreesByRepo: { 'repo-1': [worktree('repo-1::/a')] } })
    expect(
      collectProjectWindowReconnectKeys(state, { projectKey: 'repo-1', worktreeId: 'repo-1::/new' })
    ).toEqual(['repo-1::/a', 'repo-1::/new'])
  })

  it('does not duplicate a boot worktree already in the catalog', () => {
    const state = makeState({ worktreesByRepo: { 'repo-1': [worktree('repo-1::/a')] } })
    expect(
      collectProjectWindowReconnectKeys(state, { projectKey: 'repo-1', worktreeId: 'repo-1::/a' })
    ).toEqual(['repo-1::/a'])
  })
})

describe('resolveProjectBootWorkspaceKey', () => {
  it('picks the most recently visited worktree of the project', () => {
    const state = makeState({
      worktreesByRepo: {
        'repo-1': [worktree('repo-1::/a'), worktree('repo-1::/b'), worktree('repo-1::/c')]
      },
      lastVisitedAtByWorktreeId: {
        'repo-1::/a': 100,
        'repo-1::/b': 300,
        'repo-1::/c': 200,
        'repo-2::/x': 999
      }
    })
    expect(resolveProjectBootWorkspaceKey(state, 'repo-1')).toBe('repo-1::/b')
  })

  it('falls back to the first hydrated worktree when nothing was visited', () => {
    const state = makeState({
      worktreesByRepo: { 'repo-1': [worktree('repo-1::/first'), worktree('repo-1::/second')] }
    })
    expect(resolveProjectBootWorkspaceKey(state, 'repo-1')).toBe('repo-1::/first')
  })

  it('resolves a folder project to its own key', () => {
    expect(resolveProjectBootWorkspaceKey(makeState({}), 'folder:fw-1')).toBe('folder:fw-1')
  })

  it('returns null when a git project has no hydrated worktrees', () => {
    expect(resolveProjectBootWorkspaceKey(makeState({}), 'repo-empty')).toBeNull()
  })
})
