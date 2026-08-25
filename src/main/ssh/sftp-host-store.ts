import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { getSecretStore } from '../../shared/secret-store'
import { credentialFileHasContent, writeCredentialFileAtomic } from '../integration-credential-file'
import type { SftpHost, SftpHostInput, SftpHostView } from '../../shared/sftp-host-types'

// Standalone registry for SFTP hosts (Expedition 3), deliberately separate from the worktree SSH
// target store so the two purposes never share one list. Modeled on the Jira/Linear credential
// stores: host metadata in a JSON file, each host's password sealed in its own OS-encrypted file —
// the password is never written into the JSON nor returned to the renderer.

type SftpHostFile = { version: 1; hosts: SftpHost[] }

let cachedFile: SftpHostFile | null = null

function orcaDir(): string {
  return join(homedir(), '.orca')
}
function hostsFilePath(): string {
  return join(orcaDir(), 'sftp-hosts.json')
}
function secretsDir(): string {
  return join(orcaDir(), 'sftp-host-secrets')
}
function passwordPath(id: string): string {
  return join(secretsDir(), `${Buffer.from(id).toString('base64url')}.enc`)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

function normalizeHost(input: unknown): SftpHost | null {
  if (!input || typeof input !== 'object') {
    return null
  }
  const r = input as Record<string, unknown>
  if (
    typeof r.id !== 'string' ||
    typeof r.label !== 'string' ||
    typeof r.host !== 'string' ||
    typeof r.username !== 'string'
  ) {
    return null
  }
  return {
    id: r.id,
    label: r.label,
    host: r.host,
    port: typeof r.port === 'number' ? r.port : 22,
    username: r.username,
    authType: r.authType === 'password' ? 'password' : 'key',
    ...(typeof r.identityFile === 'string' && r.identityFile.length > 0
      ? { identityFile: r.identityFile }
      : {})
  }
}

function readFileFromDisk(): SftpHostFile {
  const path = hostsFilePath()
  if (!existsSync(path)) {
    return { version: 1, hosts: [] }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, { encoding: 'utf-8' })) as Partial<SftpHostFile>
    const hosts = Array.isArray(parsed.hosts)
      ? parsed.hosts.map(normalizeHost).filter((host): host is SftpHost => host !== null)
      : []
    return { version: 1, hosts }
  } catch {
    return { version: 1, hosts: [] }
  }
}

function getFile(): SftpHostFile {
  cachedFile ??= readFileFromDisk()
  return cachedFile
}

function writeFile(file: SftpHostFile): void {
  ensureDir(orcaDir())
  cachedFile = file
  writeFileSync(hostsFilePath(), JSON.stringify(file, null, 2), { encoding: 'utf-8', mode: 0o600 })
}

function hostFromInput(id: string, input: SftpHostInput): SftpHost {
  return {
    id,
    label: input.label,
    host: input.host,
    port: input.port,
    username: input.username,
    authType: input.authType,
    ...(input.authType === 'key' && input.identityFile ? { identityFile: input.identityFile } : {})
  }
}

export function listSftpHosts(): SftpHost[] {
  return getFile().hosts
}

export function getSftpHost(id: string): SftpHost | undefined {
  return getFile().hosts.find((host) => host.id === id)
}

/** Hosts for the renderer: metadata plus whether a password is on file (never the value). */
export function listSftpHostViews(): SftpHostView[] {
  return getFile().hosts.map((host) => ({ ...host, hasPassword: hasSftpHostPassword(host.id) }))
}

export function addSftpHost(input: SftpHostInput): SftpHost {
  const id = `sftp-host-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const host = hostFromInput(id, input)
  writeFile({ version: 1, hosts: [...getFile().hosts, host] })
  if (host.authType === 'password' && input.password) {
    savePassword(id, input.password)
  }
  return host
}

export function updateSftpHost(id: string, input: SftpHostInput): SftpHost | null {
  const file = getFile()
  const index = file.hosts.findIndex((host) => host.id === id)
  if (index === -1) {
    return null
  }
  const host = hostFromInput(id, input)
  const hosts = [...file.hosts]
  hosts[index] = host
  writeFile({ version: 1, hosts })
  if (host.authType === 'password') {
    // Empty/undefined password on edit means keep the sealed one (the form never echoes it back).
    if (input.password) {
      savePassword(id, input.password)
    }
  } else {
    deletePassword(id)
  }
  return host
}

export function removeSftpHost(id: string): void {
  writeFile({ version: 1, hosts: getFile().hosts.filter((host) => host.id !== id) })
  deletePassword(id)
}

// ── password: OS-encrypted, one sealed file per host ───────────────────────

export function hasSftpHostPassword(id: string): boolean {
  return credentialFileHasContent(passwordPath(id))
}

export function readSftpHostPassword(id: string): string | null {
  const path = passwordPath(id)
  if (!credentialFileHasContent(path)) {
    return null
  }
  let raw: Buffer
  try {
    raw = readFileSync(path)
  } catch {
    return null
  }
  if (getSecretStore().isEncryptionAvailable()) {
    try {
      const value = getSecretStore().decryptString(raw)
      return value.length > 0 ? value : null
    } catch {
      return null
    }
  }
  // Keyring unavailable: the value was stored as 0600 plaintext (documented fallback).
  const plaintext = raw.toString('utf-8')
  return plaintext.length > 0 ? plaintext : null
}

function savePassword(id: string, password: string): void {
  ensureDir(secretsDir())
  if (getSecretStore().isEncryptionAvailable()) {
    writeCredentialFileAtomic(passwordPath(id), getSecretStore().encryptString(password))
    return
  }
  console.warn('[sftp] secret encryption unavailable — storing password in plaintext')
  writeCredentialFileAtomic(passwordPath(id), Buffer.from(password, 'utf-8'))
}

function deletePassword(id: string): void {
  try {
    unlinkSync(passwordPath(id))
  } catch {
    // Not present — fine.
  }
}

/** Test-only: drop the in-memory cache so a suite re-reads from its mocked fs. */
export function _resetSftpHostStoreCacheForTests(): void {
  cachedFile = null
}
