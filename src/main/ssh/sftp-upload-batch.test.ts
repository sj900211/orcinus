import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mkdirSftpMock, uploadDirectoryMock, uploadFileMock, realpathMock, statMock } = vi.hoisted(
  () => ({
    mkdirSftpMock: vi.fn(async (..._args: unknown[]) => {}),
    uploadDirectoryMock: vi.fn(async (..._args: unknown[]) => {}),
    uploadFileMock: vi.fn(async (..._args: unknown[]) => {}),
    realpathMock: vi.fn(async (p: string) => p),
    statMock: vi.fn(async (..._args: unknown[]) => ({ size: 10 }))
  })
)

vi.mock('./sftp-upload', () => ({
  mkdirSftp: mkdirSftpMock,
  uploadDirectory: uploadDirectoryMock,
  uploadFile: uploadFileMock
}))

vi.mock('node:fs/promises', () => ({ realpath: realpathMock, stat: statMock }))

import { uploadDirectoriesInto, uploadFilesInto } from './sftp-upload-batch'

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

describe('uploadFilesInto', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    statMock.mockResolvedValue({ size: 10 })
  })

  it('uploads each file under its remote name with exclusive = !overwrite', async () => {
    const sftp = {} as never
    await uploadFilesInto(
      sftp,
      [
        { localPath: '/l/a.txt', remoteName: 'a.txt', overwrite: false },
        { localPath: '/l/b.txt', remoteName: 'renamed.txt', overwrite: true }
      ],
      '/remote/dir'
    )
    expect(uploadFileMock).toHaveBeenCalledWith(
      sftp,
      '/l/a.txt',
      '/remote/dir/a.txt',
      expect.objectContaining({ exclusive: true })
    )
    expect(uploadFileMock).toHaveBeenCalledWith(
      sftp,
      '/l/b.txt',
      '/remote/dir/renamed.txt',
      expect.objectContaining({ exclusive: false })
    )
  })

  it('reports cumulative progress against the pre-measured batch total', async () => {
    statMock.mockResolvedValue({ size: 10 })
    uploadFileMock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[3] as { onProgress?: (b: number) => void }
      opts.onProgress?.(10)
    })
    const seen: Array<{ bytes: number; total: number }> = []
    await uploadFilesInto(
      {} as never,
      [
        { localPath: '/l/a.txt', remoteName: 'a.txt', overwrite: false },
        { localPath: '/l/b.txt', remoteName: 'b.txt', overwrite: false }
      ],
      '/remote/dir',
      { onProgress: (bytes, total) => seen.push({ bytes, total }) }
    )
    // Two files of 10 bytes → total 20; second file's completion reports 20/20.
    expect(seen).toContainEqual({ bytes: 20, total: 20 })
  })

  it('aborts before uploading when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      uploadFilesInto(
        {} as never,
        [{ localPath: '/l/a.txt', remoteName: 'a.txt', overwrite: false }],
        '/remote/dir',
        { signal: controller.signal }
      )
    ).rejects.toThrow()
    expect(uploadFileMock).not.toHaveBeenCalled()
  })
})
