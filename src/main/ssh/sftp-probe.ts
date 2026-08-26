import type { SFTPWrapper } from 'ssh2'
import type { SshTarget } from '../../shared/ssh-types'
import type { SftpHostAuthType } from '../../shared/sftp-host-types'
import { SshConnection, type SshConnectionCallbacks } from './ssh-connection'

// Relay-free probe connections for the SFTP host FORM: they validate a base-path and feed `ls`-style
// autocomplete BEFORE the host is saved, using the draft credentials the user is typing. Kept apart
// from SftpConnectionPool (which is keyed on a saved host id + the sealed password store) so an
// in-progress form never touches the persisted registry. One connection is cached per draft identity
// and reused across keystrokes; it is idle-reaped and dropped on quit.

const PROBE_IDLE_TEARDOWN_MS = 2 * 60 * 1000

export type SftpProbeConnection = {
  host: string
  port: number
  username: string
  authType: SftpHostAuthType
  identityFile?: string
  password?: string
}

export type SftpProbeEntry = { name: string; type: 'file' | 'directory' | 'symlink' }
export type SftpProbeListing = { resolvedPath: string; entries: SftpProbeEntry[] }

type ProbeEntry = {
  conn: SshConnection
  connectPromise: Promise<SshConnection>
  idleTimer: ReturnType<typeof setTimeout> | null
}

export type SftpProbePoolDeps = { getBaseCallbacks: () => SshConnectionCallbacks }

export class SftpProbePool {
  private probes = new Map<string, ProbeEntry>()

  constructor(private deps: SftpProbePoolDeps) {}

  /** Resolve `path` and list it on a draft connection — used for both existence checks and autocomplete. */
  async list(connection: SftpProbeConnection, path: string): Promise<SftpProbeListing> {
    const conn = await this.ensureProbe(connection)
    const sftp = await conn.sftp()
    try {
      const resolvedPath = await realpathViaSftp(sftp, path)
      const entries = await readdirViaSftp(sftp, resolvedPath)
      return { resolvedPath, entries }
    } finally {
      sftp.end()
    }
  }

  private ensureProbe(connection: SftpProbeConnection): Promise<SshConnection> {
    const key = probeKey(connection)
    const existing = this.probes.get(key)
    if (existing) {
      const status = existing.conn.getState().status
      if (status === 'connected' || status === 'connecting' || status === 'reconnecting') {
        this.touch(key)
        return existing.connectPromise
      }
      this.teardown(key)
    }
    const conn = new SshConnection(
      buildProbeTarget(connection, key),
      this.buildCallbacks(connection)
    )
    const connectPromise = this.connect(key, conn)
    this.probes.set(key, { conn, connectPromise, idleTimer: null })
    this.touch(key)
    return connectPromise
  }

  // Why: a password draft feeds its typed password straight to the auth flow instead of prompting.
  private buildCallbacks(connection: SftpProbeConnection): SshConnectionCallbacks {
    const base = this.deps.getBaseCallbacks()
    if (connection.authType !== 'password') {
      return base
    }
    return {
      ...base,
      onCredentialRequest: async (targetId, kind, detail) => {
        if (kind === 'password' && connection.password != null) {
          return connection.password
        }
        return base.onCredentialRequest?.(targetId, kind, detail) ?? null
      }
    }
  }

  private async connect(key: string, conn: SshConnection): Promise<SshConnection> {
    try {
      await conn.connect()
      return conn
    } catch (error) {
      if (this.probes.get(key)?.conn === conn) {
        this.teardown(key)
      }
      throw error
    }
  }

  private touch(key: string): void {
    const entry = this.probes.get(key)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    entry.idleTimer = setTimeout(() => {
      void this.disconnect(key)
    }, PROBE_IDLE_TEARDOWN_MS)
    entry.idleTimer.unref?.()
  }

  private teardown(key: string): void {
    const entry = this.probes.get(key)
    if (!entry) {
      return
    }
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer)
    }
    this.probes.delete(key)
  }

  private async disconnect(key: string): Promise<void> {
    const entry = this.probes.get(key)
    if (!entry) {
      return
    }
    this.teardown(key)
    await entry.conn.disconnect().catch(() => {})
  }

  /** Close every probe connection (app quit / test reset). */
  async disconnectAll(): Promise<void> {
    const entries = Array.from(this.probes.values())
    for (const entry of entries) {
      if (entry.idleTimer) {
        clearTimeout(entry.idleTimer)
      }
    }
    this.probes.clear()
    await Promise.allSettled(entries.map((entry) => entry.conn.disconnect()))
  }
}

function buildProbeTarget(connection: SftpProbeConnection, id: string): SshTarget {
  return {
    id,
    label: connection.host,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    configHost: connection.host,
    source: 'manual',
    ...(connection.authType === 'key' && connection.identityFile
      ? { identityFile: connection.identityFile }
      : {})
  }
}

// Identity + a non-reversible password fingerprint, so a changed password rebuilds the probe without
// holding the plaintext in a map key.
function probeKey(connection: SftpProbeConnection): string {
  const fingerprint =
    connection.authType === 'password' && connection.password
      ? String(djb2(connection.password))
      : 'none'
  return [
    connection.host,
    connection.port,
    connection.username,
    connection.authType,
    connection.identityFile ?? '',
    fingerprint
  ].join('|')
}

function djb2(value: string): number {
  let hash = 5381
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0
  }
  return hash >>> 0
}

function realpathViaSftp(sftp: SFTPWrapper, path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    sftp.realpath(path, (err, resolved) => (err ? reject(err) : resolve(resolved)))
  })
}

function readdirViaSftp(sftp: SFTPWrapper, path: string): Promise<SftpProbeEntry[]> {
  return new Promise((resolve, reject) => {
    sftp.readdir(path, (err, list) => {
      if (err) {
        reject(err)
        return
      }
      resolve((list ?? []).map((entry) => ({ name: entry.filename, type: entryType(entry.attrs) })))
    })
  })
}

function entryType(attrs: {
  isDirectory?: () => boolean
  isSymbolicLink?: () => boolean
}): SftpProbeEntry['type'] {
  if (attrs?.isDirectory?.()) {
    return 'directory'
  }
  if (attrs?.isSymbolicLink?.()) {
    return 'symlink'
  }
  return 'file'
}
