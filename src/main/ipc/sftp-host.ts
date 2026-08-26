import { ipcMain } from 'electron'
import {
  addSftpHost,
  getSftpHost,
  listSftpHostViews,
  removeSftpHost,
  updateSftpHost
} from '../ssh/sftp-host-store'
import type { SftpHost, SftpHostInput, SftpHostView } from '../../shared/sftp-host-types'
import type { SftpProbeConnection, SftpProbeListing } from '../ssh/sftp-probe'
import {
  realpathViaSftp,
  transferErrorMessage,
  withSftpChannel,
  type GetSftpConnection,
  type SftpError
} from './sftp-transfer-operations'

// IPC for the standalone SFTP host registry (Expedition 3, dungeon 4). Separate from the worktree SSH
// host handlers (ssh:*) so the two registries never share a channel or a list. Passwords are write-only:
// supplied on add/update, sealed by the store, and never returned (list carries only `hasPassword`).

const SFTP_HOST_IPC_CHANNELS = [
  'sftp:host:list',
  'sftp:host:add',
  'sftp:host:update',
  'sftp:host:remove',
  'sftp:host:test',
  'sftp:probe:list'
] as const

export type SftpHostPoolAccess = {
  getConnection: GetSftpConnection
  disconnect: (id: string) => void
  probeList: (connection: SftpProbeConnection, path: string) => Promise<SftpProbeListing>
}

// Draft-credential connection for the add/edit form's base-path validation + autocomplete.
function toProbeConnection(raw: unknown): SftpProbeConnection | SftpError {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Invalid connection' }
  }
  const record = raw as Record<string, unknown>
  const host = typeof record.host === 'string' ? record.host.trim() : ''
  const username = typeof record.username === 'string' ? record.username.trim() : ''
  if (!host) {
    return { error: 'Host is required' }
  }
  if (!username) {
    return { error: 'Username is required' }
  }
  const port =
    typeof record.port === 'number' && Number.isFinite(record.port) && record.port > 0
      ? Math.floor(record.port)
      : 22
  const authType = record.authType === 'password' ? 'password' : 'key'
  const identityFile =
    typeof record.identityFile === 'string' && record.identityFile.trim().length > 0
      ? record.identityFile.trim()
      : undefined
  const password =
    typeof record.password === 'string' && record.password.length > 0 ? record.password : undefined
  return { host, username, port, authType, identityFile, password }
}

function toHostInput(raw: unknown): SftpHostInput | SftpError {
  if (!raw || typeof raw !== 'object') {
    return { error: 'Invalid host input' }
  }
  const record = raw as Record<string, unknown>
  const label = typeof record.label === 'string' ? record.label.trim() : ''
  const host = typeof record.host === 'string' ? record.host.trim() : ''
  const username = typeof record.username === 'string' ? record.username.trim() : ''
  if (!label) {
    return { error: 'Label is required' }
  }
  if (!host) {
    return { error: 'Host is required' }
  }
  if (!username) {
    return { error: 'Username is required' }
  }
  const port =
    typeof record.port === 'number' && Number.isFinite(record.port) && record.port > 0
      ? Math.floor(record.port)
      : 22
  const authType = record.authType === 'password' ? 'password' : 'key'
  const identityFile =
    typeof record.identityFile === 'string' && record.identityFile.trim().length > 0
      ? record.identityFile.trim()
      : undefined
  const password =
    typeof record.password === 'string' && record.password.length > 0 ? record.password : undefined
  const basePath =
    typeof record.basePath === 'string' && record.basePath.trim().length > 0
      ? record.basePath.trim()
      : undefined
  return { label, host, port, username, authType, identityFile, password, basePath }
}

export function registerSftpHostHandlers(pool: SftpHostPoolAccess): void {
  for (const channel of SFTP_HOST_IPC_CHANNELS) {
    ipcMain.removeHandler(channel)
  }

  ipcMain.handle('sftp:host:list', (): SftpHostView[] => listSftpHostViews())

  ipcMain.handle('sftp:host:add', (_event, raw: unknown): SftpHost | SftpError => {
    const input = toHostInput(raw)
    if ('error' in input) {
      return input
    }
    if (input.authType === 'password' && !input.password) {
      return { error: 'Password is required for password authentication' }
    }
    return addSftpHost(input)
  })

  ipcMain.handle(
    'sftp:host:update',
    (_event, args: { id?: string; input?: unknown }): SftpHost | SftpError => {
      if (typeof args?.id !== 'string' || args.id.length === 0) {
        return { error: 'id is required' }
      }
      const input = toHostInput(args.input)
      if ('error' in input) {
        return input
      }
      const updated = updateSftpHost(args.id, input)
      if (!updated) {
        return { error: `SFTP host "${args.id}" not found` }
      }
      // Credentials/endpoint may have changed — drop any live connection so the next use reconnects.
      pool.disconnect(args.id)
      return updated
    }
  )

  ipcMain.handle('sftp:host:remove', (_event, args: { id?: string }): { ok: true } | SftpError => {
    if (typeof args?.id !== 'string' || args.id.length === 0) {
      return { error: 'id is required' }
    }
    pool.disconnect(args.id)
    removeSftpHost(args.id)
    return { ok: true }
  })

  ipcMain.handle(
    'sftp:host:test',
    async (_event, args: { id?: string }): Promise<{ ok: true } | SftpError> => {
      if (typeof args?.id !== 'string' || !getSftpHost(args.id)) {
        return { error: 'SFTP host not found' }
      }
      try {
        const conn = await pool.getConnection(args.id)
        await withSftpChannel(conn, (sftp) => realpathViaSftp(sftp, '.'))
        return { ok: true }
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )

  ipcMain.handle(
    'sftp:probe:list',
    async (
      _event,
      args: { connection?: unknown; path?: unknown }
    ): Promise<SftpProbeListing | SftpError> => {
      const connection = toProbeConnection(args?.connection)
      if ('error' in connection) {
        return connection
      }
      if (typeof args?.path !== 'string' || args.path.length === 0) {
        return { error: 'path is required' }
      }
      try {
        return await pool.probeList(connection, args.path)
      } catch (error) {
        return { error: transferErrorMessage(error) }
      }
    }
  )
}
