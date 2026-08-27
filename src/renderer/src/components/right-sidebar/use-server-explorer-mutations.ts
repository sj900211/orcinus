import { useCallback, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { WORKSPACE_FILE_PATH_MIME } from '@/lib/workspace-file-drag'
import type { TreeNode } from './file-explorer-types'
import type { useServerExplorerTree } from './useServerExplorerTree'
import { joinPosix, parentPosixDir, posixBasename } from './server-explorer-directory-listing'

type ServerExplorerTree = ReturnType<typeof useServerExplorerTree>

type RootDropHandlers = {
  onDragOver: (event: React.DragEvent) => void
  onDrop: (event: React.DragEvent) => void
}

export type ServerExplorerMutations = {
  dropTargetDir: string | null
  dragSourcePath: string | null
  setDropTargetDir: (dir: string | null) => void
  setDragSourcePath: (path: string | null) => void
  handleDragExpand: (dir: string) => void
  handleMove: (sourcePath: string, destDir: string) => void
  handleDelete: (node: TreeNode) => void
  rootDropHandlers: RootDropHandlers
}

// Remote move (drag-and-drop) + delete for the Server Explorer. Move is a same-host rename that
// blocks on a name collision unless the user confirms an overwrite; delete always confirms because
// a remote SFTP server has no trash/undo.
export function useServerExplorerMutations(
  selectedHostId: string | null,
  rootPath: string | null,
  tree: ServerExplorerTree
): ServerExplorerMutations {
  const confirm = useConfirmationDialog()
  const [dropTargetDir, setDropTargetDir] = useState<string | null>(null)
  const [dragSourcePath, setDragSourcePath] = useState<string | null>(null)

  // Expand-only (never collapse) so the drag auto-expand timer can't fold a folder mid-drag.
  const handleDragExpand = useCallback(
    (dir: string) => {
      if (!tree.expanded.has(dir)) {
        tree.toggleDir(dir)
      }
    },
    [tree]
  )

  const handleMove = useCallback(
    (sourcePath: string, destDir: string) => {
      if (!selectedHostId) {
        return
      }
      const srcParent = parentPosixDir(sourcePath)
      // Reject no-op (same dir) and illegal moves (onto itself / into its own subtree).
      if (srcParent === destDir || destDir === sourcePath || destDir.startsWith(`${sourcePath}/`)) {
        return
      }
      const leaf = posixBasename(sourcePath)
      const destPath = joinPosix(destDir, leaf)
      void (async () => {
        let result = await window.api.sftp.move({ targetId: selectedHostId, sourcePath, destPath })
        if ('conflict' in result) {
          const confirmed = await confirm({
            title: translate(
              'auto.components.right-sidebar.ServerExplorer.moveOverwriteTitle',
              'Replace "{{value0}}"?',
              { value0: leaf }
            ),
            description: translate(
              'auto.components.right-sidebar.ServerExplorer.moveOverwriteDesc',
              'An item named "{{value0}}" already exists in the destination. Replacing it cannot be undone.',
              { value0: leaf }
            ),
            confirmLabel: translate(
              'auto.components.right-sidebar.ServerExplorer.replace',
              'Replace'
            ),
            confirmVariant: 'destructive'
          })
          if (!confirmed) {
            return
          }
          result = await window.api.sftp.move({
            targetId: selectedHostId,
            sourcePath,
            destPath,
            overwrite: true
          })
        }
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        if ('ok' in result) {
          tree.refreshDir(srcParent)
          tree.refreshDir(destDir)
          toast.success(translate('auto.components.right-sidebar.ServerExplorer.moved', 'Moved'))
        }
      })()
    },
    [selectedHostId, confirm, tree]
  )

  const handleDelete = useCallback(
    (node: TreeNode) => {
      if (!selectedHostId) {
        return
      }
      void (async () => {
        const confirmed = await confirm({
          title: translate(
            'auto.components.right-sidebar.ServerExplorer.deleteTitle',
            'Delete "{{value0}}"?',
            { value0: node.name }
          ),
          description: node.isDirectory
            ? translate(
                'auto.components.right-sidebar.ServerExplorer.deleteFolderDesc',
                'This permanently deletes the directory and its contents on the server. This cannot be undone.'
              )
            : translate(
                'auto.components.right-sidebar.ServerExplorer.deleteFileDesc',
                'This permanently deletes the file on the server. This cannot be undone.'
              ),
          confirmLabel: translate(
            'auto.components.right-sidebar.ServerExplorer.deleteConfirm',
            'Delete'
          ),
          confirmVariant: 'destructive'
        })
        if (!confirmed) {
          return
        }
        const result = await window.api.sftp.delete({
          targetId: selectedHostId,
          path: node.path,
          isDirectory: node.isDirectory
        })
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        // Drop the removed subtree's cache so a same-named dir created later doesn't show stale children.
        if (node.isDirectory) {
          tree.invalidateDir(node.path)
        }
        tree.refreshDir(parentPosixDir(node.path))
        toast.success(translate('auto.components.right-sidebar.ServerExplorer.deleted', 'Deleted'))
      })()
    },
    [selectedHostId, confirm, tree]
  )

  // Drop onto the empty tree background (or an opened-empty folder's area) moves the item to the
  // root. Row drops stopPropagation, so this only fires for background drops. SFTP rows are
  // single-select, so the single-path MIME is sufficient.
  const rootDropHandlers = useMemo<RootDropHandlers>(
    () => ({
      onDragOver: (event) => {
        if (!event.dataTransfer.types.includes(WORKSPACE_FILE_PATH_MIME)) {
          return
        }
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
      },
      onDrop: (event) => {
        if (!rootPath) {
          return
        }
        const sourcePath = event.dataTransfer.getData(WORKSPACE_FILE_PATH_MIME)
        if (!sourcePath) {
          return
        }
        event.preventDefault()
        setDropTargetDir(null)
        handleMove(sourcePath, rootPath)
      }
    }),
    [rootPath, handleMove]
  )

  return {
    dropTargetDir,
    dragSourcePath,
    setDropTargetDir,
    setDragSourcePath,
    handleDragExpand,
    handleMove,
    handleDelete,
    rootDropHandlers
  }
}
