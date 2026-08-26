import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, showOpenDialogMock, fromWebContentsMock, uploadFilesIntoMock } = vi.hoisted(
  () => ({
    handleMock: vi.fn(),
    showOpenDialogMock: vi.fn(),
    fromWebContentsMock: vi.fn(() => null),
    uploadFilesIntoMock: vi.fn(async (..._args: unknown[]) => {})
  })
)

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: vi.fn() },
  dialog: { showOpenDialog: showOpenDialogMock },
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))

vi.mock('../ssh/sftp-upload-batch', () => ({ uploadFilesInto: uploadFilesIntoMock }))

import { registerSftpUploadHandlers } from './sftp-upload-handlers'
import { SftpConnectionAccessFailure } from '../ssh/sftp-connection'

type Handler = (event: unknown, args: unknown) => Promise<unknown>

function createSftp(existing: string[] = []): Record<string, unknown> {
  return {
    end: vi.fn(),
    lstat: vi.fn((p: string, cb: (err: Error | null) => void) =>
      cb(existing.includes(p) ? null : new Error('ENOENT'))
    )
  }
}

function createGetSftpConnection(sftp: Record<string, unknown>): (id: string) => Promise<unknown> {
  return async (id: string) => {
    if (id !== 'target-1') {
      throw new SftpConnectionAccessFailure({
        kind: 'unknown-target',
        message: `SSH connection "${id}" not found`
      })
    }
    return { sftp: vi.fn(async () => sftp) }
  }
}

function createSender(): EventEmitter & {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), { id: 3, isDestroyed: () => false, send: vi.fn() })
}

function register(sftp: Record<string, unknown>): void {
  registerSftpUploadHandlers({
    getSftpConnection: createGetSftpConnection(sftp) as never,
    transfers: new Map(),
    ensureDestroyedCleanup: vi.fn()
  })
}

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c) => c[0] === channel)
  if (!call) {
    throw new Error(`handler not registered: ${channel}`)
  }
  return call[1] as Handler
}

describe('sftp:planUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContentsMock.mockReturnValue(null)
  })

  it('returns {canceled} when the picker is canceled', async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
    register(createSftp())
    const result = await getHandler('sftp:planUpload')(
      { sender: createSender() },
      { targetId: 'target-1', remoteDir: '/remote/dir' }
    )
    expect(result).toEqual({ canceled: true })
  })

  it('flags remote name collisions per picked file', async () => {
    showOpenDialogMock.mockResolvedValue({
      canceled: false,
      filePaths: ['/local/a.txt', '/local/b.txt']
    })
    // Only a.txt already exists remotely.
    register(createSftp(['/remote/dir/a.txt']))
    const result = await getHandler('sftp:planUpload')(
      { sender: createSender() },
      { targetId: 'target-1', remoteDir: '/remote/dir' }
    )
    expect(result).toEqual({
      items: [
        { name: 'a.txt', localPath: '/local/a.txt', conflict: true },
        { name: 'b.txt', localPath: '/local/b.txt', conflict: false }
      ]
    })
  })

  it('returns a typed error for an unknown targetId', async () => {
    register(createSftp())
    const result = await getHandler('sftp:planUpload')(
      { sender: createSender() },
      { targetId: 'nope', remoteDir: '/remote/dir' }
    )
    expect(result).toEqual({ error: 'SSH connection "nope" not found' })
  })
})

describe('sftp:performUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContentsMock.mockReturnValue(null)
    uploadFilesIntoMock.mockResolvedValue(undefined)
  })

  it('uploads the resolved set and emits start + done', async () => {
    const sftp = createSftp()
    const sender = createSender()
    register(sftp)
    const uploads = [{ localPath: '/local/a.txt', remoteName: 'a.txt', overwrite: true }]
    const result = (await getHandler('sftp:performUpload')(
      { sender },
      { targetId: 'target-1', remoteDir: '/remote/dir', uploads }
    )) as { transferId: string }

    expect(typeof result.transferId).toBe('string')
    await new Promise((r) => setImmediate(r))

    expect(uploadFilesIntoMock).toHaveBeenCalledWith(
      sftp,
      uploads,
      '/remote/dir',
      expect.objectContaining({ onProgress: expect.any(Function) })
    )
    const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
    expect(phases).toContain('start')
    expect(phases).toContain('done')
  })

  it('rejects an empty upload set', async () => {
    register(createSftp())
    const result = await getHandler('sftp:performUpload')(
      { sender: createSender() },
      { targetId: 'target-1', remoteDir: '/remote/dir', uploads: [] }
    )
    expect(result).toEqual({ error: 'No files to upload' })
  })

  it.each(['../evil', '..', '.', 'a/b', 'a\\b', ''])(
    'rejects a remoteName that is not a single path segment: %j (traversal guard)',
    async (remoteName) => {
      register(createSftp())
      const result = await getHandler('sftp:performUpload')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          remoteDir: '/remote/dir',
          uploads: [{ localPath: '/local/a.txt', remoteName, overwrite: false }]
        }
      )
      expect(result).toEqual({ error: 'Invalid upload entry' })
      expect(uploadFilesIntoMock).not.toHaveBeenCalled()
    }
  )

  it('returns a typed error for an unknown targetId', async () => {
    register(createSftp())
    const result = await getHandler('sftp:performUpload')(
      { sender: createSender() },
      {
        targetId: 'nope',
        remoteDir: '/remote/dir',
        uploads: [{ localPath: '/local/a.txt', remoteName: 'a.txt', overwrite: false }]
      }
    )
    expect(result).toEqual({ error: 'SSH connection "nope" not found' })
  })
})
