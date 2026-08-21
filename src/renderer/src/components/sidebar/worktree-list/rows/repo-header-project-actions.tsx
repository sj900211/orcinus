import React from 'react'
import {
  AppWindow,
  CircleX,
  Ellipsis,
  Eye,
  FolderInput,
  FolderPlus,
  Plus,
  Shapes,
  SlidersHorizontal,
  Trash2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { getRepositoryIconSectionId } from '@/components/settings/repository-settings-targets'
import type { ProjectGroup } from '../../../../../../shared/project-group-types'
import type { Repo } from '../../../../../../shared/repo-types'
import type { WorktreeVisibilityDefaults } from '../../../../../../shared/global-settings-types'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../../../../../../shared/execution-host'
import { isGitRepoKind } from '../../../../../../shared/repo-kind'
import { projectKeyForWorkspaceKey } from '../../../../../../shared/project-window-key'
import {
  effectiveExternalWorktreeVisibility,
  isLegacyRepoForExternalWorktreeVisibility
} from '../../../../../../shared/worktree/ownership'
import {
  REPO_HEADER_ACTION_BUTTON_CLASS,
  REPO_HEADER_ACTION_REVEAL_CLASS
} from '../../repo-header-action-button-class'
import type { getRepoHeaderCreateState } from '../../repo-header-create-state'
import {
  handleRepoHeaderActionPointerDown,
  stopRepoHeaderKeyboardToggle,
  stopRepoHeaderMenuEvent
} from './header-event-guards'

function getWorktreeVisibilityMenuLabel(
  repo: Repo,
  visibilityDefaults?: WorktreeVisibilityDefaults
): string {
  const visibility = effectiveExternalWorktreeVisibility(
    repo,
    isLegacyRepoForExternalWorktreeVisibility(repo),
    visibilityDefaults
  )
  return visibility === 'show' ? 'Hide non-Orca worktrees' : 'Show hidden worktrees'
}

/**
 * "Open in New Window" gating for a project header. SSH/runtime-hosted projects are
 * excluded: a project window defers non-local terminal attach, so it would open onto
 * dead panes. Shown only for a FREE project — one no window currently owns: not open
 * in another window (its header is a marker there) AND not this window's own active
 * project (already shown here). Free-only both matches "open a project you aren't
 * focused on" and structurally caps windows at the project count (main included):
 * each open consumes a free project, so you run out of windows before projects.
 */
export function canOpenProjectInNewWindow(args: {
  isOpenInOtherWindow: boolean
  isOwnActiveProject: boolean
  executionHostId: ExecutionHostId
}): boolean {
  return (
    !args.isOpenInOtherWindow &&
    !args.isOwnActiveProject &&
    args.executionHostId === LOCAL_EXECUTION_HOST_ID
  )
}

export type RepoHeaderProjectActions = {
  getWorktreeVisibilityDefaults: (repo: Repo) => WorktreeVisibilityDefaults | undefined
  onOpenRepoSettings: (projectId: string, sectionId?: string) => void
  onOpenWorktreeVisibility: (repo: Repo) => void
  onCreateGroupFromRepo: (repo: Repo) => void
  onMoveProjectToGroup: (repo: Repo, groupId: string) => void
  onRemoveProjectFromGroup: (repo: Repo) => void
  onRemoveProject: (repo: Repo) => void
  onCreateForRepo: (projectId: string) => void
}

export function RepoHeaderProjectActionsMenu({
  repo,
  label,
  projectGroups,
  actions
}: {
  repo: Repo
  label: string
  projectGroups: readonly ProjectGroup[]
  actions: RepoHeaderProjectActions
}): React.JSX.Element {
  // The window unit is the PROJECT: its repoId keys the project-window registry.
  const isOpenInOtherWindow = useAppStore((s) => s.projectKeysInOtherWindows.has(repo.id))
  // Why: this window already owns the project it displays, so "open in new window" is offered
  // only for FREE projects (not this window's active one, not one owned elsewhere).
  const activeWorktreeId = useAppStore((s) => s.activeWorktreeId)
  const isOwnActiveProject =
    activeWorktreeId !== null && projectKeyForWorkspaceKey(activeWorktreeId) === repo.id
  const showOpenInNewWindow = canOpenProjectInNewWindow({
    isOpenInOtherWindow,
    isOwnActiveProject,
    executionHostId: getRepoExecutionHostId(repo)
  })
  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className={REPO_HEADER_ACTION_BUTTON_CLASS}
              data-repo-header-action=""
              aria-label={translate(
                'auto.components.sidebar.WorktreeList.609633a9e6',
                'Project actions for {{value0}}',
                { value0: label }
              )}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={stopRepoHeaderKeyboardToggle}
              onPointerDown={handleRepoHeaderActionPointerDown}
            >
              <Ellipsis className="size-3.5" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {translate('auto.components.sidebar.WorktreeList.2ef41bf9a7', 'Project actions')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        side="bottom"
        sideOffset={6}
        // Why: Radix portals keep React bubbling through the project header; block menu events from arming row drag/collapse.
        onPointerDown={stopRepoHeaderMenuEvent}
        onMouseDown={stopRepoHeaderMenuEvent}
        onPointerUp={stopRepoHeaderMenuEvent}
        onMouseUp={stopRepoHeaderMenuEvent}
        onClick={stopRepoHeaderMenuEvent}
        onKeyDown={stopRepoHeaderMenuEvent}
      >
        {showOpenInNewWindow ? (
          <DropdownMenuItem onSelect={() => void window.api.projectWindow.open(repo.id)}>
            <AppWindow className="size-3.5" />
            {translate(
              'auto.components.sidebar.WorktreeList.openInNewWindow',
              'Open in New Window'
            )}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => actions.onOpenRepoSettings(repo.id)}>
          <SlidersHorizontal className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.2cdffbc728', 'Project Settings')}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => actions.onOpenRepoSettings(repo.id, getRepositoryIconSectionId(repo.id))}
        >
          <Shapes className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.e82d3589a1', 'Change Project Icon')}
        </DropdownMenuItem>
        {isGitRepoKind(repo) ? (
          <DropdownMenuItem onSelect={() => actions.onOpenWorktreeVisibility(repo)}>
            <Eye className="size-3.5" />
            {getWorktreeVisibilityMenuLabel(repo, actions.getWorktreeVisibilityDefaults(repo))}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem onSelect={() => actions.onCreateGroupFromRepo(repo)}>
          <FolderPlus className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.cbfd565f83', 'New group from project')}
        </DropdownMenuItem>
        {projectGroups.length > 0 ? (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput className="size-3.5" />
              {translate('auto.components.sidebar.WorktreeList.4a08fb55f2', 'Move to group')}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {projectGroups.map((group) => (
                <DropdownMenuItem
                  key={group.id}
                  disabled={repo.projectGroupId === group.id}
                  onSelect={() => actions.onMoveProjectToGroup(repo, group.id)}
                >
                  <span className="max-w-48 truncate">{group.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        ) : null}
        {repo.projectGroupId ? (
          <DropdownMenuItem onSelect={() => actions.onRemoveProjectFromGroup(repo)}>
            <CircleX className="size-3.5" />
            {translate('auto.components.sidebar.WorktreeList.64e55f7f01', 'Remove from group')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => actions.onRemoveProject(repo)}>
          <Trash2 className="size-3.5" />
          {translate('auto.components.sidebar.WorktreeList.c83968f87f', 'Remove Project')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function RepoHeaderCreateWorkspaceButton({
  repo,
  label,
  createState,
  onCreateForRepo
}: {
  repo: Repo
  label: string
  createState: ReturnType<typeof getRepoHeaderCreateState> | null
  onCreateForRepo: (projectId: string) => void
}): React.JSX.Element {
  const fallbackLabel = translate(
    'auto.components.sidebar.WorktreeList.bb85cd86ba',
    'Create workspace for {{value0}}',
    { value0: label }
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {createState?.disabled ? (
          <span
            className={cn(
              'inline-flex cursor-not-allowed transition-[margin,max-width,opacity]',
              REPO_HEADER_ACTION_REVEAL_CLASS
            )}
            data-repo-header-action=""
            tabIndex={0}
            aria-label={createState.ariaLabel}
            onKeyDown={stopRepoHeaderKeyboardToggle}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={handleRepoHeaderActionPointerDown}
          >
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="pointer-events-none size-5 shrink-0 rounded-md text-muted-foreground transition-opacity opacity-60"
              aria-label={createState.ariaLabel}
              disabled
            >
              <Plus className="size-3" />
            </Button>
          </span>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={REPO_HEADER_ACTION_BUTTON_CLASS}
            data-repo-header-action=""
            aria-label={createState?.ariaLabel ?? fallbackLabel}
            onKeyDown={stopRepoHeaderKeyboardToggle}
            onPointerDown={handleRepoHeaderActionPointerDown}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onCreateForRepo(repo.id)
            }}
          >
            <Plus className="size-3" />
          </Button>
        )}
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {createState?.tooltip ?? fallbackLabel}
      </TooltipContent>
    </Tooltip>
  )
}
