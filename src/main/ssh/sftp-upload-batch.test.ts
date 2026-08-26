import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mkdirSftpMock, uploadDirectoryMock, realpathMock } = vi.hoisted(() => ({
  mkdirSftpMock: vi.fn(async (..._args: unknown[]) => {}),
  uploadDirectoryMock: vi.fn(async (..._args: unknown[]) => {}),
  realpathMock: vi.fn(async (p: string) => p)
}))

vi.mock('./sftp-upload', () => ({
  mkdirSftp: mkdirSftpMock,
  uploadDirectory: uploadDirectoryMock
}))

vi.mock('node:fs/promises', () => ({ realpath: realpathMock }))

import { uploadDirectoriesInto } from './sftp-upload-batch'

describe('uploadDirectoriesInto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    realpathMock.mockImplementation(async (p: string) => p)
  })

  it('creates the remote folder and recurses each picked directory', async () => {
    const sftp = {} as never
    await uploadDirectoriesInto(sftp, ['/local/a', '/local/b'], '/remote/dir', { exclusive: true })
    expect(mkdirSftpMock).toHaveBeenCalledWith(sftp, '/remote/dir/a', { allowExisting: false })
    expect(mkdirSftpMock).toHaveBeenCalledWith(sftp, '/remote/dir/b', { allowExisting: false })
    expect(uploadDirectoryMock).toHaveBeenCalledWith(
      sftp,
      '/local/a',
      '/remote/dir/a',
      '/local/a',
      {
        exclusive: true
      }
    )
    expect(uploadDirectoryMock).toHaveBeenCalledWith(
      sftp,
      '/local/b',
      '/remote/dir/b',
      '/local/b',
      {
        exclusive: true
      }
    )
  })

  it('allows existing remote folders when not exclusive', async () => {
    await uploadDirectoriesInto({} as never, ['/local/a'], '/remote/dir', { exclusive: false })
    expect(mkdirSftpMock).toHaveBeenCalledWith(expect.anything(), '/remote/dir/a', {
      allowExisting: true
    })
  })

  it('normalizes a trailing slash on the remote dir', async () => {
    await uploadDirectoriesInto({} as never, ['/local/a'], '/remote/dir/', {})
    expect(mkdirSftpMock).toHaveBeenCalledWith(
      expect.anything(),
      '/remote/dir/a',
      expect.anything()
    )
  })

  it('resolves the picked path to its real path for the upload root', async () => {
    realpathMock.mockResolvedValue('/real/a')
    await uploadDirectoriesInto({} as never, ['/link/a'], '/remote/dir', {})
    // Remote name keeps the picked basename; traversal root uses the resolved real path.
    expect(mkdirSftpMock).toHaveBeenCalledWith(
      expect.anything(),
      '/remote/dir/a',
      expect.anything()
    )
    expect(uploadDirectoryMock).toHaveBeenCalledWith(
      expect.anything(),
      '/real/a',
      '/remote/dir/a',
      '/real/a',
      {}
    )
  })

  it('aborts before starting when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadDirectoriesInto({} as never, ['/local/a'], '/remote/dir', { signal: controller.signal })
    ).rejects.toThrow()
    expect(mkdirSftpMock).not.toHaveBeenCalled()
    expect(uploadDirectoryMock).not.toHaveBeenCalled()
  })
})
