// Split from use-app-startup-hydration.ts for the max-lines rule: the
// window-role-branched SSH restore + terminal reconnect section, verbatim.
import { useAppStore } from '../store'
import {
  logRendererStartupDiagnostic,
  timeRendererStartupStep
} from '../startup/startup-diagnostics'
import { restoreSshConnectionsForStartup } from '../startup/startup-ssh-connection-restore'
import { collectActiveWorkspaceSshTargetIds } from '../startup/active-workspace-ssh-targets'
import { collectProjectWindowReconnectKeys } from '../startup/project-window-boot-workspace'
import {
  collectTerminalProviderSnapshotPtyIds,
  refreshTerminalProviderSnapshotCapabilities
} from '../components/terminal/terminal-provider-snapshot-capability'
import { isRuntimeOwnedSshTargetId } from '../../../shared/execution-host'
import { restoreLocalStructuredSessionTabsOnce } from '../runtime/local-structured-session-tabs-sync'
import { sweepRestoredCodexPanesForStaleAccounts } from '../lib/codex-stale-pane-sweep'
import type { WindowBootContext } from '../startup/window-boot-context'
import type { useStartupActions } from './use-app-startup-actions'

type StartupActions = ReturnType<typeof useStartupActions>

type StartupReconnectArgs = {
  actions: Pick<
    StartupActions,
    | 'setDeferredSshReconnectTargets'
    | 'removeDeferredSshReconnectTarget'
    | 'setSshConnectionState'
    | 'reconnectPersistedTerminals'
  >
  activeConnectionIdsAtShutdown: string[] | undefined
  bootContext: WindowBootContext
  isCancelled: () => boolean
  signal: AbortSignal
}

export async function runStartupReconnectForWindowRole(
  args: StartupReconnectArgs
): Promise<{ status: 'done' | 'cancelled'; reconnectStarted: boolean }> {
  let reconnectStarted = false
  const bootContext = args.bootContext
  // Why: workspace windows own no SSH connections — dialing here would fight the main
  // window over live sessions. Their terminal reconnect runs scoped to the boot worktree
  // below so the main window keeps owning every other worktree's restore.
  if (bootContext.role === 'main') {
    // Why: re-establish SSH before terminal reconnect so SSH-backed tabs route through pty.attach; passphrase targets defer to tab focus to avoid stacked credential dialogs.
    // Why: never dial runtime-owned (ephemeral-VM) targets from the renderer — ssh.connect would dispose the runtime layer's live relay session; filter them out here too.
    const connectionIds = (args.activeConnectionIdsAtShutdown ?? []).filter(
      (targetId) => !isRuntimeOwnedSshTargetId(targetId)
    )
    if (connectionIds.length > 0) {
      try {
        // Why scoped: an unreachable host used to hold every restored terminal — local ones
        // included — for the full reconnect timeout. Only the targets whose panes mount as
        // soon as the gate opens are worth waiting for; the rest reattach on tab focus.
        const blockingConnectionIds = collectActiveWorkspaceSshTargetIds(useAppStore.getState())
        await restoreSshConnectionsForStartup({
          connectionIds,
          blockingConnectionIds,
          setDeferredSshReconnectTargets: args.actions.setDeferredSshReconnectTargets,
          removeDeferredSshReconnectTarget: args.actions.removeDeferredSshReconnectTarget,
          publishSshConnectionState: args.actions.setSshConnectionState
        })
      } catch (err) {
        console.warn('SSH startup reconnect failed:', err)
      }
    } else {
      logRendererStartupDiagnostic('ssh-reconnect-skipped', { connectionIds: 0 })
    }

    // Why no explicit barrier here: prepare-terminal-startup-restoration above already awaited
    // the first-window services, and main re-awaits them inside this handler anyway.
    await timeRendererStartupStep('recover-legacy-worker-terminals-pre-reconnect', () =>
      window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
    )
    await timeRendererStartupStep('terminal-provider-snapshot-capabilities', () => {
      return refreshTerminalProviderSnapshotCapabilities(
        collectTerminalProviderSnapshotPtyIds(useAppStore.getState())
      )
    })
    reconnectStarted = true
    await timeRendererStartupStep('reconnect-terminals', () =>
      args.actions.reconnectPersistedTerminals(args.signal)
    )
    await timeRendererStartupStep('recover-legacy-worker-terminals-post-reconnect', () =>
      window.api.app.recoverLegacyWorkerTerminalsForRendererStartup()
    )
    if (useAppStore.getState().settings?.experimentalStructuredNativeChat === true) {
      await timeRendererStartupStep('project-structured-session-tabs', () =>
        restoreLocalStructuredSessionTabsOnce()
      )
    }
    if (args.isCancelled()) {
      return { status: 'cancelled', reconnectStarted }
    }
    // Why here: reconnect just published restored PTY ids; sweeping them now
    // re-offers stale Codex panes whose tabs never mount this session.
    sweepRestoredCodexPanesForStaleAccounts(useAppStore.getState())
  } else {
    await timeRendererStartupStep('terminal-provider-snapshot-capabilities', () => {
      return refreshTerminalProviderSnapshotCapabilities(
        collectTerminalProviderSnapshotPtyIds(useAppStore.getState())
      )
    })
    reconnectStarted = true
    // Why scoped: this window streams only its own project's PTYs; SSH-backed tabs it
    // cannot dial stay deferred (placeholder panes) instead of erroring.
    await timeRendererStartupStep('reconnect-terminals', () =>
      args.actions.reconnectPersistedTerminals(args.signal, {
        workspaceKeys: collectProjectWindowReconnectKeys(useAppStore.getState(), bootContext)
      })
    )
    if (args.isCancelled()) {
      return { status: 'cancelled', reconnectStarted }
    }
    // Why: the workbench mounts behind workspaceSessionReady && (hydrationSucceeded ||
    // startupWorktreeRefreshCompleted); flip the mount inputs while hydrationSucceeded
    // stays false so canPersistWorkspaceSession keeps this window's session writer locked.
    useAppStore.setState({
      workspaceSessionReady: true,
      startupWorktreeRefreshCompleted: true
    })
  }
  return { status: 'done', reconnectStarted }
}
