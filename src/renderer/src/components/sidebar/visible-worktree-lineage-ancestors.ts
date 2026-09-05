// Split from visible-worktrees.ts for the max-lines rule: the ancestor-closure
// walk that keeps a filtered child's valid lineage rendered.
import type { Worktree } from '../../../../shared/worktree/types'
import type { WorktreeLineage } from '../../../../shared/worktree/lineage-types'
import { getWorktreeHostIdentity } from '../../../../shared/worktree/host-qualified-identity'
import {
  getCyclicProjectedWorktreeLineageIds,
  getLineageRenderInfo
} from './worktree-lineage-projection'

export function addVisibleLineageAncestors(
  worktrees: Worktree[],
  worktreeById: Map<string, Worktree>,
  lineageById: Record<string, WorktreeLineage>
): Worktree[] {
  const result: Worktree[] = []
  const included = new Set<string>()
  const visiting = new Set<string>()
  const cyclicLineageIds = getCyclicProjectedWorktreeLineageIds(lineageById, worktreeById)

  const addWithAncestors = (worktree: Worktree): void => {
    const identity = getWorktreeHostIdentity(worktree)
    if (included.has(identity) || visiting.has(identity)) {
      return
    }
    visiting.add(identity)
    const lineage = getLineageRenderInfo(worktree, lineageById, worktreeById, cyclicLineageIds)
    if (lineage.state === 'valid') {
      // Why: sidebar lineage is structural. If a filtered child is visible,
      // its valid parent must be rendered too so the hierarchy remains legible.
      addWithAncestors(lineage.parent)
    }
    visiting.delete(identity)
    if (!included.has(identity)) {
      included.add(identity)
      result.push(worktree)
    }
  }

  for (const worktree of worktrees) {
    addWithAncestors(worktree)
  }
  return result
}
