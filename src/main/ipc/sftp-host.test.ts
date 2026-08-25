import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handleMock, removeHandlerMock, storeMocks } = vi.hoisted(() => ({
  handleMock: vi.fn(),
  removeHandlerMock: vi.fn(),
  storeMocks: {
    addSftpHost: vi.fn(),
    getSftpHost: vi.fn(),
    listSftpHostViews: vi.fn(),
    removeSftpHost: vi.fn(),
    updateSftpHost: vi.fn()
  }
}))

vi.mock('electron', () => ({
  ipcMain: { handle: handleMock, removeHandler: removeHandlerMock }
}))
vi.mock('../ssh/sftp-host-store', () => storeMocks)

import { registerSftpHostHandlers, type SftpHostPoolAccess } from './sftp-host'

type Handler = (event: unknown, args: unknown) => Promise<unknown> | unknown

function getHandler(channel: string): Handler {
  const call = handleMock.mock.calls.find((c) => c[0] === channel)
  if (!call) {
    throw new Error(`handler not registered: ${channel}`)
  }
  return call[1] as Handler
}

describe('registerSftpHostHandlers', () => {
  const pool: SftpHostPoolAccess = {
    getConnection: vi.fn(),
    disconnect: vi.fn()
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('list returns the views from the store', async () => {
    storeMocks.listSftpHostViews.mockReturnValue([{ id: 'a', hasPassword: true }])
    registerSftpHostHandlers(pool)
    expect(await getHandler('sftp:host:list')({}, undefined)).toEqual([
      { id: 'a', hasPassword: true }
    ])
  })

  it('add validates required fields', async () => {
    registerSftpHostHandlers(pool)
    const result = await getHandler('sftp:host:add')(
      {},
      { host: 'x', username: 'u', authType: 'key' }
    )
    expect(result).toEqual({ error: 'Label is required' })
    expect(storeMocks.addSftpHost).not.toHaveBeenCalled()
  })

  it('add requires a password for password auth', async () => {
    registerSftpHostHandlers(pool)
    const result = await getHandler('sftp:host:add')(
      {},
      { label: 'l', host: 'x', username: 'u', authType: 'password' }
    )
    expect(result).toEqual({ error: 'Password is required for password authentication' })
  })

  it('add trims and normalizes the input before storing', async () => {
    storeMocks.addSftpHost.mockImplementation((input: Record<string, unknown>) => ({
      id: 'new',
      ...input,
      password: undefined
    }))
    registerSftpHostHandlers(pool)
    const result = await getHandler('sftp:host:add')(
      {},
      {
        label: ' l ',
        host: ' x ',
        port: 2222,
        username: ' u ',
        authType: 'password',
        password: 'p'
      }
    )
    expect(storeMocks.addSftpHost).toHaveBeenCalledWith(
      expect.objectContaining({
        label: 'l',
        host: 'x',
        port: 2222,
        username: 'u',
        authType: 'password',
        password: 'p'
      })
    )
    expect(result).toMatchObject({ id: 'new' })
  })

  it('update drops the live connection and returns the updated host', async () => {
    storeMocks.updateSftpHost.mockReturnValue({ id: 'a', label: 'l' })
    registerSftpHostHandlers(pool)
    const result = await getHandler('sftp:host:update')(
      {},
      { id: 'a', input: { label: 'l', host: 'x', username: 'u', authType: 'key' } }
    )
    expect(result).toMatchObject({ id: 'a' })
    expect(pool.disconnect).toHaveBeenCalledWith('a')
  })

  it('update returns a typed error when the host is missing', async () => {
    storeMocks.updateSftpHost.mockReturnValue(null)
    registerSftpHostHandlers(pool)
    const result = await getHandler('sftp:host:update')(
      {},
      { id: 'ghost', input: { label: 'l', host: 'x', username: 'u', authType: 'key' } }
    )
    expect(result).toEqual({ error: 'SFTP host "ghost" not found' })
  })

  it('remove disconnects then deletes', async () => {
    registerSftpHostHandlers(pool)
    expect(await getHandler('sftp:host:remove')({}, { id: 'a' })).toEqual({ ok: true })
    expect(pool.disconnect).toHaveBeenCalledWith('a')
    expect(storeMocks.removeSftpHost).toHaveBeenCalledWith('a')
  })

  it('test returns ok when a connection + realpath succeed', async () => {
    storeMocks.getSftpHost.mockReturnValue({ id: 'a' })
    const sftp = {
      realpath: (_path: string, cb: (err: Error | null, resolved: string) => void) =>
        cb(null, '/home'),
      end: vi.fn()
    }
    ;(pool.getConnection as ReturnType<typeof vi.fn>).mockResolvedValue({
      sftp: vi.fn(async () => sftp)
    })
    registerSftpHostHandlers(pool)
    expect(await getHandler('sftp:host:test')({}, { id: 'a' })).toEqual({ ok: true })
    expect(sftp.end).toHaveBeenCalled()
  })

  it('test surfaces a connection error', async () => {
    storeMocks.getSftpHost.mockReturnValue({ id: 'a' })
    ;(pool.getConnection as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('ECONNREFUSED'))
    registerSftpHostHandlers(pool)
    expect(await getHandler('sftp:host:test')({}, { id: 'a' })).toEqual({ error: 'ECONNREFUSED' })
  })

  it('test rejects an unknown host without connecting', async () => {
    storeMocks.getSftpHost.mockReturnValue(undefined)
    registerSftpHostHandlers(pool)
    expect(await getHandler('sftp:host:test')({}, { id: 'ghost' })).toEqual({
      error: 'SFTP host not found'
    })
    expect(pool.getConnection).not.toHaveBeenCalled()
  })
})
