import type { SshTarget } from '../../shared/ssh-types'
import type { SshConnectionManager } from './ssh-connection-manager'
import type { SshConnectionStore } from './ssh-connection-store'
import { SshConnection, type SshConnectionCallbacks } from './ssh-connection'

// Relay-free raw SSH connection accessor for the SFTP Server Explorer (Expedition 3).
//
// Why this exists apart from SshConnectionManager: `ssh:connect` deploys a Node.js relay on top of
// the transport (ipc/ssh.ts → SshRelaySession → ssh-remote-node-resolution needs Node 18+). A plain
// SFTP server has no Node.js, so that path never reaches 'connected'. SFTP needs only the raw ssh2
// channel, which SshConnection.connect()/sftp() provide with zero relay coupling — so we open and
// cache a dedicated raw connection per target here, reusing a live relay transport when one is up.

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
  getConnectionManager: () => SshConnectionManager | null
  getStore: () => SshConnectionStore | null
  getCallbacks: () => SshConnectionCallbacks
}

/**
 * Per-target pool of relay-free raw ssh2 connections for SFTP.
 *
 * Resolution order per target:
 *   1. A LIVE relay connection in the manager (already connected) — reuse its ssh2 client so we don't
 *      open a second transport to the same host.
 *   2. Otherwise a DEDICATED raw SshConnection we own, opened via connect() (no relay/Node.js),
 *      reusing the existing host-key/passphrase/known-hosts machinery connect() already wires.
 */
export class SftpConnectionPool {
  private dedicated = new Map<string, DedicatedEntry>()
  // Per-target count of in-flight transfers holding the connection, so the idle reaper never fires
  // mid-stream (an active transfer is not idle).
  private inUse = new Map<string, number>()

  constructor(private deps: SftpConnectionPoolDeps) {}

  async getConnection(targetId: string): Promise<SshConnection> {
    // Why prefer a live relay transport: reusing it shares session slots instead of competing with the
    // relay for the server's MaxSessions budget, and it needs no fresh auth prompt. But skip a
    // system-SSH transport — its sftp() always throws, so reusing it would guarantee SFTP failure when
    // a dedicated raw connection might actually serve SFTP.
    const live = this.deps.getConnectionManager()?.getConnection(targetId)
    if (live && live.getState().status === 'connected' && !live.usesSystemSshTransport()) {
      return live
    }

    const target = this.deps.getStore()?.getTarget(targetId)
    if (!target) {
      throw new SftpConnectionAccessFailure({
        kind: 'unknown-target',
        message: `SSH connection "${targetId}" not found`
      })
    }

    return this.ensureDedicated(target)
  }

  private ensureDedicated(target: SshTarget): Promise<SshConnection> {
    const existing = this.dedicated.get(target.id)
    if (existing) {
      const status = existing.conn.getState().status
      // Why reuse only a healthy dedicated connection: a disconnected/failed one must be rebuilt so a
      // transient drop doesn't wedge SFTP on a dead transport.
      if (status === 'connected' || status === 'connecting' || status === 'reconnecting') {
        this.touch(target.id)
        return existing.connectPromise
      }
      this.teardownEntry(target.id)
    }

    const conn = new SshConnection(target, this.deps.getCallbacks())
    const connectPromise = this.connectDedicated(target.id, conn)
    this.dedicated.set(target.id, { conn, connectPromise, idleTimer: null })
    this.touch(target.id)
    return connectPromise
  }

  private async connectDedicated(targetId: string, conn: SshConnection): Promise<SshConnection> {
    try {
      await conn.connect()
      return conn
    } catch (error) {
      // Drop the failed entry so the next call retries rather than reusing a dead promise.
      if (this.dedicated.get(targetId)?.conn === conn) {
        this.teardownEntry(targetId)
      }
      throw toAccessFailure(conn, error)
    }
  }

  private touch(targetId: string): void {
    const entry = this.dedicated.get(targetId)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
    // Why: never arm the reaper while a transfer holds the connection — it would tear the transport
    // out from under an in-flight upload/download.
    if ((this.inUse.get(targetId) ?? 0) > 0) {
      return
    }
    entry.idleTimer = setTimeout(() => {
      void this.disconnect(targetId)
    }, SFTP_IDLE_TEARDOWN_MS)
    entry.idleTimer.unref?.()
  }

  /** Mark a target's connection in-use for a transfer so the idle reaper can't reap it mid-stream. */
  retain(targetId: string): void {
    this.inUse.set(targetId, (this.inUse.get(targetId) ?? 0) + 1)
    const entry = this.dedicated.get(targetId)
    if (entry?.idleTimer) {
      clearTimeout(entry.idleTimer)
      entry.idleTimer = null
    }
  }

  /** Release a transfer's hold; when the last one drops, restart the idle countdown. */
  release(targetId: string): void {
    const next = (this.inUse.get(targetId) ?? 0) - 1
    if (next > 0) {
      this.inUse.set(targetId, next)
      return
    }
    this.inUse.delete(targetId)
    this.touch(targetId)
  }

  private teardownEntry(targetId: string): void {
    const entry = this.dedicated.get(targetId)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    this.dedicated.delete(targetId)
  }

  /** Close and forget the dedicated connection for one target (idle timeout, target removal). */
  async disconnect(targetId: string): Promise<void> {
    const entry = this.dedicated.get(targetId)
    if (!entry) {
      return
    }
    this.teardownEntry(targetId)
    this.inUse.delete(targetId)
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

// Auth failures read as their own typed error so the SFTP handlers can surface "wrong credentials"
// distinctly from an unreachable host; everything else is a connect failure.
function toAccessFailure(conn: SshConnection, error: unknown): SftpConnectionAccessFailure {
  const message = error instanceof Error ? error.message : String(error)
  if (conn.getState().status === 'auth-failed') {
    return new SftpConnectionAccessFailure({ kind: 'auth-failed', message })
  }
  return new SftpConnectionAccessFailure({ kind: 'connect-failed', message })
}
