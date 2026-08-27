import { FolderPlus, FolderUp, RefreshCw, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { SftpHostView } from '../../../../shared/sftp-host-types'

// Header for the Server Explorer: host picker + upload/new-directory/refresh actions. Split out of
// ServerExplorer to keep that file under the max-lines cap; the panel binds the action callbacks.
type ServerExplorerToolbarProps = {
  hosts: SftpHostView[]
  selectedHostId: string | null
  onSelectHost: (hostId: string) => void
  canOperate: boolean
  isLoading: boolean
  onUploadFiles: () => void
  onUploadFolder: () => void
  onNewFolder: () => void
  onRefresh: () => void
}

export function ServerExplorerToolbar({
  hosts,
  selectedHostId,
  onSelectHost,
  canOperate,
  isLoading,
  onUploadFiles,
  onUploadFolder,
  onNewFolder,
  onRefresh
}: ServerExplorerToolbarProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 border-b border-border px-3 py-2">
      <Select value={selectedHostId ?? undefined} onValueChange={onSelectHost}>
        <SelectTrigger size="sm" className="min-w-0 flex-1">
          <SelectValue
            placeholder={translate(
              'auto.components.right-sidebar.ServerExplorer.selectHost',
              'Select an SFTP host'
            )}
          />
        </SelectTrigger>
        <SelectContent>
          {hosts.map((host) => (
            <SelectItem key={host.id} value={host.id}>
              {host.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={onUploadFiles}
        disabled={!canOperate}
        aria-label={translate('auto.components.right-sidebar.ServerExplorer.upload', 'Upload here')}
      >
        <Upload size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={onUploadFolder}
        disabled={!canOperate}
        aria-label={translate(
          'auto.components.right-sidebar.ServerExplorer.uploadFolder',
          'Upload directory here'
        )}
      >
        <FolderUp size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={onNewFolder}
        disabled={!canOperate}
        aria-label={translate(
          'auto.components.right-sidebar.ServerExplorer.newFolder',
          'New directory'
        )}
      >
        <FolderPlus size={14} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="text-muted-foreground hover:text-foreground"
        onClick={onRefresh}
        disabled={!canOperate}
        aria-label={translate('auto.components.right-sidebar.ServerExplorer.refresh', 'Refresh')}
      >
        <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
      </Button>
    </div>
  )
}
