import {
  AppWindow,
  Copy,
  CopyX,
  ExternalLink,
  Eye,
  ListX,
  PanelLeftClose,
  PanelRightClose,
  Pencil,
  Pin,
  PinOff,
  X
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { showLocalPathOpenBlockedToast } from '@/lib/local-path-open-guard'
import { useOptionalShortcutLabel } from '@/hooks/useShortcutLabel'
import type { OpenFile } from '../../store/slices/editor'
import { shouldBlockEditorTabLocalOpen } from './editor-tab-local-open-guard'
import { getRendererWindowSurface } from '@/lib/renderer-window-surface'
import { getConnectionIdFromState } from '@/lib/connection-context'
import {
  isEditorFileEntityPinned,
  isEditorFileMovableToSatellite,
  moveEditorFileBackToParent,
  moveEditorFileToNewSatellite
} from '@/lib/satellite-editor-file-move'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { TabWorkspaceLayoutMenuSection } from './TabWorkspaceLayoutMenuSection'
import { TAB_CONTEXT_MENU_CONTENT_CLASS } from './tab-context-menu-sizing'

const isMac = navigator.userAgent.includes('Mac')
const isLinux = navigator.userAgent.includes('Linux')

/** Platform-appropriate label: macOS → Finder, Windows → File Explorer, Linux → Files */
const revealLabel = isMac
  ? 'Reveal in Finder'
  : isLinux
    ? 'Open Containing Folder'
    : 'Reveal in File Explorer'

type EditorFileTabContextMenuProps = {
  open: boolean
  menuPoint: { x: number; y: number }
  file: OpenFile & { tabId?: string }
  unifiedTabId: string
  groupId: string
  isPinned: boolean
  isRenaming: boolean
  hasTabsToRight: boolean
  hasTabsToLeft: boolean
  tabCount: number
  canRename: boolean
  canShowMarkdownPreview: boolean
  resolvedLanguage: string
  skipMenuFocusRestoreRef: React.MutableRefObject<boolean>
  onOpenChange: (open: boolean) => void
  onActivate: () => void
  onOpenRenameInput: () => void
  onTogglePin: () => void
  onClose: () => void
  onCloseOthers: () => void
  onCloseAll: () => void
  onCloseToRight: () => void
  onCloseToLeft: () => void
  onOpenMarkdownPreview: (
    file: {
      filePath: string
      relativePath: string
      worktreeId: string
      runtimeEnvironmentId?: string | null
      language: string
    },
    options: { sourceFileId: string }
  ) => void
}

export function EditorFileTabContextMenu({
  open,
  menuPoint,
  file,
  unifiedTabId,
  groupId,
  isPinned,
  isRenaming,
  hasTabsToRight,
  hasTabsToLeft,
  tabCount,
  canRename,
  canShowMarkdownPreview,
  resolvedLanguage,
  skipMenuFocusRestoreRef,
  onOpenChange,
  onActivate,
  onOpenRenameInput,
  onTogglePin,
  onClose,
  onCloseOthers,
  onCloseAll,
  onCloseToRight,
  onCloseToLeft,
  onOpenMarkdownPreview
}: EditorFileTabContextMenuProps): React.JSX.Element {
  // Review C8/C10: same resolver as the drag-out path — the old prop
  // (`repo?.connectionId ?? null`) collapsed "repo unknown" (undefined, e.g.
  // mid-SSH-hydration after a restore) into eligible-null.
  const repoConnectionId = useAppStore((s) => getConnectionIdFromState(s, file.worktreeId))
  // Review C11: pin gate at entity level (cross-group duplicates of the file).
  const isMoveEntityPinned = useAppStore((s) =>
    isEditorFileEntityPinned(s.unifiedTabsByWorktree[file.worktreeId], file.id)
  )
  const renameShortcut = useOptionalShortcutLabel('tab.rename')
  const closeShortcut = useOptionalShortcutLabel('tab.close')
  const closeAllShortcut = useOptionalShortcutLabel('tab.closeAll')

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          aria-hidden
          tabIndex={-1}
          className="pointer-events-none fixed size-px opacity-0"
          style={{ left: menuPoint.x, top: menuPoint.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className={TAB_CONTEXT_MENU_CONTENT_CLASS}
        sideOffset={0}
        align="start"
        onCloseAutoFocus={(event) => {
          if (!skipMenuFocusRestoreRef.current) {
            return
          }
          skipMenuFocusRestoreRef.current = false
          event.preventDefault()
        }}
      >
        {/* Why hidden in satellites (D11): "Move Tab to Split" would create a
            split group the satellite shell does not render. */}
        {getRendererWindowSurface() !== 'satellite' ? (
          <TabWorkspaceLayoutMenuSection
            unifiedTabId={unifiedTabId}
            groupId={groupId}
            trailingSeparator
          />
        ) : null}
        <DropdownMenuItem
          disabled={!canRename || isRenaming}
          onSelect={() => {
            skipMenuFocusRestoreRef.current = true
            onActivate()
            onOpenRenameInput()
          }}
        >
          <Pencil className="size-3.5" />
          {translate('auto.components.tab.bar.EditorFileTabContextMenu.68cc610e7f', 'Rename')}
          {renameShortcut ? <DropdownMenuShortcut>{renameShortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onTogglePin}>
          {isPinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          {isPinned
            ? translate('auto.components.tab.bar.EditorFileTabContextMenu.8e9d603a09', 'Unpin Tab')
            : translate('auto.components.tab.bar.EditorFileTabContextMenu.fdd29eb669', 'Pin Tab')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => !isPinned && onClose()} disabled={isPinned}>
          <X className="size-3.5" />
          {translate('auto.components.tab.bar.EditorFileTabContextMenu.1ba8492c5b', 'Close')}
          {closeShortcut ? <DropdownMenuShortcut>{closeShortcut}</DropdownMenuShortcut> : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCloseOthers} disabled={tabCount <= 1}>
          <CopyX className="size-3.5" />
          {translate('components.tab.bar.EditorFileTabContextMenu.closeOthers', 'Close Others')}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCloseAll}>
          <ListX className="size-3.5" />
          {translate(
            'auto.components.tab.bar.EditorFileTabContextMenu.ba1369dd24',
            'Close All Editor Tabs'
          )}
          {closeAllShortcut ? (
            <DropdownMenuShortcut>{closeAllShortcut}</DropdownMenuShortcut>
          ) : null}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCloseToRight} disabled={!hasTabsToRight}>
          <PanelRightClose className="size-3.5" />
          {translate(
            'auto.components.tab.bar.EditorFileTabContextMenu.e5ff31ccaf',
            'Close Tabs To The Right'
          )}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onCloseToLeft} disabled={!hasTabsToLeft}>
          <PanelLeftClose className="size-3.5" />
          {translate(
            'components.tab.bar.EditorFileTabContextMenu.closeTabsToLeft',
            'Close Tabs To The Left'
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {canShowMarkdownPreview ? (
          <>
            <DropdownMenuItem
              onSelect={() => {
                onActivate()
                onOpenMarkdownPreview(
                  {
                    filePath: file.filePath,
                    relativePath: file.relativePath,
                    worktreeId: file.worktreeId,
                    runtimeEnvironmentId: file.runtimeEnvironmentId,
                    language: resolvedLanguage
                  },
                  { sourceFileId: file.id }
                )
              }}
            >
              <Eye className="size-3.5" />
              {translate(
                'auto.components.tab.bar.EditorFileTabContextMenu.bfd5797ef4',
                'Open Markdown Preview'
              )}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        ) : null}
        <DropdownMenuItem
          onSelect={() => {
            void window.api.ui.writeClipboardText(file.filePath)
          }}
        >
          <Copy className="size-3.5" />
          {translate('auto.components.tab.bar.EditorFileTabContextMenu.5b85754786', 'Copy Path')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            void window.api.ui.writeClipboardText(file.relativePath)
          }}
        >
          <Copy className="size-3.5" />
          {translate(
            'auto.components.tab.bar.EditorFileTabContextMenu.52ce4f4605',
            'Copy Relative Path'
          )}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            if (
              shouldBlockEditorTabLocalOpen(
                useAppStore.getState().settings,
                file.runtimeEnvironmentId,
                repoConnectionId
              )
            ) {
              showLocalPathOpenBlockedToast()
              return
            }
            window.api.shell.openPath(file.filePath)
          }}
        >
          <ExternalLink className="size-3.5" />
          {revealLabel}
        </DropdownMenuItem>
        {/* TRUE move (dungeon 5): the WHY of each gate lives on the shared
            predicate, reused by the dungeon-6 tab drag-out so the two paths
            never drift. Hidden in satellites: main rejects
            satellite-of-satellite opens. */}
        {getRendererWindowSurface() !== 'satellite' &&
        isEditorFileMovableToSatellite({ file, isPinned: isMoveEntityPinned, repoConnectionId }) ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void moveEditorFileToNewSatellite({
                  file,
                  language: resolvedLanguage,
                  unifiedTabId: file.tabId ?? unifiedTabId
                }).then((moved) => {
                  if (!moved) {
                    toast.error(
                      translate(
                        'components.tab.bar.EditorFileTabContextMenu.moveToNewWindowFailed',
                        'Could not move the file to a new window.'
                      )
                    )
                  }
                })
              }}
            >
              <AppWindow className="size-3.5" />
              {translate(
                'components.tab.bar.EditorFileTabContextMenu.moveToNewWindow',
                'Move to New Window'
              )}
            </DropdownMenuItem>
          </>
        ) : null}
        {/* D6 Move Back: the explicit return path — satellite tab close stays a
            plain close. Satellite files are local edit tabs by construction. */}
        {getRendererWindowSurface() === 'satellite' && file.mode === 'edit' ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                void moveEditorFileBackToParent({
                  file,
                  language: resolvedLanguage,
                  unifiedTabId: file.tabId ?? unifiedTabId
                }).then((moved) => {
                  if (!moved) {
                    toast.error(
                      translate(
                        'components.tab.bar.EditorFileTabContextMenu.moveBackFailed',
                        'Could not move the file back to the main window.'
                      )
                    )
                  }
                })
              }}
            >
              <AppWindow className="size-3.5" />
              {translate(
                'components.tab.bar.EditorFileTabContextMenu.moveBackToMainWindow',
                'Move Back to Main Window'
              )}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
