import { describe, expect, it } from 'vitest'
import { projectKeyForWorkspaceKey } from './project-window-key'

describe('projectKeyForWorkspaceKey', () => {
  it('collapses git worktree ids to their repoId prefix', () => {
    expect(projectKeyForWorkspaceKey('repo-1::/home/dev/wt-a')).toBe('repo-1')
    expect(projectKeyForWorkspaceKey('repo-1::C:\\dev\\wt b')).toBe('repo-1')
  })

  it('keeps folder workspace keys as their own project', () => {
    expect(projectKeyForWorkspaceKey('folder:fw-1')).toBe('folder:fw-1')
  })

  it('maps folder-repo workspace-instance ids to the folder repo', () => {
    // Folder-kind repos mint session ids `repoId::path::workspace:<uuid>`.
    expect(
      projectKeyForWorkspaceKey(
        'repo-f::/home/dev/dir::workspace:0f0e0d0c-0b0a-4090-8070-605040302010'
      )
    ).toBe('repo-f')
  })

  it('is the identity for separator-less keys (a bare repoId owns itself)', () => {
    expect(projectKeyForWorkspaceKey('repo-1')).toBe('repo-1')
  })
})
