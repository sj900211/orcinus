import { describe, expect, it } from 'vitest'
import {
  encodeSftpFileDrag,
  hasSftpFileDrag,
  readSftpFileDrag,
  SFTP_FILE_DRAG_MIME
} from './sftp-file-drag'

function transferWith(entries: Record<string, string>): Pick<DataTransfer, 'getData' | 'types'> {
  return {
    getData: (mime: string) => entries[mime] ?? '',
    types: Object.keys(entries)
  }
}

describe('sftp-file-drag', () => {
  it('round-trips a payload through encode/read', () => {
    const encoded = encodeSftpFileDrag({ hostId: 'host-1', paths: ['/a/b.txt', '/a/c'] })
    const decoded = readSftpFileDrag(transferWith({ [SFTP_FILE_DRAG_MIME]: encoded }))
    expect(decoded).toEqual({ hostId: 'host-1', paths: ['/a/b.txt', '/a/c'] })
  })

  it('returns null when the SFTP mime is absent (a local-origin drag)', () => {
    expect(readSftpFileDrag(transferWith({ 'text/x-orca-file-path': '/local/x' }))).toBeNull()
  })

  it('returns null for a malformed or empty payload', () => {
    expect(readSftpFileDrag(transferWith({ [SFTP_FILE_DRAG_MIME]: 'not json' }))).toBeNull()
    expect(
      readSftpFileDrag(transferWith({ [SFTP_FILE_DRAG_MIME]: JSON.stringify({ hostId: 'h' }) }))
    ).toBeNull()
    expect(
      readSftpFileDrag(
        transferWith({ [SFTP_FILE_DRAG_MIME]: JSON.stringify({ hostId: '', paths: ['/a'] }) })
      )
    ).toBeNull()
    expect(
      readSftpFileDrag(
        transferWith({ [SFTP_FILE_DRAG_MIME]: JSON.stringify({ hostId: 'h', paths: [] }) })
      )
    ).toBeNull()
  })

  it('drops non-string path entries defensively', () => {
    const decoded = readSftpFileDrag(
      transferWith({ [SFTP_FILE_DRAG_MIME]: JSON.stringify({ hostId: 'h', paths: ['/a', 3, ''] }) })
    )
    expect(decoded).toEqual({ hostId: 'h', paths: ['/a'] })
  })

  it('hasSftpFileDrag detects the mime via types (available during dragover)', () => {
    expect(hasSftpFileDrag(transferWith({ [SFTP_FILE_DRAG_MIME]: 'x' }))).toBe(true)
    expect(hasSftpFileDrag(transferWith({ 'text/x-orca-file-path': '/x' }))).toBe(false)
  })
})
