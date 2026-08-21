import type { AppState } from '@/store/types'
import { useAppStore } from '@/store'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { parseWorkspaceKey } from '../../../shared/workspace-scope'
import { timeRendererStartupStep } from './startup-diagnostics'

type ProjectWorkspaceState = Pick<AppState, 'worktreesByRepo' | 'lastVisitedAtByWorktreeId'>

/**
 * Every workspace key belonging to a project, for project-window-scoped terminal
 * reconnect: a folder workspace is its own single-member project; a git project
 * owns every hydrated worktree of its repoId.
 */
export function collectProjectWorkspaceKeys(
  state: ProjectWorkspaceState,
  projectKey: string
): string[] {
  if (parseWorkspaceKey(projectKey)?.type === 'folder') {
    return [projectKey]
  }
  // Why a Set: multi-host catalogs can list the same worktree id under one repoId.
  return [...new Set((state.worktreesByRepo[projectKey] ?? []).map((worktree) => worktree.id))]
}

/** Reconnect scope for a project-window boot: the project's workspace keys plus the
 *  explicit boot worktree, which the hydrated catalog may still lag. */
export function collectProjectWindowReconnectKeys(
  state: ProjectWorkspaceState,
  bootContext: { projectKey: string; worktreeId?: string }
): string[] {
  const workspaceKeys = collectProjectWorkspaceKeys(state, bootContext.projectKey)
  if (bootContext.worktreeId && !workspaceKeys.includes(bootContext.worktreeId)) {
    workspaceKeys.push(bootContext.worktreeId)
  }
  return workspaceKeys
}

/**
 * The workspace key a project window should activate at boot when no explicit
 * `orca-worktree` was passed: the project's most recently visited worktree
 * (hydrated session visit recency, same source as Cmd+J ordering), else its
 * first hydrated worktree. Null means the project has nothing to activate yet.
 */
export function resolveProjectBootWorkspaceKey(
  state: ProjectWorkspaceState,
  projectKey: string
): string | null {
  const workspaceKeys = collectProjectWorkspaceKeys(state, projectKey)
  if (workspaceKeys.length === 0) {
    return null
  }
  let bestKey: string | null = null
  let bestVisitedAt = 0
  for (const workspaceKey of workspaceKeys) {
    const visitedAt = state.lastVisitedAtByWorktreeId[workspaceKey] ?? 0
    if (visitedAt > bestVisitedAt) {
      bestVisitedAt = visitedAt
      bestKey = workspaceKey
    }
  }
  return bestKey ?? workspaceKeys[0]
}

/** Post-hydration boot activation for a project window: explicit worktree wins, else last-active/first. */
export async function activateProjectWindowBootWorkspace(bootContext: {
  projectKey: string
  worktreeId?: string
}): Promise<void> {
  // Why: a project not referenced by the persisted session hydrates no worktrees; fetch its catalog once.
  if (
    parseWorkspaceKey(bootContext.projectKey)?.type !== 'folder' &&
    collectProjectWorkspaceKeys(useAppStore.getState(), bootContext.projectKey).length === 0
  ) {
    await timeRendererStartupStep('fetch-project-window-worktrees', () =>
      useAppStore.getState().fetchWorktrees(bootContext.projectKey)
    )
  }
  const bootWorkspaceKey =
    bootContext.worktreeId ??
    resolveProjectBootWorkspaceKey(useAppStore.getState(), bootContext.projectKey)
  // Why: same shared activation path as a sidebar click, so repo/view/tab state land consistently.
  const activated = bootWorkspaceKey ? activateAndRevealWorkspace(bootWorkspaceKey) : false
  if (activated === false) {
    console.warn(
      '[startup] Project window has no activatable workspace after hydration; keeping default view:',
      bootContext.projectKey
    )
  }
}
