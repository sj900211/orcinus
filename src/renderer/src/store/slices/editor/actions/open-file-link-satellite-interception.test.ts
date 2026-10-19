import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createEditorTabsStore } from '../../editor-slice-test-harness'
import { captureEditorOpenLinkIntent } from '../tabs/editor-open-target-group'
import type { OpenFile } from '../types/open-file'

vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))

const activateFile = vi.fn(() => Promise.resolve({ ok: true }))

function fileInput(filePath: string): Omit<OpenFile, 'id' | 'isDirty'> {
  return {
    filePath,
    relativePath: filePath.replace('/repo/', ''),
    worktreeId: 'wt-1',
    language: 'typescript',
    mode: 'edit'
  }
}

function storeWithSatelliteFile(filePath: string) {
  const store = createEditorTabsStore()
  store.getState().createUnifiedTab('wt-1', 'terminal', { id: 'source', label: 'source' })
  store.setState({
    satelliteMirror: [
      {
        satelliteId: 'sat-1',
        worktreeId: 'wt-1',
        visible: true,
        files: [{ fileId: filePath, filePath, relativePath: 'a.ts', language: 'typescript' }]
      }
    ]
  })
  return store
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('window', { api: { satelliteWindow: { activateFile } } })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

// Fork: the gate lives in the shared open() behind openFile and openFileForLink (#30399 split it).
it('raises the satellite instead of opening a terminal link to a satellite-resident file', () => {
  const store = storeWithSatelliteFile('/repo/a.ts')
  const intent = captureEditorOpenLinkIntent(store.getState(), 'wt-1', 'source')

  expect(store.getState().openFileForLink(fileInput('/repo/a.ts'), {}, intent)).toBeNull()
  expect(store.getState().openFiles).toEqual([])
  expect(activateFile).toHaveBeenCalledWith('sat-1', {
    filePath: '/repo/a.ts',
    relativePath: 'a.ts',
    language: 'typescript'
  })
})

it('keeps the plain open returning the satellite file id', () => {
  const store = storeWithSatelliteFile('/repo/a.ts')

  expect(store.getState().openFile(fileInput('/repo/a.ts'))).toBe('/repo/a.ts')
  expect(store.getState().openFiles).toEqual([])
  expect(activateFile).toHaveBeenCalledOnce()
})

it('opens a link to a file no satellite holds', () => {
  const store = storeWithSatelliteFile('/repo/a.ts')
  const intent = captureEditorOpenLinkIntent(store.getState(), 'wt-1', 'source')

  expect(store.getState().openFileForLink(fileInput('/repo/b.ts'), {}, intent)).not.toBeNull()
  expect(store.getState().openFiles.map((file) => file.filePath)).toEqual(['/repo/b.ts'])
  expect(activateFile).not.toHaveBeenCalled()
})
