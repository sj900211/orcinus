import { Download, FolderPlus, FolderUp, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator
} from '@/components/ui/context-menu'
import type { TreeNode } from './file-explorer-types'
import { translate } from '@/i18n/i18n'

// SFTP-specific right-click menu for Server Explorer rows, rendered via FileExplorerRow's opt-in
// `renderContextMenu` prop so the shared local-explorer menu is untouched.
type ServerExplorerRowMenuProps = {
  node: TreeNode
  onDownload: (remotePath: string, fileName: string) => void
  onUploadHere: (remoteDir: string) => void
  onUploadFolderHere: (remoteDir: string) => void
  onCreateFolder: (parentDir: string) => void
  onDelete: (node: TreeNode) => void
  onRefresh: (node: TreeNode) => void
}

export function ServerExplorerRowMenu({
  node,
  onDownload,
  onUploadHere,
  onUploadFolderHere,
  onCreateFolder,
  onDelete,
  onRefresh
}: ServerExplorerRowMenuProps): React.JSX.Element {
  return (
    <ContextMenuContent className="w-52">
      {node.isDirectory ? (
        <>
          <ContextMenuItem onSelect={() => onUploadHere(node.path)}>
            <Upload className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.uploadHere',
              'Upload files here…'
            )}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onUploadFolderHere(node.path)}>
            <FolderUp className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.uploadFolderHere',
              'Upload folder here…'
            )}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFolder(node.path)}>
            <FolderPlus className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.newFolder',
              'New Folder…'
            )}
          </ContextMenuItem>
        </>
      ) : (
        <ContextMenuItem onSelect={() => onDownload(node.path, node.name)}>
          <Download className="size-3.5" />
          {translate('auto.components.right-sidebar.ServerExplorerRowMenu.download', 'Download…')}
        </ContextMenuItem>
      )}
      <ContextMenuSeparator />
      <ContextMenuItem variant="destructive" onSelect={() => onDelete(node)}>
        <Trash2 className="size-3.5" />
        {translate('auto.components.right-sidebar.ServerExplorerRowMenu.delete', 'Delete…')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => onRefresh(node)}>
        <RefreshCw className="size-3.5" />
        {translate('auto.components.right-sidebar.ServerExplorerRowMenu.refresh', 'Refresh')}
      </ContextMenuItem>
    </ContextMenuContent>
  )
}
