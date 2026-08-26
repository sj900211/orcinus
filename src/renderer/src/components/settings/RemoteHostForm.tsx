import { useCallback, useState } from 'react'
import { FileKey, KeyRound } from 'lucide-react'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'
import { SftpBasePathField, type SftpDirListing } from './SftpBasePathField'

export type SftpHostFormState = {
  label: string
  host: string
  username: string
  port: string
  authType: 'key' | 'password'
  identityFile: string
  password: string
  basePath: string
}

export const EMPTY_SFTP_HOST_FORM: SftpHostFormState = {
  label: '',
  host: '',
  username: '',
  port: '22',
  authType: 'key',
  identityFile: '',
  password: '',
  basePath: ''
}

type RemoteHostFormProps = {
  open: boolean
  editingId: string | null
  editingHasPassword: boolean
  form: SftpHostFormState
  saving: boolean
  onFormChange: (updater: (prev: SftpHostFormState) => SftpHostFormState) => void
  onSave: () => void
  onOpenChange: (open: boolean) => void
}

export function RemoteHostForm({
  open,
  editingId,
  editingHasPassword,
  form,
  saving,
  onFormChange,
  onSave,
  onOpenChange
}: RemoteHostFormProps): React.JSX.Element {
  const isEditing = editingId != null
  // The path field reports its own validity (via onValidityChange) on mount and every value change.
  const [basePathValid, setBasePathValid] = useState(true)

  const passwordEntered = form.password.trim().length > 0
  // A draft probe reaches the server for key auth (file/agent) or once a password is typed; otherwise
  // fall back to the saved host's sealed connection (editing without re-entering the password).
  const canDraftProbe =
    form.host.trim().length > 0 &&
    form.username.trim().length > 0 &&
    (form.authType === 'key' || passwordEntered)
  const canProbe = canDraftProbe || (isEditing && form.host.trim().length > 0)

  const listDirectory = useCallback(
    async (path: string): Promise<SftpDirListing | { error: string }> => {
      if (canDraftProbe) {
        return window.api.sftp.probe.list({
          connection: {
            host: form.host.trim(),
            port: Number.parseInt(form.port, 10) || 22,
            username: form.username.trim(),
            authType: form.authType,
            identityFile:
              form.authType === 'key' && form.identityFile.trim()
                ? form.identityFile.trim()
                : undefined,
            password: form.authType === 'password' && form.password ? form.password : undefined
          },
          path
        })
      }
      if (editingId) {
        const result = await window.api.sftp.readdir({ targetId: editingId, path })
        return 'error' in result
          ? result
          : { resolvedPath: result.resolvedPath, entries: result.entries }
      }
      return {
        error: translate('auto.components.settings.RemoteHostForm.noConnection', 'No connection')
      }
    },
    [
      canDraftProbe,
      editingId,
      form.host,
      form.port,
      form.username,
      form.authType,
      form.identityFile,
      form.password
    ]
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[calc(100vh-3rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl">
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (saving) {
              return
            }
            onSave()
          }}
        >
          <DialogHeader className="shrink-0 gap-1.5 border-b border-border/60 px-6 pt-6 pr-12 pb-4 text-left">
            <DialogTitle>
              {isEditing
                ? translate('auto.components.settings.RemoteHostForm.editTitle', 'Edit SFTP host')
                : translate('auto.components.settings.RemoteHostForm.addTitle', 'Add SFTP host')}
            </DialogTitle>
            <DialogDescription>
              {isEditing
                ? translate(
                    'auto.components.settings.RemoteHostForm.editDescription',
                    'Update connection details for this SFTP host.'
                  )
                : translate(
                    'auto.components.settings.RemoteHostForm.addDescription',
                    'Add a remote server to browse and transfer files over SFTP.'
                  )}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4 scrollbar-sleek">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sftp-host-label">
                  {translate('auto.components.settings.RemoteHostForm.label', 'Label')}
                </Label>
                <Input
                  id="sftp-host-label"
                  value={form.label}
                  onChange={(e) => onFormChange((f) => ({ ...f, label: e.target.value }))}
                  placeholder={translate(
                    'auto.components.settings.RemoteHostForm.labelPlaceholder',
                    'My Server'
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sftp-host-host">
                  {translate('auto.components.settings.RemoteHostForm.host', 'Host *')}
                </Label>
                <Input
                  id="sftp-host-host"
                  value={form.host}
                  autoFocus
                  onChange={(e) => onFormChange((f) => ({ ...f, host: e.target.value }))}
                  placeholder={translate(
                    'auto.components.settings.RemoteHostForm.hostPlaceholder',
                    'server.example.com'
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sftp-host-username">
                  {translate('auto.components.settings.RemoteHostForm.username', 'Username *')}
                </Label>
                <Input
                  id="sftp-host-username"
                  value={form.username}
                  onChange={(e) => onFormChange((f) => ({ ...f, username: e.target.value }))}
                  placeholder={translate(
                    'auto.components.settings.RemoteHostForm.usernamePlaceholder',
                    'deploy'
                  )}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sftp-host-port">
                  {translate('auto.components.settings.RemoteHostForm.port', 'Port')}
                </Label>
                <Input
                  id="sftp-host-port"
                  type="number"
                  value={form.port}
                  onChange={(e) => onFormChange((f) => ({ ...f, port: e.target.value }))}
                  placeholder="22"
                  min={1}
                  max={65535}
                />
              </div>

              <div className="col-span-2 space-y-1.5">
                <Label>
                  {translate(
                    'auto.components.settings.RemoteHostForm.authType',
                    'Authentication type'
                  )}
                </Label>
                <div className="flex gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant={form.authType === 'key' ? 'default' : 'outline'}
                    className="gap-1.5"
                    onClick={() => onFormChange((f) => ({ ...f, authType: 'key' }))}
                  >
                    <FileKey className="size-3.5" />
                    {translate('auto.components.settings.RemoteHostForm.authKey', 'Key pair')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={form.authType === 'password' ? 'default' : 'outline'}
                    className="gap-1.5"
                    onClick={() => onFormChange((f) => ({ ...f, authType: 'password' }))}
                  >
                    <KeyRound className="size-3.5" />
                    {translate('auto.components.settings.RemoteHostForm.authPassword', 'Password')}
                  </Button>
                </div>
              </div>

              {form.authType === 'key' ? (
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="sftp-host-identity" className="flex items-center gap-1.5">
                    <FileKey className="size-3.5" />
                    {translate(
                      'auto.components.settings.RemoteHostForm.identityFile',
                      'Identity File'
                    )}
                  </Label>
                  <Input
                    id="sftp-host-identity"
                    value={form.identityFile}
                    onChange={(e) => onFormChange((f) => ({ ...f, identityFile: e.target.value }))}
                    placeholder={translate(
                      'auto.components.settings.RemoteHostForm.identityPlaceholder',
                      '~/.ssh/id_ed25519 (leave empty for SSH agent)'
                    )}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {translate(
                      'auto.components.settings.RemoteHostForm.identityHint',
                      'Optional. SSH agent is used by default.'
                    )}
                  </p>
                </div>
              ) : (
                <div className="col-span-2 space-y-1.5">
                  <Label htmlFor="sftp-host-password" className="flex items-center gap-1.5">
                    <KeyRound className="size-3.5" />
                    {translate('auto.components.settings.RemoteHostForm.password', 'Password')}
                  </Label>
                  <Input
                    id="sftp-host-password"
                    type="password"
                    value={form.password}
                    onChange={(e) => onFormChange((f) => ({ ...f, password: e.target.value }))}
                    placeholder={
                      isEditing && editingHasPassword
                        ? translate(
                            'auto.components.settings.RemoteHostForm.passwordKeep',
                            'Leave blank to keep the saved password'
                          )
                        : translate(
                            'auto.components.settings.RemoteHostForm.passwordNew',
                            'Server password'
                          )
                    }
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {translate(
                      'auto.components.settings.RemoteHostForm.passwordHint',
                      'Stored encrypted with your OS keychain.'
                    )}
                  </p>
                </div>
              )}

              <SftpBasePathField
                value={form.basePath}
                onChange={(next) => onFormChange((f) => ({ ...f, basePath: next }))}
                onValidityChange={setBasePathValid}
                canProbe={canProbe}
                listDirectory={listDirectory}
              />
            </div>
          </div>

          <DialogFooter className="shrink-0 gap-2 border-t border-border/60 bg-muted/10 px-6 py-4 sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {translate('auto.components.settings.RemoteHostForm.cancel', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving || !basePathValid}>
              {isEditing
                ? translate('auto.components.settings.RemoteHostForm.save', 'Save Changes')
                : translate('auto.components.settings.RemoteHostForm.add', 'Add Host')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
