import { useAppStore } from '../store'
import { buildActiveViewUnloadPatch } from '../lib/active-view-persist'
import { isIntentionalAppRestartInProgress } from '../lib/updater-beforeunload'
import {
  buildWorkspaceSessionPayload,
  shouldPersistWorkspaceSession
} from '../lib/workspace-session'
import { buildWorkspaceSessionHostSnapshots } from '../lib/workspace-session-host-persistence'
import { shutdownBufferCaptures } from '../components/terminal-pane/shutdown-buffer-captures'

/**
 * Serialize the full renderer session (scrollback captures, sleeping-agent
 * records, host snapshots, active view) and stage it in main synchronously.
 * Runs main's on-demand checkpoint request before a workspace window opens
 * ('periodic'); the beforeunload 'quit' path runs the degradable persist below.
 */
export function stageWorkspaceSessionCheckpoint(captureMode: 'periodic' | 'quit'): void {
  const shouldCaptureSession = shouldPersistWorkspaceSession(useAppStore.getState())
  if (shouldCaptureSession) {
    for (const capture of shutdownBufferCaptures.values()) {
      try {
        capture({ includeLocalBuffers: false })
      } catch {
        // Don't let one pane's failure block the rest.
      }
    }
    // Why: agent provider session ids live only in agentStatusByPaneKey,
    // which is in-memory. Capture them into the persisted sleeping-session
    // map so a daemon/session death while the app is closed can still
    // cold-restore via the agent's resume command (#5232).
    useAppStore.getState().captureAllSleepingAgentSessions(captureMode)
  }
  // Why: re-read state after capture() calls populated scrollback buffers
  // into the store via Zustand setters. The earlier read is only for the
  // gating flags and would miss those updates.
  const freshState = useAppStore.getState()
  let sessionSnapshots: ReturnType<typeof buildWorkspaceSessionHostSnapshots> = []
  try {
    sessionSnapshots = shouldCaptureSession
      ? buildWorkspaceSessionHostSnapshots(buildWorkspaceSessionPayload(freshState), freshState)
      : []
  } catch (error) {
    // Why: dirty drafts exist only in the full session snapshot.
    if (!isIntentionalAppRestartInProgress() || freshState.openFiles.some((file) => file.isDirty)) {
      throw error
    }
    console.error('[app] Full renderer session snapshot failed; using durable session', error)
    window.api.app.stageBeforeUnloadSync({
      sessions: [],
      ui: buildActiveViewUnloadPatch(freshState)
    })
    return
  }
  window.api.app.stageBeforeUnloadSync({
    sessions: sessionSnapshots,
    ui: buildActiveViewUnloadPatch(freshState)
  })
}
