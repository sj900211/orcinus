import { beforeEach, describe, expect, it, vi } from 'vitest'

const { SshConnectionMock, connectMock } = vi.hoisted(() => {
  const connectMock = vi.fn(async () => {})
  class SshConnectionMock {
    static instances: SshConnectionMock[] = []
    state: { status: string } = { status: 'connecting' }
    disconnect = vi.fn(async () => {})
    connect = connectMock
    constructor(
      readonly target: { id: string },
      readonly callbacks: unknown
    ) {
      SshConnectionMock.instances.push(this)
    }
    getState(): { status: string } {
      return this.state
    }
  }
  return { SshConnectionMock, connectMock }
})

vi.mock('./ssh-connection', () => ({ SshConnection: SshConnectionMock }))

import { SftpConnectionPool, SftpConnectionAccessFailure } from './sftp-connection'

type ManagerConn = { getState: () => { status: string }; usesSystemSshTransport: () => boolean }

function makePool(overrides: {
  live?: ManagerConn | undefined
  target?: { id: string } | undefined
}): SftpConnectionPool {
  return new SftpConnectionPool({
    getConnectionManager: () => ({ getConnection: () => overrides.live }) as never,
    getStore: () => ({ getTarget: () => overrides.target }) as never,
    getCallbacks: () => ({ onStateChange: () => {} })
  })
}

describe('SftpConnectionPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    SshConnectionMock.instances.length = 0
    connectMock.mockResolvedValue(undefined)
  })

  it('reuses a live relay connection instead of opening a dedicated one', async () => {
    const live = { getState: () => ({ status: 'connected' }), usesSystemSshTransport: () => false }
    const pool = makePool({ live, target: { id: 't1' } })
    const conn = await pool.getConnection('t1')
    expect(conn).toBe(live)
    expect(SshConnectionMock.instances).toHaveLength(0)
  })

  it('skips reuse of a live system-SSH connection and opens a dedicated one instead', async () => {
    // A system-SSH transport's sftp() always throws, so reusing it would guarantee SFTP failure.
    const live = { getState: () => ({ status: 'connected' }), usesSystemSshTransport: () => true }
    const pool = makePool({ live, target: { id: 't1' } })
    const conn = await pool.getConnection('t1')
    expect(conn).not.toBe(live)
    expect(SshConnectionMock.instances).toHaveLength(1)
  })

  it('retain holds the connection past the idle window; release lets it be reaped', async () => {
    vi.useFakeTimers()
    try {
      const pool = makePool({ live: undefined, target: { id: 't1' } })
      await pool.getConnection('t1')
      const conn = SshConnectionMock.instances[0]!
      conn.state.status = 'connected'
      pool.retain('t1')
      vi.advanceTimersByTime(11 * 60 * 1000)
      expect(conn.disconnect).not.toHaveBeenCalled()
      pool.release('t1')
      vi.advanceTimersByTime(11 * 60 * 1000)
      expect(conn.disconnect).toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens a dedicated relay-free connection when no live relay exists', async () => {
    const pool = makePool({ live: undefined, target: { id: 't1' } })
    const conn = await pool.getConnection('t1')
    expect(SshConnectionMock.instances).toHaveLength(1)
    expect((conn as unknown as { connect: unknown }).connect).toBe(connectMock)
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('caches the dedicated connection across calls (connects once)', async () => {
    const pool = makePool({ live: undefined, target: { id: 't1' } })
    SshConnectionMock.instances.forEach((c) => (c.state.status = 'connected'))
    await pool.getConnection('t1')
    SshConnectionMock.instances[0]!.state.status = 'connected'
    await pool.getConnection('t1')
    expect(SshConnectionMock.instances).toHaveLength(1)
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('throws a typed unknown-target failure when the target is not in the store', async () => {
    const pool = makePool({ live: undefined, target: undefined })
    await expect(pool.getConnection('ghost')).rejects.toMatchObject({
      detail: { kind: 'unknown-target' }
    })
  })

  it('maps a failed connect to a typed connect-failed error and drops the entry', async () => {
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const pool = makePool({ live: undefined, target: { id: 't1' } })
    await expect(pool.getConnection('t1')).rejects.toBeInstanceOf(SftpConnectionAccessFailure)
    // A second attempt builds a fresh connection rather than reusing the dead promise.
    connectMock.mockResolvedValueOnce(undefined)
    await pool.getConnection('t1')
    expect(SshConnectionMock.instances).toHaveLength(2)
  })

  it('maps an auth-failed transport state to a typed auth-failed error', async () => {
    connectMock.mockImplementationOnce(async function (this: { state: { status: string } }) {
      this.state.status = 'auth-failed'
      throw new Error('All configured authentication methods failed')
    })
    const pool = makePool({ live: undefined, target: { id: 't1' } })
    await expect(pool.getConnection('t1')).rejects.toMatchObject({
      detail: { kind: 'auth-failed' }
    })
  })

  it('disconnectAll closes every dedicated connection', async () => {
    const pool = makePool({ live: undefined, target: { id: 't1' } })
    await pool.getConnection('t1')
    await pool.disconnectAll()
    expect(SshConnectionMock.instances[0]!.disconnect).toHaveBeenCalled()
  })
})
