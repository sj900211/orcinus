import { describe, expect, it } from 'vitest'
import type { Stats } from 'ssh2'
import { classifyRemoteEntry } from './sftp-download-batch'

const S_IFREG = 0o100000
const S_IFDIR = 0o040000
const S_IFLNK = 0o120000

function attrs(mode: number | undefined): Stats {
  return { mode } as Stats
}

describe('classifyRemoteEntry', () => {
  it('classifies an affirmative regular file / directory by mode bits', () => {
    expect(classifyRemoteEntry(attrs(S_IFREG | 0o644))).toBe('file')
    expect(classifyRemoteEntry(attrs(S_IFDIR | 0o755))).toBe('directory')
  })

  it('skips a symlink so fastGet never follows it', () => {
    expect(classifyRemoteEntry(attrs(S_IFLNK | 0o777))).toBe('skip')
  })

  it('skips an entry whose mode is absent (a hostile server omitting SFTP permissions)', () => {
    // Without this, a mode-less symlink would read as a file and be downloaded through the link.
    expect(classifyRemoteEntry(attrs(undefined))).toBe('skip')
    expect(classifyRemoteEntry(undefined)).toBe('skip')
  })
})
