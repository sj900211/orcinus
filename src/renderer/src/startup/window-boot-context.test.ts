import { describe, expect, it } from 'vitest'
import { getWindowBootContext } from './window-boot-context'

describe('getWindowBootContext', () => {
  it('defaults to the main role without an orca-worktree param', () => {
    expect(getWindowBootContext('')).toEqual({ role: 'main' })
    expect(getWindowBootContext('?view=board')).toEqual({ role: 'main' })
  })

  it('treats an empty orca-worktree value as the main role', () => {
    expect(getWindowBootContext('?orca-worktree=')).toEqual({ role: 'main' })
  })

  it('returns the workspace role with the decoded worktree id', () => {
    expect(getWindowBootContext('?orca-worktree=wt-1')).toEqual({
      role: 'workspace',
      worktreeId: 'wt-1'
    })
    expect(getWindowBootContext(`?orca-worktree=${encodeURIComponent('repo::/a b/c')}`)).toEqual({
      role: 'workspace',
      worktreeId: 'repo::/a b/c'
    })
  })

  it('ignores unrelated params around the worktree id', () => {
    expect(getWindowBootContext('?foo=1&orca-worktree=wt-2&bar=2')).toEqual({
      role: 'workspace',
      worktreeId: 'wt-2'
    })
  })
})
