import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createMarkdownPreviewActions } from './markdown-preview-actions'
import { buildSftpEditorFileId } from '../file-ids/editor-file-ids'
import type { OpenFile } from '../types/open-file'

vi.mock('../tabs/workspace-editor-item', () => ({ openWorkspaceEditorItem: vi.fn() }))
vi.mock('../tabs/editor-open-target-group', () => ({ buildEditorActiveResult: () => ({}) }))

type FakeState = { settings: Record<string, unknown>; openFiles: OpenFile[] }

function makeStore(openFiles: OpenFile[]): {
  get: () => FakeState
  set: (updater: unknown) => void
  state: FakeState
} {
  const store = { state: { settings: {}, openFiles } as FakeState }
  const get = (): FakeState => store.state
  const set = (updater: unknown): void => {
    const patch =
      typeof updater === 'function' ? (updater as (s: FakeState) => Partial<FakeState>)(store.state) : updater
    store.state = { ...store.state, ...(patch as Partial<FakeState>) }
  }
  return { get, set, get state() { return store.state } }
}

function sftpSourceTab(): OpenFile {
  return {
    id: buildSftpEditorFileId('host-1', 'wt-1', '/remote/readme.md'),
    filePath: '/remote/readme.md',
    relativePath: '/remote/readme.md',
    worktreeId: 'wt-1',
    language: 'markdown',
    isDirty: false,
    readOnly: true,
    sftpTargetId: 'host-1',
    mode: 'edit'
  }
}

describe('openMarkdownPreview — SFTP source', () => {
  beforeEach(() => vi.clearAllMocks())

  it('derives the SFTP host from the source tab so the preview reads remote content', () => {
    const source = sftpSourceTab()
    const store = makeStore([source])
    const actions = createMarkdownPreviewActions(store.set as never, store.get as never)

    // Mirrors the toolbar/shortcut callers: a stripped file (no sftpTargetId) + sourceFileId.
    actions.openMarkdownPreview(
      {
        filePath: source.filePath,
        relativePath: source.relativePath,
        worktreeId: source.worktreeId,
        language: 'markdown',
        runtimeEnvironmentId: null
      },
      { sourceFileId: source.id }
    )

    const preview = store.state.openFiles.find((f) => f.mode === 'markdown-preview')
    expect(preview).toBeDefined()
    expect(preview?.sftpTargetId).toBe('host-1')
    expect(preview?.markdownPreviewSourceFileId).toBe(source.id)
  })

  it('leaves a local preview with no sftpTargetId (no remote routing)', () => {
    const local: OpenFile = {
      id: '/repo/readme.md',
      filePath: '/repo/readme.md',
      relativePath: 'readme.md',
      worktreeId: 'wt-1',
      language: 'markdown',
      isDirty: false,
      mode: 'edit'
    }
    const store = makeStore([local])
    const actions = createMarkdownPreviewActions(store.set as never, store.get as never)
    actions.openMarkdownPreview(
      {
        filePath: local.filePath,
        relativePath: local.relativePath,
        worktreeId: local.worktreeId,
        language: 'markdown',
        runtimeEnvironmentId: null
      },
      { sourceFileId: local.id }
    )
    const preview = store.state.openFiles.find((f) => f.mode === 'markdown-preview')
    expect(preview?.sftpTargetId).toBeUndefined()
  })
})
