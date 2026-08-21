import type { Repo } from '../../../../shared/repo-types'
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorktreeGroupBy } from './worktree-list/grouping/row-types'

export function getEmptyProjectPlaceholderRepoIds(args: {
  groupBy: WorktreeGroupBy
  repos: readonly Repo[]
  worktreesByRepo: Readonly<Record<string, readonly Worktree[] | undefined>>
  visibleWorktrees: readonly Worktree[]
  filterRepoIds: readonly string[]
  // A repo's project key is its repoId; when windowed elsewhere its rows are hidden but its header must stay.
  projectKeysInOtherWindows?: ReadonlySet<string>
}): Set<string> {
  if (args.groupBy !== 'repo') {
    return new Set()
  }

  const filterSet = args.filterRepoIds.length > 0 ? new Set(args.filterRepoIds) : null
  const visibleRepoIds = new Set(args.visibleWorktrees.map((worktree) => worktree.repoId))
  const placeholderRepoIds = new Set<string>()
  for (const repo of args.repos) {
    if (filterSet && !filterSet.has(repo.id)) {
      continue
    }
    const hasNoWorktrees = (args.worktreesByRepo[repo.id]?.length ?? 0) === 0
    // Why: workspace filters hide cards, but must not rewrite the visible
    // membership of a persisted Project Group. #8865
    const isFilteredProjectGroupMember = repo.projectGroupId != null && !visibleRepoIds.has(repo.id)
    // Why: a project windowed elsewhere has its rows hidden here, but stays a header-only marker.
    const isWindowedElsewhere = args.projectKeysInOtherWindows?.has(repo.id) ?? false
    if (hasNoWorktrees || isFilteredProjectGroupMember || isWindowedElsewhere) {
      placeholderRepoIds.add(repo.id)
    }
  }
  return placeholderRepoIds
}
