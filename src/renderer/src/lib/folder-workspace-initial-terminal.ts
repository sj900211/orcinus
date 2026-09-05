import type { FolderWorkspace } from '../../../shared/folder-workspace-types'
import { folderWorkspaceKey } from '../../../shared/workspace-scope'
import { useAppStore } from '@/store'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import { ensureWorktreeHasInitialTerminal } from '@/lib/worktree-initial-terminal-seeding'

/** Folder-workspace variant of the initial-terminal seeding used by activation. */
export function ensureFolderWorkspaceInitialTerminal(
  folderWorkspace: FolderWorkspace,
  startup?: WorktreeStartupPayload,
  providesInitialSurface?: boolean
): string | null {
  if (providesInitialSurface === true && startup === undefined) {
    return null
  }
  const state = useAppStore.getState()
  const workspaceKey = folderWorkspaceKey(folderWorkspace.id)
  const primaryTabId = ensureWorktreeHasInitialTerminal(
    state,
    workspaceKey,
    startup,
    undefined,
    undefined,
    undefined,
    { reseedEmptiedWorkspace: providesInitialSurface !== true }
  )
  return primaryTabId
}
