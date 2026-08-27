import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  realpathMock,
  statMock,
  lstatRawMock,
  classifyMock,
  deconflictMock,
  downloadFileIntoMock,
  downloadDirectoryMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  realpathMock: vi.fn(async (path: string) => path),
  statMock: vi.fn(async (_path: string): Promise<{ isDirectory: () => boolean }> => ({
    isDirectory: () => true
  })),
  lstatRawMock: vi.fn(async (_sftp: unknown, _path: string): Promise<unknown> => ({})),
  classifyMock: vi.fn((_attrs: unknown): 'file' | 'directory' | 'skip' => 'file'),
  // Default: no collision, so the sanitized name is used as-is.
  deconflictMock: vi.fn(async (_dir: string, name: string, _reserved: Set<string>) => name),
  downloadFileIntoMock: vi.fn(async (..._args: unknown[]) => {}),
  downloadDirectoryMock: vi.fn(async (..._args: unknown[]) => {})
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: vi.fn() }
}))

vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  realpath: realpathMock,
  stat: statMock
}))

vi.mock('../providers/ssh-filesystem-provider-sftp', () => ({
  lstatRawViaSftp: lstatRawMock
}))

vi.mock('../ssh/sftp-download-batch', () => ({
  downloadFileInto: downloadFileIntoMock,
  downloadDirectory: downloadDirectoryMock,
  classifyRemoteEntry: classifyMock
}))

vi.mock('./filesystem-import-local', () => ({ deconflictName: deconflictMock }))

import { registerSftpDownloadHandlers } from './sftp-download-handlers'
import { SftpConnectionAccessFailure } from '../ssh/sftp-connection'

type Handler = (event: unknown, args: unknown) => Promise<unknown>

function createSftp(): Record<string, unknown> {
  return { end: vi.fn() }
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
  return Object.assign(new EventEmitter(), { id: 7, isDestroyed: () => false, send: vi.fn() })
}

function register(sftp: Record<string, unknown>): void {
  registerSftpDownloadHandlers({
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

describe('sftp:downloadToDir', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realpathMock.mockImplementation(async (path: string) => path)
    statMock.mockImplementation(async () => ({ isDirectory: () => true }))
    // lstat returns a path-tagged attrs so classify can decide per path.
    lstatRawMock.mockImplementation(async (_sftp: unknown, path: string) => ({ path }))
    classifyMock.mockReturnValue('file')
    deconflictMock.mockImplementation(async (_dir: string, name: string) => name)
    downloadFileIntoMock.mockResolvedValue(undefined)
    downloadDirectoryMock.mockResolvedValue(undefined)
  })

  it('downloads a remote file into the dest dir under its basename, emits start + done', async () => {
    const sftp = createSftp()
    const sender = createSender()
    register(sftp)
    const result = (await getHandler('sftp:downloadToDir')(
      { sender },
      { targetId: 'target-1', remotePaths: ['/remote/dir/report.txt'], localDir: '/local/dest' }
    )) as { transferId: string }

    expect(typeof result.transferId).toBe('string')
    await new Promise((r) => setImmediate(r))

    expect(downloadFileIntoMock).toHaveBeenCalledWith(
      sftp,
      '/remote/dir/report.txt',
      expect.stringMatching(/report\.txt$/),
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(downloadDirectoryMock).not.toHaveBeenCalled()
    const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
    expect(phases).toContain('start')
    expect(phases).toContain('done')
  })

  it('walks a remote directory recursively (downloadDirectory)', async () => {
    const sftp = createSftp()
    register(sftp)
    classifyMock.mockReturnValue('directory')
    await getHandler('sftp:downloadToDir')(
      { sender: createSender() },
      { targetId: 'target-1', remotePaths: ['/remote/project'], localDir: '/local/dest' }
    )
    await new Promise((r) => setImmediate(r))

    expect(downloadDirectoryMock).toHaveBeenCalledWith(
      sftp,
      '/remote/project',
      expect.stringMatching(/project$/),
      expect.any(Object)
    )
    expect(downloadFileIntoMock).not.toHaveBeenCalled()
  })

  it('skips a top-level symlink / mode-less entry but downloads a sibling file', async () => {
    const sftp = createSftp()
    register(sftp)
    // classify reads the path-tagged attrs from lstatRawMock; /remote/link is untrusted -> skip.
    classifyMock.mockImplementation((attrs: unknown) =>
      (attrs as { path?: string })?.path === '/remote/link' ? 'skip' : 'file'
    )
    await getHandler('sftp:downloadToDir')(
      { sender: createSender() },
      { targetId: 'target-1', remotePaths: ['/remote/link', '/remote/a.txt'], localDir: '/local/dest' }
    )
    await new Promise((r) => setImmediate(r))

    expect(downloadFileIntoMock).toHaveBeenCalledTimes(1)
    expect(downloadFileIntoMock).toHaveBeenCalledWith(
      sftp,
      '/remote/a.txt',
      expect.stringMatching(/a\.txt$/),
      expect.any(Object)
    )
  })

  it('deconflicts the destination name so an existing local file is not overwritten', async () => {
    const sftp = createSftp()
    register(sftp)
    deconflictMock.mockImplementation(async (_dir: string, name: string) => `renamed-${name}`)
    await getHandler('sftp:downloadToDir')(
      { sender: createSender() },
      { targetId: 'target-1', remotePaths: ['/remote/report.txt'], localDir: '/local/dest' }
    )
    await new Promise((r) => setImmediate(r))

    expect(downloadFileIntoMock).toHaveBeenCalledWith(
      sftp,
      '/remote/report.txt',
      expect.stringMatching(/renamed-report\.txt$/),
      expect.any(Object)
    )
  })

  it('sanitizes a crafted basename so it cannot traverse the dest dir', async () => {
    const sftp = createSftp()
    register(sftp)
    await getHandler('sftp:downloadToDir')(
      { sender: createSender() },
      { targetId: 'target-1', remotePaths: ['/remote/..'], localDir: '/local/dest' }
    )
    await new Promise((r) => setImmediate(r))

    // basename('/remote/..') === '..' → sanitized to 'download', never an escaping path.
    expect(downloadFileIntoMock).toHaveBeenCalledWith(
      sftp,
      '/remote/..',
      expect.stringMatching(/download$/),
      expect.any(Object)
    )
  })

  it('rejects an empty or non-string remotePaths list', async () => {
    register(createSftp())
    expect(
      await getHandler('sftp:downloadToDir')(
        { sender: createSender() },
        { targetId: 'target-1', remotePaths: [], localDir: '/local/dest' }
      )
    ).toEqual({ error: 'No paths to download' })
    expect(
      await getHandler('sftp:downloadToDir')(
        { sender: createSender() },
        { targetId: 'target-1', remotePaths: ['/ok', ''], localDir: '/local/dest' }
      )
    ).toEqual({ error: 'No paths to download' })
  })

  it('rejects a destination that is not a directory', async () => {
    register(createSftp())
    statMock.mockImplementation(async () => ({ isDirectory: () => false }))
    expect(
      await getHandler('sftp:downloadToDir')(
        { sender: createSender() },
        { targetId: 'target-1', remotePaths: ['/remote/a.txt'], localDir: '/local/file.txt' }
      )
    ).toEqual({ error: 'Destination is not a directory' })
  })

  it('returns a typed error for an unknown targetId', async () => {
    register(createSftp())
    expect(
      await getHandler('sftp:downloadToDir')(
        { sender: createSender() },
        { targetId: 'nope', remotePaths: ['/remote/a.txt'], localDir: '/local/dest' }
      )
    ).toEqual({ error: 'SSH connection "nope" not found' })
  })
})
