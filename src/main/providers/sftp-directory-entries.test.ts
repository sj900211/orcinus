// Why (fork): upstream deleted ssh-directory-streaming.test.ts with its SSH provider (#27770); the fork
// still ships readDirectoryEntriesViaSftp, so its handle-cleanup cases are kept here.
import { describe, expect, it, vi } from 'vitest'
import type { SFTPWrapper } from 'ssh2'
import { readDirectoryEntriesViaSftp } from './ssh-filesystem-provider-sftp'

function fixture(packets: string[][]) {
  let next = 0
  const handle = Buffer.from('directory')
  const sftp = {
    opendir: vi.fn((_path, callback) => callback(null, handle)),
    readdir: vi.fn((_handle, callback) =>
      next < packets.length
        ? callback(
            null,
            packets[next++].map((filename) => ({
              filename,
              attrs: { isSymbolicLink: () => false, isDirectory: () => false }
            }))
          )
        : callback(Object.assign(new Error('EOF'), { code: 1 }))
    ),
    close: vi.fn((_handle, callback) => callback(null))
  }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: The fixture implements all three handle operations used by the reader.
  return { mock: sftp, sftp: sftp as unknown as SFTPWrapper }
}

describe('SFTP directory handle ownership', () => {
  it('does not request later packets after a consumer stops', async () => {
    const { sftp, mock } = fixture([['first'], ['second']])
    for await (const entry of readDirectoryEntriesViaSftp(sftp, '/folder')) {
      expect(entry.filename).toBe('first')
      break
    }
    expect(mock.readdir).toHaveBeenCalledTimes(1)
    expect(mock.close).toHaveBeenCalledTimes(1)
  })

  it('closes after cancellation between packets', async () => {
    const { sftp, mock } = fixture([['first'], ['second']])
    const controller = new AbortController()
    await expect(
      (async () => {
        for await (const _entry of readDirectoryEntriesViaSftp(sftp, '/folder', {
          signal: controller.signal
        })) {
          controller.abort(new Error('closed'))
        }
      })()
    ).rejects.toThrow('closed')
    expect(mock.close).toHaveBeenCalledTimes(1)
  })
})

it('bounds a silent CLOSE after early stop and ignores its late callback', async () => {
  vi.useFakeTimers()
  try {
    const { sftp, mock } = fixture([['first']])
    let lateClose: (() => void) | undefined
    mock.close.mockImplementation((_handle, callback) => {
      lateClose = () => callback(null)
    })
    const iterator = readDirectoryEntriesViaSftp(sftp, '/folder')
    await iterator.next()
    const stopped = iterator.return(undefined)
    await vi.advanceTimersByTimeAsync(5000)
    await stopped
    expect(mock.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
    lateClose?.()
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('preserves cancellation when CLOSE never acknowledges', async () => {
  vi.useFakeTimers()
  try {
    const { sftp, mock } = fixture([['first'], ['second']])
    mock.close.mockImplementation(() => {})
    const controller = new AbortController()
    const iterator = readDirectoryEntriesViaSftp(sftp, '/folder', { signal: controller.signal })
    await iterator.next()
    controller.abort(new Error('original cancellation'))
    const rejected = expect(iterator.next()).rejects.toThrow('original cancellation')
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    expect(mock.close).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})

it('closes a late OPENDIR handle even after cancellation settled', async () => {
  vi.useFakeTimers()
  try {
    const { sftp, mock } = fixture([])
    let lateOpen: (() => void) | undefined
    mock.opendir.mockImplementation((_path, callback) => {
      lateOpen = () => callback(null, Buffer.from('late-handle'))
    })
    mock.close.mockImplementation(() => {})
    const controller = new AbortController()
    const pending = readDirectoryEntriesViaSftp(sftp, '/folder', {
      signal: controller.signal
    }).next()
    const rejected = expect(pending).rejects.toThrow('original cancellation')
    controller.abort(new Error('original cancellation'))
    await vi.advanceTimersByTimeAsync(5000)
    await rejected
    lateOpen?.()
    expect(mock.close).toHaveBeenCalledWith(Buffer.from('late-handle'), expect.any(Function))
    await vi.advanceTimersByTimeAsync(5000)
    expect(vi.getTimerCount()).toBe(0)
  } finally {
    vi.useRealTimers()
  }
})
