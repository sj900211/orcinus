// Remote hosts used ONLY for the SFTP file-tree feature (browse/transfer). Kept in a registry
// separate from worktree SSH targets (SshTarget) so the two purposes never share one list — and so
// this feature can carry password auth without touching the worktree host model.

export type SftpHostAuthType = 'key' | 'password'

export type SftpHost = {
  id: string
  label: string
  host: string
  port: number
  username: string
  authType: SftpHostAuthType
  /** Path to a private key file, when authType === 'key'. */
  identityFile?: string
  /** Directory the Server Explorer opens at. Empty = the server root (/). */
  basePath?: string
}

/** Create/update payload from the renderer. The password is write-only: supplied here on save,
 *  stored OS-encrypted, and never persisted in the host JSON nor returned in listings. */
export type SftpHostInput = {
  label: string
  host: string
  port: number
  username: string
  authType: SftpHostAuthType
  identityFile?: string
  /** Directory the Server Explorer opens at; validated to exist before save. Empty = the server root (/). */
  basePath?: string
  /** Plaintext password for authType === 'password'; encrypted at rest, never echoed back. */
  password?: string
}

/** Host as surfaced to the renderer: no secret value, plus whether a password is on file. */
export type SftpHostView = SftpHost & { hasPassword: boolean }
