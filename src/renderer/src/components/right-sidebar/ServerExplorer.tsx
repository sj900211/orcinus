import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { GitFileStatus } from '../../../../shared/git-status-types'
import type { SftpHostView } from '../../../../shared/sftp-host-types'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { FileExplorerVirtualRows } from './FileExplorerVirtualRows'
import type { TreeNode } from './file-explorer-types'
import { createVisibleFileExplorerRowProjection } from './useFileExplorerVisibleRowProjection'
import { useFileExplorerSelection } from './useFileExplorerSelection'
import { useServerExplorerTree } from './useServerExplorerTree'
import { useServerExplorerVirtualizer } from './use-server-explorer-virtualizer'
import {
  downloadServerArchive,
  downloadServerFile,
  uploadFolderToServerDir
} from './server-explorer-transfers'
import { useServerExplorerTransferProgress } from './use-server-explorer-transfer-progress'
import { ServerExplorerRowMenu } from './ServerExplorerRowMenu'
import { ServerExplorerToolbar } from './ServerExplorerToolbar'
import { ServerExplorerNewFolderDialog } from './ServerExplorerNewFolderDialog'
import { ServerExplorerUploadConflictDialog } from './ServerExplorerUploadConflictDialog'
import { useServerExplorerMutations } from './use-server-explorer-mutations'
import { useServerExplorerUpload } from './use-server-explorer-upload'
import { parentPosixDir } from './server-explorer-directory-listing'
import { formatMtime, formatPosixMode } from './sftp-file-metadata'
import { formatBytes } from '@/components/status-bar/workspace-space-format'
import type { ServerExplorerViewFile } from './ServerExplorerFileViewerDialog'

// Lazy so Monaco is pulled only when the user first opens a remote file, not on panel mount.
const ServerExplorerFileViewerDialog = lazyWithRetry(
  () =>
    import('./ServerExplorerFileViewerDialog').then((module) => ({
      default: module.ServerExplorerFileViewerDialog
    })),
  { reloadKey: 'server-explorer-file-viewer' }
)

// Why: read-only tree never routes git status/ignore decoration; share one stable empty
// identity so the virtual rows don't re-render on every parent commit.
const EMPTY_STATUS = new Map<string, GitFileStatus>()
const EMPTY_FOLDER_STATUS = new Map<string, GitFileStatus | null>()
const EMPTY_IGNORED = new Set<string>()
const noop = (): void => {}

const HOST_ID_STORAGE_KEY = 'orcinus.serverExplorer.hostId'

// Trailing metadata for a remote row: size (files only) + POSIX permissions, right-aligned.
function renderRowMeta(node: TreeNode): React.ReactNode {
  const parts: string[] = []
  if (!node.isDirectory && node.size != null) {
    parts.push(formatBytes(node.size))
  }
  if (node.mtime != null) {
    parts.push(formatMtime(node.mtime))
  }
  if (node.mode != null) {
    parts.push(formatPosixMode(node.mode))
  }
  if (parts.length === 0) {
    return null
  }
  return (
    <span className="ml-auto shrink-0 pl-2 pr-2 font-mono text-[10px] whitespace-nowrap text-muted-foreground">
      {parts.join('  ')}
    </span>
  )
}

export default function ServerExplorer(): React.JSX.Element {
  const openSettingsPage = useAppStore((s) => s.openSettingsPage)
  const openSettingsTarget = useAppStore((s) => s.openSettingsTarget)
  const [hosts, setHosts] = useState<SftpHostView[]>([])
  const [hostsLoaded, setHostsLoaded] = useState(false)
  const [selectedHostId, setSelectedHostId] = useState<string | null>(() =>
    localStorage.getItem(HOST_ID_STORAGE_KEY)
  )
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [rootResolveError, setRootResolveError] = useState<string | null>(null)
  const [newFolderParent, setNewFolderParent] = useState<string | null>(null)
  const [viewingFile, setViewingFile] = useState<ServerExplorerViewFile | null>(null)

  useEffect(() => {
    let active = true
    void window.api.sftp.host.list().then((list) => {
      if (!active) {
        return
      }
      setHosts(list)
      setHostsLoaded(true)
      // Why: a persisted host that has since been removed must not leave a dangling selection.
      setSelectedHostId((current) =>
        current && list.some((host) => host.id === current) ? current : null
      )
    })
    return () => {
      active = false
    }
  }, [])

  const handleSelectHost = useCallback((hostId: string) => {
    setSelectedHostId(hostId)
    localStorage.setItem(HOST_ID_STORAGE_KEY, hostId)
  }, [])

  // Why: resolve the home directory ('.') to an absolute root before feeding the tree, so
  // child paths join against a real absolute POSIX path.
  // Why: open the tree at the host's configured base path (validated at save time); empty = server root.
  const configuredBasePath = hosts.find((host) => host.id === selectedHostId)?.basePath ?? ''
  const resolveGenerationRef = useRef(0)
  useEffect(() => {
    setRootPath(null)
    setRootResolveError(null)
    if (!selectedHostId) {
      return
    }
    const generation = (resolveGenerationRef.current += 1)
    void window.api.sftp
      .realpath({ targetId: selectedHostId, path: configuredBasePath || '/' })
      .then((result) => {
        if (generation !== resolveGenerationRef.current) {
          return
        }
        if (typeof result === 'string') {
          setRootPath(result)
        } else {
          setRootResolveError(result.error)
        }
      })
  }, [selectedHostId, configuredBasePath])

  const tree = useServerExplorerTree(selectedHostId, rootPath)
  const mutations = useServerExplorerMutations(selectedHostId, rootPath, tree)
  const upload = useServerExplorerUpload(selectedHostId)
  const scrollRef = useRef<HTMLDivElement>(null)
  const rowProjection = createVisibleFileExplorerRowProjection(
    { dirCache: tree.dirCache, expanded: tree.expanded, worktreePath: rootPath },
    {
      ignoredSet: EMPTY_IGNORED,
      showDotfiles: true,
      showGitIgnoredFiles: true
    }
  )
  const virtualizer = useServerExplorerVirtualizer(scrollRef, rowProjection)
  const isMac = useMemo(() => navigator.userAgent.includes('Mac'), [])
  const selection = useFileExplorerSelection(rowProjection, isMac)

  const handleRowClick = useCallback(
    (node: TreeNode, event: React.MouseEvent<HTMLButtonElement>) => {
      // Ctrl/Cmd/Shift build a multi-selection; a plain click replaces it with this row, then
      // toggles the directory or opens the file.
      selection.selectRowWithModifiers(node, event, (target) => {
        selection.setSelectedPaths(new Set([target.path]))
        if (target.isDirectory) {
          tree.toggleDir(target.path)
        } else {
          setViewingFile({ path: target.path, name: target.name })
        }
      })
    },
    [selection, tree]
  )
  const handleRefresh = useCallback(() => {
    if (rootPath) {
      tree.refreshDir(rootPath)
    }
  }, [rootPath, tree])

  const openSftpSettings = useCallback(() => {
    openSettingsPage()
    openSettingsTarget({ pane: 'sftp', repoId: null })
  }, [openSettingsPage, openSettingsTarget])

  useServerExplorerTransferProgress(tree.refreshDir)
  const handleDownload = useCallback(
    (remotePath: string, fileName: string) => {
      if (selectedHostId) {
        void downloadServerFile(selectedHostId, remotePath, fileName)
      }
    },
    [selectedHostId]
  )
  const handleDownloadArchive = useCallback(
    (remotePath: string, name: string) => {
      if (selectedHostId) {
        void downloadServerArchive(selectedHostId, [remotePath], name)
      }
    },
    [selectedHostId]
  )
  const handleDownloadArchiveMultiple = useCallback(
    (remotePaths: string[]) => {
      if (selectedHostId && remotePaths.length > 0) {
        void downloadServerArchive(selectedHostId, remotePaths, 'archive')
      }
    },
    [selectedHostId]
  )
  const handleUploadFolder = useCallback(
    (remoteDir: string) => {
      if (selectedHostId) {
        void uploadFolderToServerDir(selectedHostId, remoteDir)
      }
    },
    [selectedHostId]
  )
  const handleRowRefresh = useCallback(
    (node: TreeNode) => {
      tree.refreshDir(node.isDirectory ? node.path : parentPosixDir(node.path))
    },
    [tree]
  )
  const submitNewFolder = useCallback(
    (name: string) => {
      const parent = newFolderParent
      setNewFolderParent(null)
      if (!selectedHostId || !parent) {
        return
      }
      const path = `${parent.replace(/\/+$/, '')}/${name}`
      void window.api.sftp.mkdir({ targetId: selectedHostId, path }).then((result) => {
        if ('error' in result) {
          toast.error(result.error)
          return
        }
        tree.refreshDir(parent)
        toast.success(
          translate(
            'auto.components.right-sidebar.ServerExplorer.folderCreated',
            'Directory created'
          )
        )
      })
    },
    [newFolderParent, selectedHostId, tree]
  )

  if (hostsLoaded && hosts.length === 0) {
    return <NoHostsState onOpenSettings={openSftpSettings} />
  }

  const visibleRowCount = rowProjection.getVisibleCount()
  const isEmpty = visibleRowCount === 0
  const rootError = rootResolveError ?? tree.rootError
  const isLoading =
    Boolean(selectedHostId) && isEmpty && !rootError && (tree.rootCache?.loading ?? true)

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ServerExplorerToolbar
        hosts={hosts}
        selectedHostId={selectedHostId}
        onSelectHost={handleSelectHost}
        canOperate={Boolean(rootPath)}
        isLoading={isLoading}
        onUploadFiles={() => {
          if (rootPath) {
            upload.uploadFiles(rootPath)
          }
        }}
        onUploadFolder={() => {
          if (rootPath) {
            handleUploadFolder(rootPath)
          }
        }}
        onNewFolder={() => {
          if (rootPath) {
            setNewFolderParent(rootPath)
          }
        }}
        onRefresh={handleRefresh}
      />

      {!selectedHostId ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
          {translate(
            'auto.components.right-sidebar.ServerExplorer.pickHostPrompt',
            'Select a host to browse its files'
          )}
        </div>
      ) : (
        <ScrollArea
          className="h-full min-h-0"
          viewportRef={scrollRef}
          viewportClassName="h-full min-h-0 py-2"
          onDragOver={mutations.rootDropHandlers.onDragOver}
          onDrop={mutations.rootDropHandlers.onDrop}
        >
          {isEmpty ? (
            <FileExplorerTreeStatus
              isLoading={isLoading}
              error={rootError}
              isEmpty={!isLoading && !rootError}
              emptyMessage={translate(
                'auto.components.right-sidebar.ServerExplorer.emptyDir',
                'This directory is empty'
              )}
            />
          ) : (
            <FileExplorerVirtualRows
              virtualizer={virtualizer}
              inlineInputIndex={-1}
              rowProjection={rowProjection}
              inlineInput={null}
              handleInlineSubmit={noop}
              dismissInlineInput={noop}
              folderStatusByRelativePath={EMPTY_FOLDER_STATUS}
              statusByRelativePath={EMPTY_STATUS}
              ignoredByRelativePath={EMPTY_IGNORED}
              expanded={tree.expanded}
              dirCache={tree.dirCache}
              selectedPaths={selection.selectedPaths}
              activeFileId={null}
              flashingPath={null}
              deleteShortcutLabel=""
              connectionId={null}
              supportsFolderDownload={false}
              canOpenInOrcaBrowser={() => false}
              onClick={handleRowClick}
              onDoubleClick={noop}
              onViewFile={noop}
              onContextMenuSelect={selection.preserveSelectionForContextMenu}
              onCopyPaths={noop}
              onStartNew={noop}
              onStartRename={noop}
              onDuplicate={noop}
              onAddFolderAsProject={noop}
              canAddFolderAsProject={() => false}
              onOpenInTerminal={noop}
              onRequestDelete={mutations.handleDelete}
              onCollapseFolderSubtree={noop}
              onFindInFolder={noop}
              onMoveDrop={mutations.handleMove}
              onDragTargetChange={mutations.setDropTargetDir}
              onDragSourceChange={mutations.setDragSourcePath}
              onDragExpandDir={mutations.handleDragExpand}
              onNativeDragTargetChange={noop}
              onNativeDragExpandDir={noop}
              dropTargetDir={mutations.dropTargetDir}
              dragSourcePath={mutations.dragSourcePath}
              nativeDropTargetDir={null}
              renderContextMenu={(node) => (
                <ServerExplorerRowMenu
                  node={node}
                  selectedPaths={selection.selectedPaths}
                  onDownload={handleDownload}
                  onDownloadArchive={handleDownloadArchive}
                  onDownloadArchiveMultiple={handleDownloadArchiveMultiple}
                  onUploadHere={upload.uploadFiles}
                  onUploadFolderHere={handleUploadFolder}
                  onCreateFolder={setNewFolderParent}
                  onDelete={mutations.handleDelete}
                  onRefresh={handleRowRefresh}
                />
              )}
              renderRowMeta={renderRowMeta}
            />
          )}
        </ScrollArea>
      )}
      <ServerExplorerNewFolderDialog
        key={newFolderParent ?? 'closed'}
        open={newFolderParent != null}
        parentDir={newFolderParent ?? ''}
        onSubmit={submitNewFolder}
        onOpenChange={(open) => {
          if (!open) {
            setNewFolderParent(null)
          }
        }}
      />
      <ServerExplorerUploadConflictDialog
        key={upload.conflictName ?? 'closed'}
        name={upload.conflictName}
        onResolve={upload.resolveConflict}
      />
      {viewingFile && selectedHostId ? (
        <Suspense fallback={null}>
          <ServerExplorerFileViewerDialog
            targetId={selectedHostId}
            file={viewingFile}
            onClose={() => setViewingFile(null)}
          />
        </Suspense>
      ) : null}
    </div>
  )
}

function NoHostsState({ onOpenSettings }: { onOpenSettings: () => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center text-muted-foreground">
      <Server size={32} className="opacity-50" />
      <p className="text-sm">
        {translate(
          'auto.components.right-sidebar.ServerExplorer.noHosts',
          'No SFTP hosts configured'
        )}
      </p>
      <Button type="button" variant="outline" size="sm" onClick={onOpenSettings}>
        {translate('auto.components.right-sidebar.ServerExplorer.addHost', 'Add an SFTP host')}
      </Button>
    </div>
  )
}
