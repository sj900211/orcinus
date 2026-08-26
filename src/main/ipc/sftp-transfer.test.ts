import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  handleMock,
  removeHandlerMock,
  showOpenDialogMock,
  showSaveDialogMock,
  fromWebContentsMock,
  uploadFileMock,
  mkdirSftpMock,
  fastGetViaSftpMock,
  unlinkMock,
  renameMock,
  statMock
} = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  showOpenDialogMock: vi.fn(),
  showSaveDialogMock: vi.fn(),
  fromWebContentsMock: vi.fn(() => null),
  uploadFileMock: vi.fn(async (..._args: unknown[]) => {}),
  mkdirSftpMock: vi.fn(async (..._args: unknown[]) => {}),
  fastGetViaSftpMock: vi.fn(async (..._args: unknown[]) => {}),
  unlinkMock: vi.fn(async (..._args: unknown[]) => {}),
  renameMock: vi.fn(async (..._args: unknown[]) => {}),
  statMock: vi.fn(async (..._args: unknown[]) => ({ size: 10 }))
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock },
  dialog: { showOpenDialog: showOpenDialogMock, showSaveDialog: showSaveDialogMock },
  BrowserWindow: { fromWebContents: fromWebContentsMock }
}))

vi.mock('node:fs/promises', () => ({
  unlink: unlinkMock,
  rename: renameMock,
  stat: statMock
}))

vi.mock('../ssh/sftp-upload', () => ({ uploadFile: uploadFileMock, mkdirSftp: mkdirSftpMock }))

vi.mock('../providers/ssh-filesystem-provider-sftp', async () => {
  const actual = await vi.importActual<typeof SftpProviderModule>(
    '../providers/ssh-filesystem-provider-sftp'
  )
  return { ...actual, fastGetViaSftp: fastGetViaSftpMock }
})

import { registerSftpTransferHandlers } from './sftp-transfer'
import { SftpConnectionAccessFailure } from '../ssh/sftp-connection'
import type * as SftpProviderModule from '../providers/ssh-filesystem-provider-sftp'

type Handler = (event: unknown, args: unknown) => Promise<unknown>

// ssh2 Stats-like object matching fileStatFromSftpStats's isDirectory/isSymbolicLink contract.
function stats(kind: 'file' | 'directory' | 'symlink', size = 0, mtime = 0, mode = 0o644): unknown {
  return {
    size,
    mtime,
    mode,
    isDirectory: () => kind === 'directory',
    isSymbolicLink: () => kind === 'symlink'
  }
}

function createSftp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    end: vi.fn(),
    realpath: vi.fn((p: string, cb: (err: Error | null, resolved: string) => void) =>
      cb(null, p === '.' || p === '~' ? '/home/user' : p)
    ),
    readdir: vi.fn((_p: string, cb: (err: Error | null, entries: unknown[]) => void) =>
      cb(null, [
        { filename: 'zeta.txt', attrs: stats('file', 12, 100, 0o644) },
        { filename: 'alpha', attrs: stats('directory', 0, 200, 0o755) },
        { filename: 'link', attrs: stats('symlink', 0, 300) },
        { filename: 'beta', attrs: stats('directory', 0, 400) }
      ])
    ),
    ...overrides
  }
}

// The handlers now resolve a relay-free raw connection via a getSftpConnection accessor. Mimic the
// pool: target-1 yields a connection whose sftp() returns the fixture; anything else is unknown.
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

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c) => c[0] === channel)
  if (!call) {
    throw new Error(`handler not registered: ${channel}`)
  }
  return call[1] as Handler
}

function createSender(): EventEmitter & {
  id: number
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), {
    id: 7,
    isDestroyed: () => false,
    send: vi.fn()
  })
}

describe('registerSftpTransferHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromWebContentsMock.mockReturnValue(null)
    uploadFileMock.mockResolvedValue(undefined)
    fastGetViaSftpMock.mockResolvedValue(undefined)
    mkdirSftpMock.mockResolvedValue(undefined)
    renameMock.mockResolvedValue(undefined)
    unlinkMock.mockResolvedValue(undefined)
    statMock.mockResolvedValue({ size: 10 })
  })

  describe('sftp:readdir', () => {
    it('maps entries (dir/file/symlink), sorts dirs-first then name, resolves path', async () => {
      const sftp = createSftp()
      registerSftpTransferHandlers(createGetSftpConnection(sftp) as never)
      const result = (await getHandler('sftp:readdir')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          path: '~'
        }
      )) as { entries: unknown[]; resolvedPath: string }

      expect(result.resolvedPath).toBe('/home/user')
      // fileStatFromSftpStats reports mtime in ms (seconds * 1000).
      expect(result.entries).toEqual([
        { name: 'alpha', type: 'directory', size: 0, mtime: 200000, mode: 0o755 },
        { name: 'beta', type: 'directory', size: 0, mtime: 400000, mode: 0o644 },
        { name: 'link', type: 'symlink', size: 0, mtime: 300000, mode: 0o644 },
        { name: 'zeta.txt', type: 'file', size: 12, mtime: 100000, mode: 0o644 }
      ])
      expect(sftp.end as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    })

    it('returns a typed error for an unknown targetId', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:readdir')(
        { sender: createSender() },
        {
          targetId: 'nope',
          path: '~'
        }
      )
      expect(result).toEqual({ error: 'SSH connection "nope" not found' })
    })

    it('returns a typed error when path is missing', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:readdir')(
        { sender: createSender() },
        {
          targetId: 'target-1'
        }
      )
      expect(result).toEqual({ error: 'path is required' })
    })

    it('surfaces SFTP-unavailable (system SSH transport) as a clear error', async () => {
      const getSftpConnection = async (): Promise<unknown> => ({
        sftp: vi.fn(async () => {
          throw new Error('SFTP is not available when using system SSH transport')
        })
      })
      registerSftpTransferHandlers(getSftpConnection as never)
      const result = await getHandler('sftp:readdir')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          path: '~'
        }
      )
      expect(result).toEqual({
        error: 'SFTP is not available on this connection (system SSH transport).'
      })
    })
  })

  describe('sftp:realpath', () => {
    it('resolves the remote path', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:realpath')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          path: '.'
        }
      )
      expect(result).toBe('/home/user')
    })
  })

  describe('sftp:mkdir', () => {
    it('creates the folder (never allowing an existing target) and closes the channel', async () => {
      const sftp = createSftp()
      registerSftpTransferHandlers(createGetSftpConnection(sftp) as never)
      const result = await getHandler('sftp:mkdir')(
        { sender: createSender() },
        { targetId: 'target-1', path: '/remote/dir/new' }
      )
      expect(result).toEqual({ ok: true })
      expect(mkdirSftpMock).toHaveBeenCalledWith(sftp, '/remote/dir/new', { allowExisting: false })
      expect(sftp.end as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    })

    it('returns a typed error for an unknown targetId', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:mkdir')(
        { sender: createSender() },
        { targetId: 'nope', path: '/remote/dir/new' }
      )
      expect(result).toEqual({ error: 'SSH connection "nope" not found' })
      expect(mkdirSftpMock).not.toHaveBeenCalled()
    })

    it('returns a typed error when path is missing', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:mkdir')(
        { sender: createSender() },
        { targetId: 'target-1' }
      )
      expect(result).toEqual({ error: 'path is required' })
    })

    it('surfaces a mkdir failure (e.g. already exists) as a typed error', async () => {
      mkdirSftpMock.mockRejectedValue(new Error('Failure'))
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:mkdir')(
        { sender: createSender() },
        { targetId: 'target-1', path: '/remote/dir/dup' }
      )
      expect(result).toEqual({ error: 'Failure' })
    })
  })

  describe('sftp:startUpload', () => {
    it('returns {canceled} when the open dialog is canceled', async () => {
      showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] })
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:startUpload')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          remoteDir: '/remote/dir'
        }
      )
      expect(result).toEqual({ canceled: true })
    })

    it('uploads each picked file with exclusive per overwrite and emits progress', async () => {
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ['/local/a.txt']
      })
      uploadFileMock.mockImplementation(async (...args: unknown[]) => {
        const opts = args[3] as { onProgress?: (b: number, t: number) => void }
        opts.onProgress?.(5, 10)
      })
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = (await getHandler('sftp:startUpload')(
        { sender },
        {
          targetId: 'target-1',
          remoteDir: '/remote/dir',
          overwrite: false
        }
      )) as { transferId: string }

      expect(typeof result.transferId).toBe('string')
      // Flush the detached transfer task.
      await new Promise((r) => setImmediate(r))

      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        '/local/a.txt',
        '/remote/dir/a.txt',
        expect.objectContaining({ exclusive: true })
      )
      const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
      expect(phases).toContain('start')
      expect(phases).toContain('progress')
      expect(phases).toContain('done')
    })

    it('uploads non-exclusive when overwrite is true', async () => {
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ['/local/a.txt']
      })
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      await getHandler('sftp:startUpload')(
        { sender },
        {
          targetId: 'target-1',
          remoteDir: '/remote/dir',
          overwrite: true
        }
      )
      await new Promise((r) => setImmediate(r))
      expect(uploadFileMock).toHaveBeenCalledWith(
        expect.anything(),
        '/local/a.txt',
        '/remote/dir/a.txt',
        expect.objectContaining({ exclusive: false })
      )
    })

    it('cancel aborts the in-flight upload signal', async () => {
      showOpenDialogMock.mockResolvedValue({
        canceled: false,
        filePaths: ['/local/a.txt']
      })
      let capturedSignal: AbortSignal | undefined
      uploadFileMock.mockImplementation(async (...args: unknown[]) => {
        capturedSignal = (args[3] as { signal?: AbortSignal }).signal
        await new Promise((r) => setImmediate(r))
      })
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = (await getHandler('sftp:startUpload')(
        { sender },
        {
          targetId: 'target-1',
          remoteDir: '/remote/dir'
        }
      )) as { transferId: string }
      // Let the detached task pre-stat the batch and reach uploadFile (which captures the signal).
      await new Promise((r) => setImmediate(r))

      const cancelResult = await getHandler('sftp:cancelTransfer')(
        { sender },
        {
          transferId: result.transferId
        }
      )
      expect(cancelResult).toEqual({ ok: true })
      expect(capturedSignal?.aborted).toBe(true)
    })
  })

  describe('sftp:startDownload', () => {
    it('returns {canceled} when the save dialog is canceled', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: true, filePath: undefined })
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:startDownload')(
        { sender: createSender() },
        {
          targetId: 'target-1',
          remotePath: '/remote/file.bin'
        }
      )
      expect(result).toEqual({ canceled: true })
    })

    it('downloads via fastGet, forwards progress, and closes the channel', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/file.bin' })
      fastGetViaSftpMock.mockImplementation(async (...args: unknown[]) => {
        const opts = args[3] as { onProgress?: (t: number, c: number, f: number) => void }
        opts.onProgress?.(50, 50, 100)
      })
      const sftp = createSftp()
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(sftp) as never)
      const result = (await getHandler('sftp:startDownload')(
        { sender },
        {
          targetId: 'target-1',
          remotePath: '/remote/file.bin'
        }
      )) as { transferId: string }

      expect(typeof result.transferId).toBe('string')
      await new Promise((r) => setImmediate(r))

      expect(fastGetViaSftpMock).toHaveBeenCalledWith(
        sftp,
        '/remote/file.bin',
        expect.stringMatching(/^\/local\/file\.bin\.orcinus-part-/),
        expect.objectContaining({ onProgress: expect.any(Function) })
      )
      // Success publishes the temp file onto the chosen destination.
      expect(renameMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/local\/file\.bin\.orcinus-part-/),
        '/local/file.bin'
      )
      const progress = sender.send.mock.calls
        .map((c) => c[1] as { phase: string; bytesTransferred: number; totalBytes: number })
        .find((p) => p.phase === 'progress')
      expect(progress).toEqual({
        transferId: result.transferId,
        phase: 'progress',
        bytesTransferred: 50,
        totalBytes: 100
      })
      expect(sftp.end as ReturnType<typeof vi.fn>).toHaveBeenCalled()
    })

    it('removes only the temp file (never the user destination) and emits error when the download fails', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/file.bin' })
      fastGetViaSftpMock.mockRejectedValue(new Error('ENOENT: no such file'))
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      await getHandler('sftp:startDownload')(
        { sender },
        {
          targetId: 'target-1',
          remotePath: '/remote/missing.bin'
        }
      )
      await new Promise((r) => setImmediate(r))

      // The pre-existing destination the user chose must never be deleted on failure.
      expect(unlinkMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/local\/file\.bin\.orcinus-part-/)
      )
      expect(unlinkMock).not.toHaveBeenCalledWith('/local/file.bin')
      expect(renameMock).not.toHaveBeenCalled()
      const errorPhase = sender.send.mock.calls
        .map((c) => c[1] as { phase: string; error?: string })
        .find((p) => p.phase === 'error')
      expect(errorPhase?.error).toContain('ENOENT')
    })

    it('emits a canceled phase (not error) and removes the temp file when canceled', async () => {
      showSaveDialogMock.mockResolvedValue({ canceled: false, filePath: '/local/file.bin' })
      let rejectFastGet: (error: Error) => void = () => {}
      fastGetViaSftpMock.mockImplementation(
        () => new Promise((_resolve, reject) => (rejectFastGet = reject))
      )
      const sender = createSender()
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = (await getHandler('sftp:startDownload')(
        { sender },
        {
          targetId: 'target-1',
          remotePath: '/remote/file.bin'
        }
      )) as { transferId: string }
      await new Promise((r) => setImmediate(r))

      await getHandler('sftp:cancelTransfer')({ sender }, { transferId: result.transferId })
      rejectFastGet(Object.assign(new Error('Download canceled'), { name: 'AbortError' }))
      await new Promise((r) => setImmediate(r))

      const phases = sender.send.mock.calls.map((c) => (c[1] as { phase: string }).phase)
      expect(phases).toContain('canceled')
      expect(phases).not.toContain('error')
      expect(renameMock).not.toHaveBeenCalled()
      expect(unlinkMock).toHaveBeenCalledWith(
        expect.stringMatching(/^\/local\/file\.bin\.orcinus-part-/)
      )
    })
  })

  describe('sftp:cancelTransfer', () => {
    it('returns a typed error for an unknown transferId', async () => {
      registerSftpTransferHandlers(createGetSftpConnection(createSftp()) as never)
      const result = await getHandler('sftp:cancelTransfer')(
        { sender: createSender() },
        {
          transferId: 'ghost'
        }
      )
      expect(result).toEqual({ error: 'Transfer not found' })
    })
  })
})
