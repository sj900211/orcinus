import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type * as NodeOs from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let tempHome = ''

vi.mock('node:os', async (importActual) => {
  const actual = await importActual<typeof NodeOs>()
  return { ...actual, homedir: () => tempHome }
})

import { tmpdir } from 'node:os'
import { _resetSecretStoreForTests, setSecretStore } from '../../shared/secret-store'
import {
  _resetSftpHostStoreCacheForTests,
  addSftpHost,
  getSftpHost,
  hasSftpHostPassword,
  listSftpHostViews,
  readSftpHostPassword,
  removeSftpHost,
  updateSftpHost
} from './sftp-host-store'

// A round-tripping stand-in for the OS keychain so the store's encrypt/decrypt path is exercised.
function installFakeSecretStore(): void {
  setSecretStore({
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(`enc:${text}`, 'utf-8'),
    decryptString: (cipher) => cipher.toString('utf-8').replace(/^enc:/, ''),
    describeProtectionGap: () => null
  })
}

describe('sftp-host-store', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'sftp-host-store-'))
    _resetSftpHostStoreCacheForTests()
    installFakeSecretStore()
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    _resetSecretStoreForTests()
    vi.clearAllMocks()
  })

  it('adds a key host with no sealed password', () => {
    const host = addSftpHost({
      label: 'h',
      host: '10.0.0.1',
      port: 22,
      username: 'u',
      authType: 'key',
      identityFile: '/k'
    })
    expect(host.id).toMatch(/^sftp-host-/)
    expect(host).toMatchObject({ label: 'h', authType: 'key', identityFile: '/k' })
    expect(hasSftpHostPassword(host.id)).toBe(false)
    expect(getSftpHost(host.id)).toEqual(host)
  })

  it('seals a password host password (round-trips, never in the host object or views)', () => {
    const host = addSftpHost({
      label: 'h',
      host: '10.0.0.1',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 's3cret'
    })
    expect(hasSftpHostPassword(host.id)).toBe(true)
    expect(readSftpHostPassword(host.id)).toBe('s3cret')
    expect((host as Record<string, unknown>).password).toBeUndefined()
    const view = listSftpHostViews().find((entry) => entry.id === host.id)!
    expect(view.hasPassword).toBe(true)
    expect((view as Record<string, unknown>).password).toBeUndefined()
  })

  it('persists the host and sealed password across a fresh store read', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    _resetSftpHostStoreCacheForTests()
    installFakeSecretStore()
    expect(getSftpHost(host.id)?.label).toBe('h')
    expect(readSftpHostPassword(host.id)).toBe('p')
  })

  it('keeps the sealed password on update when none is supplied', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    updateSftpHost(host.id, {
      label: 'h2',
      host: 'x',
      port: 2222,
      username: 'u',
      authType: 'password'
    })
    expect(getSftpHost(host.id)).toMatchObject({ label: 'h2', port: 2222 })
    expect(readSftpHostPassword(host.id)).toBe('p')
  })

  it('replaces the sealed password on update when a new one is supplied', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    updateSftpHost(host.id, {
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'new'
    })
    expect(readSftpHostPassword(host.id)).toBe('new')
  })

  it('deletes the sealed password when switching to key auth', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    updateSftpHost(host.id, {
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'key',
      identityFile: '/k'
    })
    expect(hasSftpHostPassword(host.id)).toBe(false)
    expect(readSftpHostPassword(host.id)).toBeNull()
  })

  it('remove deletes the host and its sealed password', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'password',
      password: 'p'
    })
    removeSftpHost(host.id)
    expect(getSftpHost(host.id)).toBeUndefined()
    expect(hasSftpHostPassword(host.id)).toBe(false)
  })

  it('returns null updating an unknown host', () => {
    expect(
      updateSftpHost('nope', { label: 'h', host: 'x', port: 22, username: 'u', authType: 'key' })
    ).toBeNull()
  })

  it('persists basePath across a fresh read and clears it when omitted', () => {
    const host = addSftpHost({
      label: 'h',
      host: 'x',
      port: 22,
      username: 'u',
      authType: 'key',
      basePath: '/srv/app'
    })
    expect(host.basePath).toBe('/srv/app')
    _resetSftpHostStoreCacheForTests()
    installFakeSecretStore()
    expect(getSftpHost(host.id)?.basePath).toBe('/srv/app')
    updateSftpHost(host.id, { label: 'h', host: 'x', port: 22, username: 'u', authType: 'key' })
    expect(getSftpHost(host.id)?.basePath).toBeUndefined()
  })
})
