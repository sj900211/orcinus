import { describe, expect, it } from 'vitest'
import {
  buildSftpEditorFileId,
  isSftpEditorFileId,
  SFTP_EDITOR_FILE_ID_PREFIX
} from './editor-file-ids'

describe('SFTP editor file ids', () => {
  it('namespaces by host so the same path on two hosts is distinct', () => {
    const a = buildSftpEditorFileId('host-1', 'wt-1', '/srv/app/config.yaml')
    const b = buildSftpEditorFileId('host-2', 'wt-1', '/srv/app/config.yaml')
    expect(a).not.toBe(b)
    expect(a.startsWith(SFTP_EDITOR_FILE_ID_PREFIX)).toBe(true)
  })

  it('is distinct from the bare-path id a local file at the same path would claim', () => {
    const sftpId = buildSftpEditorFileId('host-1', 'wt-1', '/srv/app/config.yaml')
    expect(sftpId).not.toBe('/srv/app/config.yaml')
    expect(isSftpEditorFileId(sftpId)).toBe(true)
    expect(isSftpEditorFileId('/srv/app/config.yaml')).toBe(false)
    expect(isSftpEditorFileId('editor:wt-1:local:%2Fsrv%2Fapp')).toBe(false)
  })

  it('round-trips a host/worktree/path into an encoded, collision-safe id', () => {
    // Different worktrees or paths must not collide either.
    expect(buildSftpEditorFileId('h', 'wt-1', '/a')).not.toBe(buildSftpEditorFileId('h', 'wt-2', '/a'))
    expect(buildSftpEditorFileId('h', 'wt-1', '/a')).not.toBe(buildSftpEditorFileId('h', 'wt-1', '/b'))
  })
})
