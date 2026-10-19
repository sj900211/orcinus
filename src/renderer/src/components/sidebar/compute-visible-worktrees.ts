import type { Repo } from '../../../../shared/repo-types'
import type { TerminalTab } from '../../../../shared/terminal-tab-types'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { ExecutionHostId, ExecutionHostScope } from '../../../../shared/execution-host'
import { getIndexedAllWorktrees } from '@/store/worktree-repo-index'
import { selectVisibleSidebarWorktrees } from '../../../../shared/sidebar-list/visible-worktrees'
import { buildDesktopWorkspaceRowFactReader } from './desktop-workspace-row-facts'
import { sidebarWorkspaceRowFilters } from './sidebar-filter-actions'
import { getLineageAncestorIndex, getSortedWorktreeRankIndex } from './visible-worktree-indexes'
import { parseWorkspaceKey } from '../../../../shared/workspace-scope'

// Why its own module: the store's attention slice asks it without an import cycle. The filter
// rules live in the shared builder; this binds them to the window's store index and activity facts.

export type VisibleWorktreeOptions = {
  filterRepoIds: readonly string[]
  showSleepingWorkspaces: boolean
  tabsByWorktree: Record<string, Pick<TerminalTab, 'id'>[]> | null
  ptyIdsByTabId: Record<string, string[]> | null
  browserTabsByWorktree?: Record<string, { id: string }[]> | null
  worktreeIdsWithLiveAgent: ReadonlySet<string>
  worktreeIdsWithStructuredChat?: ReadonlySet<string>
  hideDefaultBranchWorkspace: boolean
  hideAutomationGeneratedWorkspaces: boolean
  hideCliCreatedWorkspaces: boolean
  hideDetachedHeadWorkspaces: boolean
  hideWorkspacesFromOtherDevices: boolean
  pairedDeviceIdsByEnvironment: ReadonlyMap<string, string>
  alwaysShowDefaultBranchWorkspace?: boolean
  repoMap: Map<string, Repo>
  workspaceHostScope: ExecutionHostScope
  visibleWorkspaceHostIds?: readonly ExecutionHostId[] | null
  defaultHostId: ExecutionHostId
  worktreeLineageById: Record<string, WorktreeLineage>
  injectLineageAncestors?: boolean
  preserveLineageParentOrder?: boolean
  forcedVisibleWorktreeIds?: readonly string[]
  /** Exempt from the sleeping sweep only; unlike forcedVisibleWorktreeIds, every other filter still applies. */
  sleepingSweepExemptWorktreeIds?: ReadonlySet<string>
  // Project keys (repoId / `folder:` key) windowed elsewhere: their rows hide here so the owning window is the only place they activate.
  projectKeysInOtherWindows?: ReadonlySet<string>
}

export function computeVisibleWorktrees(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedIds: string[],
  opts: VisibleWorktreeOptions
): Worktree[] {
  let rows: Worktree[] = getIndexedAllWorktrees(worktreesByRepo)

  // Why: a project windowed elsewhere only shows its rows in its own window; here it stays a header-only marker (the section header is emitted even with zero rows).
  // Why before the shared builder: its filterWorkspaceRows rule set is shared with mobile (#28986), and
  // "windowed in another desktop window" is a concept mobile has no equivalent of.
  if (opts.projectKeysInOtherWindows && opts.projectKeysInOtherWindows.size > 0) {
    const projectKeysInOtherWindows = opts.projectKeysInOtherWindows
    rows = rows.filter((w) => {
      // Synthetic folder rows are their own single-member project; git worktrees carry their repoId.
      const projectKey = parseWorkspaceKey(w.id)?.type === 'folder' ? w.id : w.repoId
      return !projectKeysInOtherWindows.has(projectKey)
    })
  }

  return selectVisibleSidebarWorktrees({
    rows,
    ancestorById: getLineageAncestorIndex(worktreesByRepo),
    rankById: getSortedWorktreeRankIndex(sortedIds),
    filters: sidebarWorkspaceRowFilters(opts),
    facts: buildDesktopWorkspaceRowFactReader(opts),
    worktreeLineageById: opts.worktreeLineageById,
    filterRepoIds: opts.filterRepoIds,
    injectLineageAncestors: opts.injectLineageAncestors,
    preserveLineageParentOrder: opts.preserveLineageParentOrder,
    forcedVisibleWorktreeIds: opts.forcedVisibleWorktreeIds
  })
}

export function computeVisibleWorktreeIds(
  worktreesByRepo: Record<string, Worktree[]>,
  sortedIds: string[],
  opts: VisibleWorktreeOptions
): string[] {
  return computeVisibleWorktrees(worktreesByRepo, sortedIds, opts).map((worktree) => worktree.id)
}
