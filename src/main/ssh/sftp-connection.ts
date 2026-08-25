import type { SshTarget } from '../../shared/ssh-types'
import type { SftpHost } from '../../shared/sftp-host-types'
import { SshConnection, type SshConnectionCallbacks } from './ssh-connection'

// Relay-free raw ssh2 connection accessor for the SFTP feature (Expedition 3).
//
// Why this exists apart from SshConnectionManager: `ssh:connect` deploys a Node.js relay on top of the
// transport (needs Node 18+). A plain SFTP server has no Node.js, so that path never reaches
// 'connected'. SFTP needs only the raw ssh2 channel from SshConnection.connect()/sftp(). Hosts come
// from the standalone SFTP host registry (separate from worktree SSH targets), so every connection is
// dedicated — and a password host supplies its sealed password straight to the auth flow, no prompt.

/** Idle raw SFTP connections are torn down after this long to avoid holding transports open forever. */
const SFTP_IDLE_TEARDOWN_MS = 10 * 60 * 1000

export type SftpConnectionAccessError =
  | { kind: 'unknown-target'; message: string }
  | { kind: 'connect-failed'; message: string }
  | { kind: 'auth-failed'; message: string }

export class SftpConnectionAccessFailure extends Error {
  constructor(readonly detail: SftpConnectionAccessError) {
    super(detail.message)
    this.name = 'SftpConnectionAccessFailure'
  }
}

type DedicatedEntry = {
  conn: SshConnection
  connectPromise: Promise<SshConnection>
  idleTimer: ReturnType<typeof setTimeout> | null
}

export type SftpConnectionPoolDeps = {
  getHost: (id: string) => SftpHost | undefined
  readPassword: (id: string) => string | null
  getBaseCallbacks: () => SshConnectionCallbacks
}

/**
 * Per-host pool of relay-free raw ssh2 connections for SFTP. Every host resolves to a DEDICATED
 * SshConnection opened via connect() (no relay/Node.js), cached and idle-reaped. A password host's
 * sealed password is fed to the credential flow so it never prompts on connect.
 */
export class SftpConnectionPool {
  private dedicated = new Map<string, DedicatedEntry>()
  // Per-host count of in-flight transfers holding the connection, so the idle reaper never fires
  // mid-stream (an active transfer is not idle).
  private inUse = new Map<string, number>()

  constructor(private deps: SftpConnectionPoolDeps) {}

  async getConnection(hostId: string): Promise<SshConnection> {
    const host = this.deps.getHost(hostId)
    if (!host) {
      throw new SftpConnectionAccessFailure({
        kind: 'unknown-target',
        message: `SFTP host "${hostId}" not found`
      })
    }
    return this.ensureDedicated(host)
  }

  private ensureDedicated(host: SftpHost): Promise<SshConnection> {
    const existing = this.dedicated.get(host.id)
    if (existing) {
      const status = existing.conn.getState().status
      // Why reuse only a healthy dedicated connection: a disconnected/failed one must be rebuilt so a
      // transient drop doesn't wedge SFTP on a dead transport.
      if (status === 'connected' || status === 'connecting' || status === 'reconnecting') {
        this.touch(host.id)
        return existing.connectPromise
      }
      this.teardownEntry(host.id)
    }

    const conn = new SshConnection(sftpHostToSshTarget(host), this.buildCallbacks(host))
    const connectPromise = this.connectDedicated(host.id, conn)
    this.dedicated.set(host.id, { conn, connectPromise, idleTimer: null })
    this.touch(host.id)
    return connectPromise
  }

  // Why: a password host feeds its sealed password straight to the auth flow (kind='password') instead
  // of prompting the user on every connect; a key host (or a missing password) uses the base callbacks.
  private buildCallbacks(host: SftpHost): SshConnectionCallbacks {
    const base = this.deps.getBaseCallbacks()
    if (host.authType !== 'password') {
      return base
    }
    return {
      ...base,
      onCredentialRequest: async (targetId, kind, detail) => {
        if (kind === 'password') {
          const stored = this.deps.readPassword(host.id)
          if (stored != null) {
            return stored
          }
        }
        return base.onCredentialRequest?.(targetId, kind, detail) ?? null
      }
    }
  }

  private async connectDedicated(hostId: string, conn: SshConnection): Promise<SshConnection> {
    try {
      await conn.connect()
      return conn
    } catch (error) {
      // Drop the failed entry so the next call retries rather than reusing a dead promise.
      if (this.dedicated.get(hostId)?.conn === conn) {
        this.teardownEntry(hostId)
      }
      throw toAccessFailure(conn, error)
    }
  }

  private touch(hostId: string): void {
    const entry = this.dedicated.get(hostId)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
    // Why: never arm the reaper while a transfer holds the connection — it would tear the transport
    // out from under an in-flight upload/download.
    if ((this.inUse.get(hostId) ?? 0) > 0) {
      return
    }
    entry.idleTimer = setTimeout(() => {
      void this.disconnect(hostId)
    }, SFTP_IDLE_TEARDOWN_MS)
    entry.idleTimer.unref?.()
  }

  /** Mark a host's connection in-use for a transfer so the idle reaper can't reap it mid-stream. */
  retain(hostId: string): void {
    this.inUse.set(hostId, (this.inUse.get(hostId) ?? 0) + 1)
    const entry = this.dedicated.get(hostId)
    if (entry?.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  /** Release a transfer's hold; when the last one drops, restart the idle countdown. */
  release(hostId: string): void {
    const next = (this.inUse.get(hostId) ?? 0) - 1
    if (next > 0) {
      this.inUse.set(hostId, next)
      return
    }
    this.inUse.delete(hostId)
    this.touch(hostId)
  }

  private teardownEntry(hostId: string): void {
    const entry = this.dedicated.get(hostId)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    this.dedicated.delete(hostId)
  }

  /** Close and forget the dedicated connection for one host (idle timeout, host removal). */
  async disconnect(hostId: string): Promise<void> {
    const entry = this.dedicated.get(hostId)
    if (!entry) {
      return
    }
    this.teardownEntry(hostId)
    this.inUse.delete(hostId)
    await entry.conn.disconnect().catch(() => {})
  }

  /** Close every dedicated connection (app quit / test reset). */
  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.dedicated.values())
    for (const entry of entries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer)
      }
    }
    this.dedicated.clear()
    this.inUse.clear()
    await Promise.allSettled(entries.map((entry) => entry.conn.disconnect()))
  }
}

// A dedicated SFTP connection reuses SshConnection, which is keyed on an SshTarget — map the SFTP host
// onto the minimal target fields connect() needs (no ssh-config alias; password comes via callbacks).
function sftpHostToSshTarget(host: SftpHost): SshTarget {
  return {
    id: host.id,
    label: host.label,
    host: host.host,
    port: host.port,
    username: host.username,
    configHost: host.host,
    source: 'manual',
    ...(host.authType === 'key' && host.identityFile ? { identityFile: host.identityFile } : {})
  }
}

// Auth failures read as their own typed error so the SFTP handlers can surface "wrong credentials"
// distinctly from an unreachable host; everything else is a connect failure.
function toAccessFailure(conn: SshConnection, error: unknown): SftpConnectionAccessFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (conn.getState().status === 'auth-failed') {
    return new SftpConnectionAccessFailure({ kind: 'auth-failed', message })
  }
  return new SftpConnectionAccessFailure({ kind: 'connect-failed', message })
}
