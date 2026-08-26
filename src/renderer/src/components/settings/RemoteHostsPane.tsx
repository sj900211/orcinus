import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Pencil, Plug, Plus, Trash2 } from 'lucide-react'
import type { SftpHostInput, SftpHostView } from '../../../../shared/sftp-host-types'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '../ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '../ui/dialog'
import { EMPTY_SFTP_HOST_FORM, RemoteHostForm, type SftpHostFormState } from './RemoteHostForm'
import { translate } from '@/i18n/i18n'
export { getRemoteHostsPaneSearchEntries } from './remote-hosts-search'

function toSftpHostInput(form: SftpHostFormState): SftpHostInput {
  return {
    label: form.label.trim(),
    host: form.host.trim(),
    username: form.username.trim(),
    port: Number.parseInt(form.port, 10) || 22,
    authType: form.authType,
    identityFile:
      form.authType === 'key' && form.identityFile.trim() ? form.identityFile.trim() : undefined,
    password: form.authType === 'password' && form.password ? form.password : undefined,
    basePath: form.basePath.trim() ? form.basePath.trim() : undefined
  }
}

function endpointSummary(host: SftpHostView): string {
  const base = host.username ? `${host.username}@${host.host}` : host.host
  return host.port && host.port !== 22 ? `${base}:${host.port}` : base
}

export function RemoteHostsPane(): React.JSX.Element {
  const [hosts, setHosts] = useState<SftpHostView[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingHasPassword, setEditingHasPassword] = useState(false)
  const [form, setForm] = useState<SftpHostFormState>(EMPTY_SFTP_HOST_FORM)
  const [saving, setSaving] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<SftpHostView | null>(null)
  const mountedRef = useMountedRef()

  const loadHosts = useCallback(async (): Promise<void> => {
    try {
      const result = await window.api.sftp.host.list()
      if (mountedRef.current) {
        setHosts(result)
      }
    } catch {
      if (mountedRef.current) {
        toast.error(
          translate(
            'auto.components.settings.RemoteHostsPane.loadFailed',
            'Failed to load SFTP hosts'
          )
        )
      }
    }
  }, [mountedRef])

  useEffect(() => {
    void loadHosts()
  }, [loadHosts])

  const openAdd = (): void => {
    setEditingId(null)
    setEditingHasPassword(false)
    setForm(EMPTY_SFTP_HOST_FORM)
    setShowForm(true)
  }

  const openEdit = (host: SftpHostView): void => {
    setEditingId(host.id)
    setEditingHasPassword(host.hasPassword)
    setForm({
      label: host.label,
      host: host.host,
      username: host.username,
      port: String(host.port),
      authType: host.authType,
      identityFile: host.identityFile ?? '',
      password: '',
      basePath: host.basePath ?? ''
    })
    setShowForm(true)
  }

  const cancelForm = (): void => {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_SFTP_HOST_FORM)
  }

  const handleSave = async (): Promise<void> => {
    const input = toSftpHostInput(form)
    if (!input.label || !input.host || !input.username) {
      toast.error(
        translate(
          'auto.components.settings.RemoteHostsPane.missingFields',
          'Label, host, and username are required'
        )
      )
      return
    }
    if (saving) {
      return
    }
    setSaving(true)
    try {
      const result = editingId
        ? await window.api.sftp.host.update({ id: editingId, input })
        : await window.api.sftp.host.add(input)
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (mountedRef.current) {
        toast.success(
          editingId
            ? translate('auto.components.settings.RemoteHostsPane.updated', 'Host updated')
            : translate('auto.components.settings.RemoteHostsPane.added', 'Host added')
        )
        cancelForm()
        await loadHosts()
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(
          err instanceof Error
            ? err.message
            : translate(
                'auto.components.settings.RemoteHostsPane.saveFailed',
                'Failed to save host'
              )
        )
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  const handleRemove = async (host: SftpHostView): Promise<void> => {
    setRemoveTarget(null)
    try {
      const result = await window.api.sftp.host.remove({ id: host.id })
      if ('error' in result) {
        toast.error(result.error)
        return
      }
      if (mountedRef.current) {
        toast.success(translate('auto.components.settings.RemoteHostsPane.removed', 'Host removed'))
        await loadHosts()
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(
          err instanceof Error
            ? err.message
            : translate(
                'auto.components.settings.RemoteHostsPane.removeFailed',
                'Failed to remove host'
              )
        )
      }
    }
  }

  const handleTest = async (host: SftpHostView): Promise<void> => {
    setTestingIds((prev) => new Set(prev).add(host.id))
    try {
      const result = await window.api.sftp.host.test({ id: host.id })
      if (mountedRef.current) {
        if ('ok' in result) {
          toast.success(
            translate('auto.components.settings.RemoteHostsPane.testOk', 'Connection successful')
          )
        } else {
          toast.error(result.error)
        }
      }
    } finally {
      if (mountedRef.current) {
        setTestingIds((prev) => {
          const next = new Set(prev)
          next.delete(host.id)
          return next
        })
      }
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">
            {translate('auto.components.settings.RemoteHostsPane.title', 'SFTP hosts')}
          </p>
          <p className="text-xs text-muted-foreground">
            {translate(
              'auto.components.settings.RemoteHostsPane.description',
              'Add remote servers to browse and transfer files over SFTP. Separate from SSH worktree hosts.'
            )}
          </p>
        </div>
        <Button variant="outline" size="xs" onClick={openAdd} className="shrink-0 gap-1.5">
          <Plus className="size-3" />
          {translate('auto.components.settings.RemoteHostsPane.add', 'Add Host')}
        </Button>
      </div>

      {hosts.length === 0 ? (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-border/60 bg-card/30 px-4 py-5 text-sm text-muted-foreground">
          {translate('auto.components.settings.RemoteHostsPane.empty', 'No SFTP hosts configured.')}
        </div>
      ) : (
        <div className="space-y-2">
          {hosts.map((host) => (
            <div
              key={host.id}
              className="flex items-center gap-3 rounded-lg border border-border/60 bg-card/30 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{host.label}</span>
                  <span className="rounded-full border border-border/60 bg-muted/20 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {host.authType === 'password'
                      ? translate(
                          'auto.components.settings.RemoteHostsPane.badgePassword',
                          'Password'
                        )
                      : translate('auto.components.settings.RemoteHostsPane.badgeKey', 'Key')}
                  </span>
                </div>
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {endpointSummary(host)}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  variant="ghost"
                  size="xs"
                  className="gap-1.5"
                  disabled={testingIds.has(host.id)}
                  onClick={() => void handleTest(host)}
                >
                  <Plug className="size-3" />
                  {testingIds.has(host.id)
                    ? translate('auto.components.settings.RemoteHostsPane.testing', 'Testing…')
                    : translate('auto.components.settings.RemoteHostsPane.test', 'Test')}
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate('auto.components.settings.RemoteHostsPane.edit', 'Edit')}
                  onClick={() => openEdit(host)}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={translate(
                    'auto.components.settings.RemoteHostsPane.remove',
                    'Remove'
                  )}
                  onClick={() => setRemoveTarget(host)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <RemoteHostForm
        open={showForm}
        editingId={editingId}
        editingHasPassword={editingHasPassword}
        form={form}
        saving={saving}
        onFormChange={setForm}
        onSave={() => void handleSave()}
        onOpenChange={(next) => {
          if (!next) {
            cancelForm()
          }
        }}
      />

      <Dialog
        open={removeTarget != null}
        onOpenChange={(open) => {
          if (!open) {
            setRemoveTarget(null)
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.settings.RemoteHostsPane.removeTitle',
                'Remove SFTP host?'
              )}
            </DialogTitle>
            <DialogDescription>
              {translate(
                'auto.components.settings.RemoteHostsPane.removeBody',
                'Remove "{{value0}}"? Its saved password is deleted. You can add it again later.',
                { value0: removeTarget?.label ?? '' }
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" size="sm" onClick={() => setRemoveTarget(null)}>
              {translate('auto.components.settings.RemoteHostsPane.cancel', 'Cancel')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (removeTarget) {
                  void handleRemove(removeTarget)
                }
              }}
            >
              {translate('auto.components.settings.RemoteHostsPane.remove', 'Remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
