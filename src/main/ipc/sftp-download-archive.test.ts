import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  showSaveDialogMock,
  fromWebContentsMock,
  createWriteStreamMock,
  renameMock,
  unlinkMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  fromWebContentsMock: vi.fn(() => null),
  createWriteStreamMock: vi.fn(),
  renameMock: vi.fn(async (..._args: unknown[]) => {}),
  unlinkMock: vi.fn(async (..._args: unknown[]) => {})
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: vi.fn() },
  dialog: { showSaveDialog: showSaveDialogMock },
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))

vi.mock('node:fs', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs')>()),
  createWriteStream: createWriteStreamMock
}))
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  rename: renameMock,
  unlink: unlinkMock
}))

import { registerSftpArchiveHandlers } from './sftp-download-archive'
import { SftpConnectionAccessFailure } from '../ssh/sftp-connection'

type Handler = (event: unknown, args: unknown) => Promise<unknown>

function makeChannel(exitCode = 0): EventEmitter & Record<string, unknown> {
  const channel = new EventEmitter() as EventEmitter & Record<string, unknown>
  channel.stderr = new EventEmitter()
  channel.close = vi.fn()
  // Simulate tar streaming to completion: exit (before close), the file flushes, the channel closes.
  channel.pipe = vi.fn((ws: EventEmitter) => {
    setImmediate(() => {
      channel.emit('data', Buffer.from('archive-bytes'))
      channel.emit('exit', exitCode)
      ws.emit('finish')
      channel.emit('close')
    })
    return ws
  })
  return channel
}

// A channel that streams but never finishes on its own — used to exercise mid-stream cancel.
function makeHangingChannel(): EventEmitter & Record<string, unknown> {
  const channel = new EventEmitter() as EventEmitter & Record<string, unknown>
  channel.stderr = new EventEmitter()
  channel.close = vi.fn()
  channel.pipe = vi.fn(() => channel)
  return channel
}

function makeWriteStream(): EventEmitter & { destroy: ReturnType<typeof vi.fn> } {
  return Object.assign(new EventEmitter(), { destroy: vi.fn() })
}

function createGetSftpConnection(
  execMock: ReturnType<typeof vi.fn>
): (id: string) => Promise<unknown> {
  return async (id: string) => {
    if (id !== 'target-1') {
      throw new SftpConnectionAccessFailure({
        kind: 'unknown-target',
        message: `SSH connection "${id}" not found`
      })
    }
    return { exec: execMock }
  }
}

function createSender(): EventEmitter & {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), { id: 9, isDestroyed: () => false, send: vi.fn() })
}

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c) => c[0] === channel)
  if (!call) {
    throw new Error(`handler not registered: ${channel}`)
  }
  return call[1] as Handler
}

function register(execMock: ReturnType<typeof vi.fn>): void {
  registerSftpArchiveHandlers({
    getSftpConnection: createGetSftpConnection(execMock) as never,
    transfers: new Map(),
    ensureDestroyedCleanup: vi.fn()
  })
}

describe('sftp:downloadArchive', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContentsMock.mockReturnValue(null)
    createWriteStreamMock.mockImplementation(() => makeWriteStream())
    renameMock.mockResolvedValue(undefined)
    unlinkMock.mockResolvedValue(undefined)
  })

  it('returns {canceled} when the save dialog is canceled', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined })
    register(vi.fn(async () => makeChannel()))
    const result = await getHandler('sftp:downloadArchive')(
      { sender: createSender() },
      { targetId: 'target-1', remotePath: '/remote/images' }
    )
    expect(result).toEqual({ canceled: true })
  })

  it('runs a shell-safe tar, streams to a temp file, then renames onto the destination', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/images.tar.gz' })
    const execMock = vi.fn(async () => makeChannel(0))
    const sender = createSender()
    register(execMock)
    const result = (await getHandler('sftp:downloadArchive')(
      { sender },
      { targetId: 'target-1', remotePath: '/remote/images' }
    )) as { transferId: string }

    expect(typeof result.transferId).toBe('string')
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    // -C <parent> keeps members relative; both parent and name are single-quoted (injection guard).
    expect(execMock).toHaveBeenCalledWith(
      "tar -czf - -C '/remote' 'images'",
      expect.objectContaining({ signal: expect.any(Object) })
    )
    expect(renameMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/local\/images\.tar\.gz\.orcinus-part-/),
      '/local/images.tar.gz'
    )
    const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
    expect(phases).toContain('start')
    expect(phases).toContain('done')
  })

  it('surfaces a non-zero tar exit as an error and removes the temp file (no rename)', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/images.tar.gz' })
    const sender = createSender()
    register(vi.fn(async () => makeChannel(2)))
    await getHandler('sftp:downloadArchive')(
      { sender },
      { targetId: 'target-1', remotePath: '/remote/images' }
    )
    await new Promise((r) => setImmediate(r))
    await new Promise((r) => setImmediate(r))

    expect(renameMock).not.toHaveBeenCalled()
    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/local\/images\.tar\.gz\.orcinus-part-/)
    )
    const errorPhase = sender.send.mock.calls
      .map((c) => c[1] as { phase: string })
      .find((p) => p.phase === 'error')
    expect(errorPhase).toBeDefined()
  })

  it('returns a typed error for an unknown targetId', async () => {
    register(vi.fn(async () => makeChannel()))
    const result = await getHandler('sftp:downloadArchive')(
      { sender: createSender() },
      { targetId: 'nope', remotePath: '/remote/images' }
    )
    expect(result).toEqual({ error: 'SSH connection "nope" not found' })
  })

  it('cancel settles the transfer: emits canceled, removes the temp file, never renames', async () => {
    showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/images.tar.gz' })
    const transfers = new Map<string, { controller: AbortController; senderId: number }>()
    const sender = createSender()
    registerSftpArchiveHandlers({
      getSftpConnection: createGetSftpConnection(vi.fn(async () => makeHangingChannel())) as never,
      transfers,
      ensureDestroyedCleanup: vi.fn()
    })
    const result = (await getHandler('sftp:downloadArchive')(
      { sender },
      { targetId: 'target-1', remotePath: '/remote/images' }
    )) as { transferId: string }
    await new Promise((r) => setImmediate(r))

    // Abort mid-stream via the shared transfer session (what sftp:cancelTransfer does).
    transfers.get(result.transferId)!.controller.abort()
    await new Promise((r) => setImmediate(r))

    const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
    expect(phases).toContain('canceled')
    expect(renameMock).not.toHaveBeenCalled()
    expect(unlinkMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/local\/images\.tar\.gz\.orcinus-part-/)
    )
  })
})
