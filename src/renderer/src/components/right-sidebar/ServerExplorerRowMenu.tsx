import {
  Download,
  Eye,
  FileArchive,
  FolderPlus,
  FolderUp,
  RefreshCw,
  Trash2,
  Upload
} from 'lucide-react'
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
  selectedPaths: Set<string>
  onPreview: (node: TreeNode) => void
  onDownload: (remotePath: string, fileName: string) => void
  onDownloadArchive: (remotePath: string, name: string) => void
  onDownloadArchiveMultiple: (remotePaths: string[]) => void
  onUploadHere: (remoteDir: string) => void
  onUploadFolderHere: (remoteDir: string) => void
  onCreateFolder: (parentDir: string) => void
  onDelete: (node: TreeNode) => void
  onRefresh: (node: TreeNode) => void
}

export function ServerExplorerRowMenu({
  node,
  selectedPaths,
  onPreview,
  onDownload,
  onDownloadArchive,
  onDownloadArchiveMultiple,
  onUploadHere,
  onUploadFolderHere,
  onCreateFolder,
  onDelete,
  onRefresh
}: ServerExplorerRowMenuProps): React.JSX.Element {
  // Right-clicking inside a multi-selection archives the whole set (files + directories together).
  const multiSelected = selectedPaths.has(node.path) && selectedPaths.size > 1
  return (
    <ContextMenuContent className="w-52">
      {multiSelected ? (
        <>
          <ContextMenuItem onSelect={() => onDownloadArchiveMultiple([...selectedPaths])}>
            <FileArchive className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.downloadArchiveMultiple',
              'Download {{value0}} items as archive…',
              { value0: selectedPaths.size }
            )}
          </ContextMenuItem>
          <ContextMenuSeparator />
        </>
      ) : null}
      {node.isDirectory ? (
        <>
          <ContextMenuItem onSelect={() => onDownloadArchive(node.path, node.name)}>
            <FileArchive className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.downloadArchive',
              'Download as archive…'
            )}
          </ContextMenuItem>
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
              'Upload directory here…'
            )}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onCreateFolder(node.path)}>
            <FolderPlus className="size-3.5" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerRowMenu.newFolder',
              'New Directory…'
            )}
          </ContextMenuItem>
        </>
      ) : (
        <>
          <ContextMenuItem onSelect={() => onPreview(node)}>
            <Eye className="size-3.5" />
            {translate('auto.components.right-sidebar.ServerExplorerRowMenu.preview', 'Preview')}
          </ContextMenuItem>
          <ContextMenuItem onSelect={() => onDownload(node.path, node.name)}>
            <Download className="size-3.5" />
            {translate('auto.components.right-sidebar.ServerExplorerRowMenu.download', 'Download…')}
          </ContextMenuItem>
        </>
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
