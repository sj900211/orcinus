import type { PendingSidebarWorktreeReveal } from '@/store/slices/ui'
import type { ActivateOtherWindowGuardOpts } from '@/lib/other-window-activation-guard'
import type { WorktreeStartupPayload } from '@/lib/worktree-startup-payload'
import type { ExecutionHostId } from '../../../shared/execution-host'
import type { WorktreeActivationSurfaceSelection } from './worktree-activation-surface-selection'

// Why its own module: these two option shapes are the fork's — every entry point carries the
// other-window guard — and inlining them kept `worktree-activation.ts` on its `max-lines` cap, where
// an upstream merge breached it.

export type ActivateFolderWorkspaceOptions = ActivateOtherWindowGuardOpts &
  WorktreeActivationSurfaceSelection & {
    sidebarRevealBehavior?: PendingSidebarWorktreeReveal['behavior']
    revealInSidebar?: boolean
    showWorkspaceList?: boolean
    startup?: WorktreeStartupPayload
    runtimeEnvironmentId?: string | null
    executionHostId?: ExecutionHostId
  }

export type ActivateWorkspaceOptions = ActivateOtherWindowGuardOpts &
  WorktreeActivationSurfaceSelection & {
    executionHostId?: ExecutionHostId
    revealInSidebar?: boolean
    showWorkspaceList?: boolean
    /** Worktree-only: folder workspaces are never filter-hidden. */
    clearSidebarFilters?: boolean
  }
