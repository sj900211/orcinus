import { describe, expect, it } from 'vitest'
import { buildPersistedUnifiedTabSessionData } from './workspace-session-unified-tabs'
import { buildSftpEditorFileId } from '../store/slices/editor/file-ids/editor-file-ids'
import type { Tab, TabGroup, TabGroupLayoutNode } from '../../../shared/tab-types'

function tab(id: string, entityId: string, contentType: Tab['contentType']): Tab {
  return {
    id,
    entityId,
    groupId: 'g1',
    worktreeId: 'wt-1',
    contentType,
    label: id,
    customLabel: null,
    color: null,
    sortOrder: 0,
    createdAt: 0
  }
}

describe('buildPersistedUnifiedTabSessionData — SFTP tab exclusion', () => {
  it('drops the SFTP editor tab (its OpenFile is not persisted) but keeps a local editor tab', () => {
    const sftpEntityId = buildSftpEditorFileId('host-1', 'wt-1', '/remote/b.ts')
    const group: TabGroup = {
      id: 'g1',
      worktreeId: 'wt-1',
      activeTabId: 't2',
      tabOrder: ['t1', 't2']
    }
    const layout: TabGroupLayoutNode = { type: 'leaf', groupId: 'g1' }
    const result = buildPersistedUnifiedTabSessionData({
      unifiedTabsByWorktree: {
        'wt-1': [tab('t1', '/local/a.ts', 'editor'), tab('t2', sftpEntityId, 'editor')]
      },
      groupsByWorktree: { 'wt-1': [group] },
      layoutByWorktree: { 'wt-1': layout },
      activeGroupIdByWorktree: { 'wt-1': 'g1' }
    })

    expect(result.unifiedTabs?.['wt-1']?.map((t) => t.id)).toEqual(['t1'])
    expect(result.tabGroups?.['wt-1']?.[0]?.tabOrder).toEqual(['t1'])
    // The group's active tab pointed at the now-dropped SFTP tab → must not persist as active.
    expect(result.tabGroups?.['wt-1']?.[0]?.activeTabId).not.toBe('t2')
  })
})
