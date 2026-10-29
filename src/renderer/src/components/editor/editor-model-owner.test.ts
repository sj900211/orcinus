import { describe, expect, it } from 'vitest'
import type { OpenFile } from '@/store/slices/editor'
import type {
  WorktreeOperationRoute,
  WorktreeOperationRouteState
} from '@/lib/worktree-operation-route'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { detachedEditorBufferId } from '@/store/slices/editor/buffers/editor-buffer-views'
import { getEditorModelOwnerKey, resolveEditorModelOwner } from './editor-model-owner'
import { toEditorModelUri } from './editor-model-uri'

function file(overrides: Partial<OpenFile> = {}): OpenFile {
  return {
    id: 'file',
    filePath: '/srv/repo/file.ts',
    relativePath: 'file.ts',
    worktreeId: 'repo::/srv/repo',
    language: 'typescript',
    mode: 'edit',
    isDirty: false,
    ...overrides
  }
}

function captured(route: WorktreeOperationRoute): OpenFile['operationProvenance'] {
  return {
    ownershipProjection: 'explicit',
    generation: {
      route,
      runtimeConnectionGeneration: null,
      runtimePairingRevision: undefined,
      runtimeSshGeneration: null,
      nestedSshGeneration: null,
      directSshGeneration: null
    }
  }
}

const localState: WorktreeOperationRouteState = {
  worktreesByRepo: { repo: [{ id: 'repo::/srv/repo', repoId: 'repo', hostId: 'local' }] }
}

describe('editor model ownership', () => {
  it('shares local physical files across workspace and tab identities', () => {
    expect(getEditorModelOwnerKey(file(), localState)).toBe('')
    expect(
      getEditorModelOwnerKey(
        file({
          id: 'other',
          worktreeId: 'other',
          operationProvenance: captured({ executionHostId: 'local', runtimeEnvironmentId: null })
        }),
        {}
      )
    ).toBe('')
  })

  it('keeps captured ownership when the focused host changes', () => {
    const opened = file({
      operationProvenance: captured({
        executionHostId: 'ssh:target',
        runtimeEnvironmentId: 'hub-a'
      })
    })
    const key = getEditorModelOwnerKey(opened, {})
    expect(
      getEditorModelOwnerKey(opened, {
        ...localState,
        activeWorktreeId: opened.worktreeId,
        activeWorkspaceExecutionHostId: 'runtime:hub-b'
      })
    ).toBe(key)
    expect(key).toBe('["hub-a","ssh:target"]')
  })

  it('keeps distinct paired transports to the same target separate', () => {
    const keys = ['hub-a', 'hub-b'].map((runtimeEnvironmentId) =>
      getEditorModelOwnerKey(
        file({
          operationProvenance: captured({ executionHostId: 'ssh:target', runtimeEnvironmentId })
        }),
        {}
      )
    )
    expect(keys[0]).not.toBe(keys[1])
    expect(keys).not.toContain(
      getEditorModelOwnerKey(
        file({ externalSshTargetId: 'target', runtimeEnvironmentId: null }),
        {}
      )
    )
  })

  it('uses the tab runtime hint when no owner catalog is present', () => {
    expect(getEditorModelOwnerKey(file({ runtimeEnvironmentId: 'hub-a' }), {})).toBe(
      '["hub-a","runtime:hub-a"]'
    )
    expect(getEditorModelOwnerKey(file({ runtimeEnvironmentId: 'hub-b' }), {})).toBe(
      '["hub-b","runtime:hub-b"]'
    )
  })

  it('honors an explicit local transport hint instead of the focused runtime', () => {
    const opened = file({ runtimeEnvironmentId: null, externalSshTargetId: 'target' })
    const state: WorktreeOperationRouteState = {
      worktreesByRepo: {
        repo: [
          {
            id: opened.worktreeId,
            repoId: 'repo',
            hostId: 'ssh:target',
            runtimeOwnerEnvironmentId: 'hub-a'
          }
        ]
      }
    }
    expect(getEditorModelOwnerKey(opened, state)).toBe('[null,"ssh:target"]')
  })

  it('does not adopt a new active host for a legacy local tab', () => {
    const opened = file()
    expect(
      getEditorModelOwnerKey(opened, {
        ...localState,
        activeWorktreeId: opened.worktreeId,
        activeWorkspaceExecutionHostId: 'ssh:new-target'
      })
    ).toBe('')
  })

  it('keeps unresolved owners separate from local files', () => {
    expect(getEditorModelOwnerKey(file(), {})).not.toBe('')
    expect(getEditorModelOwnerKey(file(), {})).not.toBe(
      getEditorModelOwnerKey(file({ worktreeId: 'another-owner' }), {})
    )
  })

  it('supports local and remote folder workspaces', () => {
    const opened = file({ worktreeId: folderWorkspaceKey('folder') })
    expect(
      getEditorModelOwnerKey(opened, {
        folderWorkspaces: [{ id: 'folder', projectGroupId: 'group', executionHostId: 'local' }]
      })
    ).toBe('')
    expect(
      getEditorModelOwnerKey(opened, {
        folderWorkspaces: [
          { id: 'folder', projectGroupId: 'group', executionHostId: 'runtime:hub-a' }
        ]
      })
    ).toBe('["hub-a","runtime:hub-a"]')
  })

  it('gives a detached record its own model, apart from the file and from other detached records', () => {
    const shared = { ...localState, editorBufferIdOf: { file: 'file', other: 'file' } }
    const detached = {
      ...localState,
      editorBufferIdOf: { file: detachedEditorBufferId('file'), other: 'file' }
    }
    const detachedUri = toEditorModelUri(file().filePath, getEditorModelOwnerKey(file(), detached))

    expect(getEditorModelOwnerKey(file(), shared)).toBe('')
    expect(getEditorModelOwnerKey(file({ id: 'other' }), detached)).toBe('')
    expect(detachedUri).not.toBe(toEditorModelUri(file().filePath))
    expect(getEditorModelOwnerKey(file(), detached)).not.toBe(
      getEditorModelOwnerKey(file({ id: 'other' }), {
        ...localState,
        editorBufferIdOf: { other: detachedEditorBufferId('other') }
      })
    )
    // The host owner stays in the key: one detached record id on two hosts gets two models.
    const remote = file({ runtimeEnvironmentId: 'env' })
    expect(getEditorModelOwnerKey(remote, detached)).not.toBe(
      getEditorModelOwnerKey(file(), detached)
    )
    expect(JSON.parse(getEditorModelOwnerKey(remote, detached))).toEqual([
      'detached',
      detachedEditorBufferId('file'),
      getEditorModelOwnerKey(remote, localState)
    ])
  })

  // Why: the fork rule is that an SFTP preview never resolves to a local file. Upstream keys the
  // editor buffer record on this owner, so a remote path that keys as `local` shares a record —
  // draft, isDirty and disk signature — with a local tab of the same path (stage-13 critic N1).
  it('separates an SFTP preview from a local tab of the same path', () => {
    const local = file({ filePath: '/repo/app.ts', relativePath: 'app.ts' })
    const preview = file({
      id: 'preview',
      filePath: '/repo/app.ts',
      relativePath: '/repo/app.ts',
      runtimeEnvironmentId: null,
      readOnly: true,
      isPreview: true,
      sftpTargetId: 'host-a'
    })
    expect(getEditorModelOwnerKey(preview, localState)).not.toBe(
      getEditorModelOwnerKey(local, localState)
    )
    expect(resolveEditorModelOwner(preview, localState).hostId).toBe('ssh:host-a')
  })

  // Why ahead of captured provenance: the captured route names the worktree that owns the tab, not
  // the host the bytes live on, so provenance must not pull an SFTP file back to the local key.
  it('keeps the SFTP host even when the tab carries captured local provenance', () => {
    const preview = file({
      id: 'preview-captured',
      filePath: '/repo/app.ts',
      relativePath: '/repo/app.ts',
      runtimeEnvironmentId: null,
      sftpTargetId: 'host-a',
      operationProvenance: captured({ executionHostId: 'local', runtimeEnvironmentId: null })
    })
    expect(resolveEditorModelOwner(preview, localState).hostId).toBe('ssh:host-a')
  })
})
