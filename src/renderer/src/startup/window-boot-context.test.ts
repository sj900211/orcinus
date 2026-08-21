import { describe, expect, it } from 'vitest'
import { getWindowBootContext } from './window-boot-context'

describe('getWindowBootContext', () => {
  it('defaults to the main role without an orca-project param', () => {
    expect(getWindowBootContext('')).toEqual({ role: 'main' })
    expect(getWindowBootContext('?view=board')).toEqual({ role: 'main' })
  })

  it('treats an empty orca-project value as the main role', () => {
    expect(getWindowBootContext('?orca-project=')).toEqual({ role: 'main' })
  })

  it('ignores a stray orca-worktree without a project (never a half-formed context)', () => {
    expect(getWindowBootContext('?orca-worktree=repo::/wt')).toEqual({ role: 'main' })
  })

  it('returns the workspace role with the decoded project key', () => {
    expect(getWindowBootContext('?orca-project=repo-1')).toEqual({
      role: 'workspace',
      projectKey: 'repo-1'
    })
    expect(getWindowBootContext(`?orca-project=${encodeURIComponent('folder:fw one')}`)).toEqual({
      role: 'workspace',
      projectKey: 'folder:fw one'
    })
  })

  it('carries the optional decoded initial worktree', () => {
    expect(
      getWindowBootContext(`?orca-project=repo&orca-worktree=${encodeURIComponent('repo::/a b/c')}`)
    ).toEqual({ role: 'workspace', projectKey: 'repo', worktreeId: 'repo::/a b/c' })
    // An empty worktree value degrades to project-only boot.
    expect(getWindowBootContext('?orca-project=repo&orca-worktree=')).toEqual({
      role: 'workspace',
      projectKey: 'repo'
    })
  })

  it('ignores unrelated params around the boot params', () => {
    expect(getWindowBootContext('?foo=1&orca-project=repo-2&bar=2')).toEqual({
      role: 'workspace',
      projectKey: 'repo-2'
    })
  })
})
