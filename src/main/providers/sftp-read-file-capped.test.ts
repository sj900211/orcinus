import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { readFileCappedViaSftp } from './ssh-filesystem-provider-sftp'

// A one-shot fake read stream that emits the buffer then closes (destroy is a no-op — the cap logic
// clips the chunk itself, so we don't need the stream to actually stop).
function sftpWithStream(buffer: Buffer): { createReadStream: ReturnType<typeof vi.fn> } {
  return {
    createReadStream: vi.fn(() => {
      const stream = Object.assign(new EventEmitter(), { destroy: vi.fn() })
      setImmediate(() => {
        stream.emit('data', buffer)
        stream.emit('close')
      })
      return stream
    })
  }
}

describe('readFileCappedViaSftp', () => {
  it('reads a small file whole (not truncated)', async () => {
    const sftp = sftpWithStream(Buffer.from('hello'))
    const result = await readFileCappedViaSftp(sftp as never, '/a/x', 100)
    expect(result.buffer.toString('utf-8')).toBe('hello')
    expect(result.truncated).toBe(false)
  })

  it('clips at the cap and flags truncated when the file exceeds it', async () => {
    const stream = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> }
    // Real streams emit 'close' when destroyed; the helper resolves on 'close'.
    stream.destroy = vi.fn(() => {
      stream.emit('close')
    })
    const sftp = { createReadStream: vi.fn(() => stream) }
    const pending = readFileCappedViaSftp(sftp as never, '/a/big', 5)
    await new Promise((r) => setImmediate(r))
    stream.emit('data', Buffer.from('hello world')) // 11 bytes, cap 5
    const result = await pending
    expect(result.buffer.toString('utf-8')).toBe('hello')
    expect(result.truncated).toBe(true)
    // Requests only cap+1 bytes off the wire and stops pulling once over the cap.
    expect((sftp.createReadStream as ReturnType<typeof vi.fn>).mock.calls[0][1]).toEqual({
      start: 0,
      end: 5
    })
    expect((stream.destroy as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThan(0)
  })

  it('never overshoots the cap across multiple buffered post-cap chunks', async () => {
    const stream = new EventEmitter() as EventEmitter & { destroy: ReturnType<typeof vi.fn> }
    stream.destroy = vi.fn(() => {
      stream.emit('close')
    })
    const sftp = { createReadStream: vi.fn(() => stream) }
    const pending = readFileCappedViaSftp(sftp as never, '/a/big', 10)
    await new Promise((r) => setImmediate(r))
    // Four 4-byte chunks after the cap of 10; a naive negative-clip would append past the cap.
    for (const part of ['AAAA', 'BBBB', 'CCCC', 'DDDD']) {
      stream.emit('data', Buffer.from(part))
    }
    const result = await pending
    expect(result.buffer.toString('utf-8')).toBe('AAAABBBBCC')
    expect(result.buffer.length).toBe(10)
    expect(result.truncated).toBe(true)
  })

  it('rejects on a stream error', async () => {
    const stream = Object.assign(new EventEmitter(), { destroy: vi.fn() })
    const sftp = { createReadStream: vi.fn(() => stream) }
    const pending = readFileCappedViaSftp(sftp as never, '/a/x', 100)
    await new Promise((r) => setImmediate(r))
    stream.emit('error', new Error('boom'))
    await expect(pending).rejects.toThrow('boom')
  })
})
