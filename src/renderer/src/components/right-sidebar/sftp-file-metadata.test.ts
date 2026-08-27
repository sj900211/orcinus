import { describe, expect, it } from 'vitest'
import { formatPosixMode } from './sftp-file-metadata'

describe('formatPosixMode', () => {
  it('formats common modes as rwx triads', () => {
    expect(formatPosixMode(0o755)).toBe('rwxr-xr-x')
    expect(formatPosixMode(0o644)).toBe('rw-r--r--')
    expect(formatPosixMode(0o600)).toBe('rw-------')
    expect(formatPosixMode(0o777)).toBe('rwxrwxrwx')
    expect(formatPosixMode(0o000)).toBe('---------')
  })

  it('ignores high bits (file type / setuid) and reads only the low 9 permission bits', () => {
    // 0o100644 (regular file, rw-r--r--) → the type bits must not leak into the triads.
    expect(formatPosixMode(0o100644)).toBe('rw-r--r--')
    expect(formatPosixMode(0o40755)).toBe('rwxr-xr-x')
  })
})
