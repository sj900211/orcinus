import { Suspense } from 'react'
import { lazyWithRetry as lazy } from '@/lib/lazy-with-retry'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import TabBar from '@/components/tab-bar/TabBar'
import { useTabGroupWorkspaceModel } from '@/components/tab-group/useTabGroupWorkspaceModel'
import { resolveGroupTabFromVisibleId } from '@/components/tab-group/tab-group-visible-id'
import { useEditorChildTabShortcuts } from './use-editor-child-tab-shortcuts'

const EditorPanel = lazy(() => import('@/components/editor/EditorPanel'))

// Satellite multi-tab shell (Expedition 5, dungeon 4): the unified TabBar and
// the tab-group command hooks are reused WHOLE against this window's own store
// — the satellite's openFile calls already build a real unified tab group, so
// multi-tab is composition, not new state (FloatingTerminalPanel precedent:
// full TabBar outside the workbench, empty terminal/browser arrays, no
// DndContext — drag-reorder degrades inert without crashing).

const noop = (): void => {}

function EditorChildEmpty(): React.JSX.Element {
  return (
    <div className="flex h-full items-center justify-center px-8 text-sm text-muted-foreground">
      {translate('editorChild.noTabs', 'No files open in this window.')}
    </div>
  )
}

export function EditorChildShell({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const groupId = useAppStore((state) => state.activeGroupIdByWorktree[worktreeId] ?? null)

  if (!groupId) {
    // The boot openFile creates the group before this shell mounts; a missing
    // group only means every tab closed — main closes the window on the empty
    // report (owner decision D1), so this state is a brief transient.
    return <EditorChildEmpty />
  }
  return <EditorChildShellWithGroup worktreeId={worktreeId} groupId={groupId} />
}

function EditorChildShellWithGroup({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  const model = useTabGroupWorkspaceModel({ groupId, worktreeId })
  const { activeTab, commands, editorItems, tabBarOrder } = model

  useEditorChildTabShortcuts({
    onCloseActiveTab: () => {
      if (activeTab) {
        commands.closeItem(activeTab.id)
      }
    },
    onCloseAllTabs: commands.closeAllEditorTabsInGroup
  })

  const activeEditorTab =
    activeTab &&
    activeTab.contentType !== 'terminal' &&
    activeTab.contentType !== 'browser' &&
    activeTab.contentType !== 'simulator'
      ? activeTab
      : null

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col">
      {/* Why a plain 32px strip (no WebkitAppRegion): satellites use a native
          frame, so the tab row needs no drag-region choreography. */}
      <div className="h-[32px] shrink-0 border-b border-border bg-card">
        <div className="flex h-full items-stretch pr-1.5">
          <div className="h-full min-w-0 flex-1">
            <TabBar
              tabs={model.terminalTabs}
              activeTabId={null}
              groupId={groupId}
              worktreeId={worktreeId}
              expandedPaneByTabId={model.expandedPaneByTabId}
              onActivate={commands.activateTerminal}
              onClose={noop}
              onCloseOthers={(visibleId) => {
                const item = resolveGroupTabFromVisibleId(model.groupTabs, visibleId)
                if (item) {
                  commands.closeOthers(item.id)
                }
              }}
              onCloseToRight={(visibleId) => {
                const item = resolveGroupTabFromVisibleId(model.groupTabs, visibleId)
                if (item) {
                  commands.closeToRight(item.id)
                }
              }}
              onCloseToLeft={(visibleId) => {
                const item = resolveGroupTabFromVisibleId(model.groupTabs, visibleId)
                if (item) {
                  commands.closeToLeft(item.id)
                }
              }}
              onNewTerminalTab={noop}
              onNewBrowserTab={noop}
              onSetCustomTitle={commands.setTabCustomTitle}
              onSetTabColor={commands.setTabColor}
              onTogglePaneExpand={noop}
              editorFiles={editorItems}
              activeFileId={activeEditorTab?.id ?? null}
              activeTabType="editor"
              onActivateFile={commands.activateEditor}
              onCloseFile={commands.closeItem}
              onCloseAllFiles={commands.closeAllEditorTabsInGroup}
              onMakePreviewFilePermanent={(_fileId, tabId) => {
                if (!tabId) {
                  return
                }
                const item = model.groupTabs.find((candidate) => candidate.id === tabId)
                if (item) {
                  commands.makePreviewFilePermanent(item.entityId, item.id)
                }
              }}
              onPinFile={(_fileId, tabId) => {
                if (!tabId) {
                  return
                }
                const item = model.groupTabs.find((candidate) => candidate.id === tabId)
                if (item) {
                  commands.pinFile(item.entityId, item.id)
                }
              }}
              tabBarOrder={tabBarOrder}
              editorOnly
            />
          </div>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div className="absolute inset-0 flex min-h-0 min-w-0">
          {activeEditorTab ? (
            <Suspense fallback={<EditorChildEmpty />}>
              {/* Why entityId/id split (TabGroupPanel contract): activeFileId is
                  the OpenFile id, activeViewStateId keeps per-tab Monaco view
                  state distinct if the same file ever appears in two tabs. */}
              <EditorPanel
                activeFileId={activeEditorTab.entityId}
                activeViewStateId={activeEditorTab.id}
                isVisible
                isCmdSaveOwner
              />
            </Suspense>
          ) : (
            <EditorChildEmpty />
          )}
        </div>
      </div>
    </div>
  )
}
