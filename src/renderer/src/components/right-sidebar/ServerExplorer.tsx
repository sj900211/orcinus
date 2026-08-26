import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus, FolderUp, RefreshCw, Server, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { GitFileStatus } from '../../../../shared/git-status-types'
import type { SftpHostView } from '../../../../shared/sftp-host-types'
import { FileExplorerTreeStatus } from './FileExplorerTreeStatus'
import { FileExplorerVirtualRows } from './FileExplorerVirtualRows'
import type { TreeNode } from './file-explorer-types'
import { createVisibleFileExplorerRowProjection } from './useFileExplorerVisibleRowProjection'
import { useServerExplorerTree } from './useServerExplorerTree'
import { useServerExplorerVirtualizer } from './use-server-explorer-virtualizer'
import {
  downloadServerFile,
  uploadFolderToServerDir,
  uploadToServerDir
} from './server-explorer-transfers'
import { useServerExplorerTransferProgress } from './use-server-explorer-transfer-progress'
import { ServerExplorerRowMenu } from './ServerExplorerRowMenu'
import { ServerExplorerNewFolderDialog } from './ServerExplorerNewFolderDialog'
import { useServerExplorerMutations } from './use-server-explorer-mutations'
import { parentPosixDir } from './server-explorer-directory-listing'

// Why: read-only tree never routes git status/ignore decoration; share one stable empty
// identity so the virtual rows don't re-render on every parent commit.
const EMPTY_STATUS = new Map<string, GitFileStatus>()
const EMPTY_FOLDER_STATUS = new Map<string, GitFileStatus | null>()
const EMPTY_IGNORED = new Set<string>()
const EMPTY_SELECTED = new Set<string>()
const noop = (): void => {}

const HOST_ID_STORAGE_KEY = 'orcinus.serverExplorer.hostId'

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

  const handleRowClick = useCallback(
    (node: TreeNode) => {
      if (node.isDirectory) {
        tree.toggleDir(node.path)
      }
    },
    [tree]
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

  useServerExplorerTransferProgress()
  const handleDownload = useCallback(
    (remotePath: string, fileName: string) => {
      if (selectedHostId) {
        void downloadServerFile(selectedHostId, remotePath, fileName)
      }
    },
    [selectedHostId]
  )
  const handleUpload = useCallback(
    (remoteDir: string) => {
      if (selectedHostId) {
        void uploadToServerDir(selectedHostId, remoteDir)
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
          translate('auto.components.right-sidebar.ServerExplorer.folderCreated', 'Folder created')
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
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Select value={selectedHostId ?? undefined} onValueChange={handleSelectHost}>
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
          onClick={() => {
            if (rootPath) {
              handleUpload(rootPath)
            }
          }}
          disabled={!rootPath}
          aria-label={translate(
            'auto.components.right-sidebar.ServerExplorer.upload',
            'Upload here'
          )}
        >
          <Upload size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (rootPath) {
              handleUploadFolder(rootPath)
            }
          }}
          disabled={!rootPath}
          aria-label={translate(
            'auto.components.right-sidebar.ServerExplorer.uploadFolder',
            'Upload folder here'
          )}
        >
          <FolderUp size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => {
            if (rootPath) {
              setNewFolderParent(rootPath)
            }
          }}
          disabled={!rootPath}
          aria-label={translate(
            'auto.components.right-sidebar.ServerExplorer.newFolder',
            'New folder'
          )}
        >
          <FolderPlus size={14} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-muted-foreground hover:text-foreground"
          onClick={handleRefresh}
          disabled={!rootPath}
          aria-label={translate('auto.components.right-sidebar.ServerExplorer.refresh', 'Refresh')}
        >
          <RefreshCw size={14} className={cn(isLoading && 'animate-spin')} />
        </Button>
      </div>

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
              selectedPaths={EMPTY_SELECTED}
              activeFileId={null}
              flashingPath={null}
              deleteShortcutLabel=""
              connectionId={null}
              supportsFolderDownload={false}
              canOpenInOrcaBrowser={() => false}
              onClick={handleRowClick}
              onDoubleClick={noop}
              onViewFile={noop}
              onContextMenuSelect={noop}
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
                  onDownload={handleDownload}
                  onUploadHere={handleUpload}
                  onUploadFolderHere={handleUploadFolder}
                  onCreateFolder={setNewFolderParent}
                  onDelete={mutations.handleDelete}
                  onRefresh={handleRowRefresh}
                />
              )}
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
