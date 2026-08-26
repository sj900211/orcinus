import { describe, expect, it, vi } from 'vitest'
import { publishTempUpload, unlinkQuietSftp } from './sftp-rename'

type Cb = (err: Error | null) => void
function makeSftp(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    rename: vi.fn((_s: string, _d: string, cb: Cb) => cb(null)),
    ext_openssh_rename: vi.fn((_s: string, _d: string, cb: Cb) => cb(null)),
    unlink: vi.fn((_p: string, cb: Cb) => cb(null)),
    ...overrides
  }
}

describe('publishTempUpload', () => {
  it('exclusive: uses a standard rename and never ext-renames or unlinks', async () => {
    const sftp = makeSftp()
    await publishTempUpload(sftp as never, '/t', '/final', true)
    expect(sftp.rename).toHaveBeenCalledWith('/t', '/final', expect.any(Function))
    expect(sftp.ext_openssh_rename).not.toHaveBeenCalled()
    expect(sftp.unlink).not.toHaveBeenCalled()
  })

  it('exclusive: propagates a rename failure (existing target must not be clobbered)', async () => {
    const sftp = makeSftp({
      rename: vi.fn((_s: string, _d: string, cb: Cb) => cb(new Error('exists')))
    })
    await expect(publishTempUpload(sftp as never, '/t', '/final', true)).rejects.toThrow('exists')
  })

  it('overwrite: uses atomic posix-rename when supported (no unlink, no plain rename)', async () => {
    const sftp = makeSftp()
    await publishTempUpload(sftp as never, '/t', '/final', false)
    expect(sftp.ext_openssh_rename).toHaveBeenCalledWith('/t', '/final', expect.any(Function))
    expect(sftp.unlink).not.toHaveBeenCalled()
    expect(sftp.rename).not.toHaveBeenCalled()
  })

  it('overwrite: falls back to unlink + rename when posix-rename is unsupported', async () => {
    const sftp = makeSftp({
      ext_openssh_rename: vi.fn((_s: string, _d: string, cb: Cb) => cb(new Error('unsupported')))
    })
    await publishTempUpload(sftp as never, '/t', '/final', false)
    expect(sftp.unlink).toHaveBeenCalledWith('/final', expect.any(Function))
    expect(sftp.rename).toHaveBeenCalledWith('/t', '/final', expect.any(Function))
  })
})

describe('unlinkQuietSftp', () => {
  it('resolves even when unlink errors (best-effort cleanup)', async () => {
    const sftp = makeSftp({ unlink: vi.fn((_p: string, cb: Cb) => cb(new Error('nope'))) })
    await expect(unlinkQuietSftp(sftp as never, '/x')).resolves.toBeUndefined()
  })
})
