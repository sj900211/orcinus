import type { ProjectWindowSessionHandback } from '../../../shared/project-window-session-handback'
import { getWindowBootContext } from '../startup/window-boot-context'
import { collectProjectWorkspaceKeys } from '../startup/project-window-boot-workspace'
import { useAppStore } from '../store'
import { buildWorkspaceSessionPayload } from './workspace-session'

/**
 * A closing project (role 'workspace') window is not a persistence writer, so its
 * live tabs would vanish. On beforeunload it hands its project's session slice to the
 * MAIN window (the single writer) through main, which merges + persists it. The
 * handback carries daemon/remote session ids so main's reattach finds the live PTYs.
 *
 * No-op for the main window and for a project window whose own catalog never hydrated
 * (nothing meaningful to hand back yet).
 */
export function stageProjectWindowSessionHandback(): void {
  const bootContext = getWindowBootContext()
  if (bootContext.role !== 'workspace') {
    return
  }
  const state = useAppStore.getState()
  const workspaceKeys = collectProjectWorkspaceKeys(state, bootContext.projectKey)
  if (workspaceKeys.length === 0) {
    return
  }
  let handback: ProjectWindowSessionHandback
  try {
    handback = {
      projectKey: bootContext.projectKey,
      workspaceKeys,
      session: buildWorkspaceSessionPayload(state)
    }
  } catch (error) {
    console.error(
      '[app] Project window session handback build failed; terminals may not persist',
      error
    )
    return
  }
  window.api.session.handbackProjectSessionSync?.(handback)
}
