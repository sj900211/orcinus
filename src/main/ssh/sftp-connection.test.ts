import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SftpHost } from '../../shared/sftp-host-types'

const { SshConnectionMock, connectMock } = vi.hoisted(() => {
  const connectMock = vi.fn(async () => {})
  class SshConnectionMock {
    static instances: SshConnectionMock[] = []
    state: { status: string } = { status: 'connecting' }
    disconnect = vi.fn(async () => {})
    connect = connectMock
    constructor(
      readonly target: Record<string, unknown>,
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

type Callbacks = {
  onStateChange: (id: string, state: unknown) => void
  onCredentialRequest?: (id: string, kind: string, detail: string) => Promise<string | null>
}

function keyHost(id = 't1'): SftpHost {
  return { id, label: id, host: '10.0.0.1', port: 22, username: 'u', authType: 'key' }
}
function passwordHost(id = 't1'): SftpHost {
  return { id, label: id, host: '10.0.0.1', port: 22, username: 'u', authType: 'password' }
}

function makePool(overrides: { host?: SftpHost; password?: string | null }): SftpConnectionPool {
  return new SftpConnectionPool({
    getHost: () => overrides.host,
    readPassword: () => overrides.password ?? null,
    getBaseCallbacks: () => ({ onStateChange: () => {} })
  })
}

describe('SftpConnectionPool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    SshConnectionMock.instances.length = 0
    connectMock.mockResolvedValue(undefined)
  })

  it('opens a dedicated relay-free connection for a known host', async () => {
    const pool = makePool({ host: keyHost() })
    const conn = await pool.getConnection('t1')
    expect(SshConnectionMock.instances).toHaveLength(1)
    expect((conn as unknown as { connect: unknown }).connect).toBe(connectMock)
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('maps the SFTP host onto the ssh target (host/port/username/identityFile)', async () => {
    const pool = makePool({ host: { ...keyHost(), identityFile: '/k' } })
    await pool.getConnection('t1')
    expect(SshConnectionMock.instances[0]!.target).toMatchObject({
      id: 't1',
      host: '10.0.0.1',
      port: 22,
      username: 'u',
      identityFile: '/k'
    })
  })

  it('caches the dedicated connection across calls (connects once)', async () => {
    const pool = makePool({ host: keyHost() })
    await pool.getConnection('t1')
    SshConnectionMock.instances[0]!.state.status = 'connected'
    await pool.getConnection('t1')
    expect(SshConnectionMock.instances).toHaveLength(1)
    expect(connectMock).toHaveBeenCalledTimes(1)
  })

  it('throws a typed unknown-target failure when the host is not in the registry', async () => {
    const pool = makePool({ host: undefined })
    await expect(pool.getConnection('ghost')).rejects.toMatchObject({
      detail: { kind: 'unknown-target' }
    })
  })

  it('maps a failed connect to a typed connect-failed error and drops the entry', async () => {
    connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    const pool = makePool({ host: keyHost() })
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
    const pool = makePool({ host: keyHost() })
    await expect(pool.getConnection('t1')).rejects.toMatchObject({
      detail: { kind: 'auth-failed' }
    })
  })

  it('feeds a password host its sealed password to the credential flow (no prompt)', async () => {
    const promptSpy = vi.fn(async () => 'PROMPTED')
    const pool = new SftpConnectionPool({
      getHost: () => passwordHost(),
      readPassword: () => 'SEALED',
      getBaseCallbacks: () => ({ onStateChange: () => {}, onCredentialRequest: promptSpy })
    })
    await pool.getConnection('t1')
    const callbacks = SshConnectionMock.instances[0]!.callbacks as Callbacks
    await expect(callbacks.onCredentialRequest!('t1', 'password', '')).resolves.toBe('SEALED')
    // A passphrase (encrypted key), not a password, still routes to the base prompt.
    await callbacks.onCredentialRequest!('t1', 'passphrase', 'k')
    expect(promptSpy).toHaveBeenCalledWith('t1', 'passphrase', 'k')
  })

  it('a key host uses the base callbacks unchanged (no password injection)', async () => {
    const base: Callbacks = {
      onStateChange: () => {},
      onCredentialRequest: vi.fn(async () => null)
    }
    const pool = new SftpConnectionPool({
      getHost: () => keyHost(),
      readPassword: () => 'SEALED',
      getBaseCallbacks: () => base
    })
    await pool.getConnection('t1')
    expect(SshConnectionMock.instances[0]!.callbacks).toBe(base)
  })

  it('disconnectAll closes every dedicated connection', async () => {
    const pool = makePool({ host: keyHost() })
    await pool.getConnection('t1')
    await pool.disconnectAll()
    expect(SshConnectionMock.instances[0]!.disconnect).toHaveBeenCalled()
  })

  it('retain holds the connection past the idle window; release lets it be reaped', async () => {
    vi.useFakeTimers()
    try {
      const pool = makePool({ host: keyHost() })
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
})
