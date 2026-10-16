import { useMemo } from 'react'
import { useAppStore } from '@/store'
import type { Repo } from '../../../../../../shared/repo-types'
import type { Worktree } from '../../../../../../shared/worktree/types'
import type { WorktreeGroupBy } from '../grouping/row-types'
import { getEmptyProjectPlaceholderRepoIds } from '../../empty-project-placeholder-repos'

// Why its own module: the fork reads `projectKeysInOtherWindows` here so a project windowed
// elsewhere keeps its header without its rows. Adding that one input to the memo's dependency
// array made the formatter expand the array, and the extra lines pushed `use-section-rows.ts`
// past `max-lines` on an upstream merge even though neither side breached it alone.
export function usePlaceholderRepoIds(args: {
  groupBy: WorktreeGroupBy
  visibleReposForRows: readonly Repo[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
  visibleWorktrees: readonly Worktree[]
  filterRepoIds: readonly string[]
}): Set<string> {
  const projectKeysInOtherWindows = useAppStore((s) => s.projectKeysInOtherWindows)
  const { groupBy, visibleReposForRows, worktreesByRepo, visibleWorktrees, filterRepoIds } = args
  return useMemo(
    () =>
      getEmptyProjectPlaceholderRepoIds({
        groupBy,
        repos: visibleReposForRows,
        worktreesByRepo,
        visibleWorktrees,
        filterRepoIds,
        projectKeysInOtherWindows
      }),
    [
      filterRepoIds,
      groupBy,
      visibleReposForRows,
      visibleWorktrees,
      worktreesByRepo,
      projectKeysInOtherWindows
    ]
  )
}
