import { getTabIdsAwaitingHostHydrationRemount } from '@/lib/parked-terminal-host-hydration'
import { emitAutomationsChangedWindowEvent } from '@/lib/automations-changed-window-event'
import { applySatelliteReturnedFiles } from '@/lib/satellite-editor-file-move'
import { createBackgroundSleepingAgentWakeDispatcher } from '@/lib/wake-sleeping-agents-in-background'
import { attachMobileMarkdownBridge } from '@/runtime/mobile-markdown-bridge'
import { resetAgentHookCompletionNotificationCoordinators } from '../agent-hook-completion-notifications'
import { useAppStore } from '../../store'
import { registerAgentStatusIpcBridge } from './agent-status-ipc-bridge'
import { registerBrowserRequestIpcBridge } from './browser-request-ipc-bridge'
import { registerBrowserStateIpcBridge } from './browser-state-ipc-bridge'
import { registerContentCreationIpcBridge } from './content-creation-ipc-bridge'
import { createDirectSshBridgeRuntime } from './direct-ssh-bridge-runtime'
import { registerDirectSshStateIpcBridge } from './direct-ssh-state-ipc-bridge'
import { registerMobileAndTerminalCloseIpcBridge } from './mobile-terminal-close-ipc-bridge'
import { registerMobileDriverIpcBridge } from './mobile-driver-ipc-bridge'
import { registerOrcaProfileAuthIpcBridge } from './orca-profile-auth-ipc-bridge'
import { registerOsMarkdownFileOpenBridge } from './os-markdown-file-open-bridge'
import { registerProjectCatalogIpcBridge } from './project-catalog-ipc-bridge'
import { registerRateLimitIpcBridge } from './rate-limit-ipc-bridge'
import { registerRemoteWorkspaceIpcBridge } from './remote-workspace-ipc-bridge'
import { registerRuntimeClientIpcBridge } from './runtime-client-ipc-bridge'
import { registerSessionTabIpcBridge } from './session-tab-ipc-bridge'
import { registerSettingsAndSidebarIpcBridge } from './settings-sidebar-ipc-bridge'
import { registerTabLifecycleIpcBridge } from './tab-lifecycle-ipc-bridge'
import { registerTerminalPresentationIpcBridge } from './terminal-presentation-ipc-bridge'
import { registerPtySourceDisownedIpcBridge } from './pty-source-disowned-ipc-bridge'
import { registerTerminalRequestIpcBridge } from './terminal-request-ipc-bridge'
import { registerTerminalUiRoutingIpcBridge } from './terminal-ui-routing-ipc-bridge'
import { registerUpdaterStatusIpcBridge } from './updater-status-ipc-bridge'
import { createWorktreeEventRuntime } from './worktree-event-runtime'
import { registerWorkspaceShortcutIpcBridge } from './workspace-shortcut-ipc-bridge'
import { registerZoomIpcBridge } from './zoom-ipc-bridge'

function isRuntimeEnvironmentActive(): boolean {
  return Boolean(useAppStore.getState().settings?.activeRuntimeEnvironmentId?.trim())
}

function remountTerminalTabsAwaitingHostHydration(): void {
  const store = useAppStore.getState()
  for (const tabId of getTabIdsAwaitingHostHydrationRemount(store)) {
    store.remountTerminalTabForRecovery(tabId)
  }
}

export type IpcEventsCleanupPhase =
  | 'agent.disposeAsyncState'
  | 'mobile.disposeHydration'
  | 'runtimeStore.unsubscribe'
  | 'agentStore.unsubscribe'
  | 'ipc.dispose'
  | 'directSsh.stop'
  | 'notifications.reset'

export function installAppLifetimeIpcEvents(
  onCleanupPhase?: (phase: IpcEventsCleanupPhase) => void
): () => void {
  const unsubs: (() => void)[] = []
  const directSshRuntime = createDirectSshBridgeRuntime()
  const backgroundWakeDispatcher = createBackgroundSleepingAgentWakeDispatcher()
  unsubs.push(backgroundWakeDispatcher.dispose)
  unsubs.push(attachMobileMarkdownBridge())
  unsubs.push(
    window.api.automations.onChanged((payload) => emitAutomationsChangedWindowEvent(payload))
  )

  const worktreeRuntime = createWorktreeEventRuntime(unsubs, isRuntimeEnvironmentActive)
  const onSharedControlDiagnostics = window.api.runtimeEnvironments?.onSharedControlDiagnostics
  if (onSharedControlDiagnostics) {
    unsubs.push(
      onSharedControlDiagnostics((event) => {
        useAppStore.getState().publishRuntimeEnvironmentDiagnostics(event)
      })
    )
  }
  const unsubscribeRuntimeEnvironmentStore = registerRuntimeClientIpcBridge(unsubs, worktreeRuntime)
  registerProjectCatalogIpcBridge(
    unsubs,
    worktreeRuntime.worktreeChangeRefreshQueue,
    isRuntimeEnvironmentActive,
    remountTerminalTabsAwaitingHostHydration
  )
  registerSettingsAndSidebarIpcBridge(unsubs)
  registerOrcaProfileAuthIpcBridge(unsubs)
  registerWorkspaceShortcutIpcBridge(unsubs)
  registerOsMarkdownFileOpenBridge(unsubs)

  // Why ?.: additive API — older preloads/web fallback and partial test harnesses may lack it.
  const unsubscribeOpenProjectsChanged = window.api.projectWindow?.onOpenProjectsChanged?.(
    (projectKeys) => {
      // Main tailors the payload per recipient, so this list is exactly "open in OTHER windows".
      useAppStore.getState().setProjectKeysInOtherWindows(projectKeys)
    }
  )
  if (unsubscribeOpenProjectsChanged) {
    unsubs.push(unsubscribeOpenProjectsChanged)
  }

  // Why ?.: additive API. The per-window satellite mirror drives the openFile
  // interception gate and menu gating (dungeon 5); satellites never receive it.
  const unsubscribeSatelliteMirror = window.api.satelliteWindow?.onMirrorChanged?.((entries) => {
    useAppStore.getState().setSatelliteMirror(entries)
  })
  if (unsubscribeSatelliteMirror) {
    unsubs.push(unsubscribeSatelliteMirror)
    // Why a snapshot fetch: the mirror is change-driven and main's
    // did-finish-load re-broadcast lands before this subscription mounts —
    // without this a reloaded window intercepts nothing until the next change.
    void window.api.satelliteWindow
      .getMirror?.()
      .then((entries) => {
        if (entries) {
          useAppStore.getState().setSatelliteMirror(entries)
        }
      })
      .catch(() => undefined)
  }
  const unsubscribeFilesMovedBack = window.api.satelliteWindow?.onFilesMovedBack?.((data) => {
    applySatelliteReturnedFiles(data)
  })
  if (unsubscribeFilesMovedBack) {
    unsubs.push(unsubscribeFilesMovedBack)
  }
  unsubs.push(
    window.api.ui.onActivateWorktree(({ repoId, worktreeId, setup, startup, defaultTabs }) => {
      void worktreeRuntime
        .activateNotifiedWorktree(
          {
            type: 'activateWorktree',
            repoId,
            worktreeId,
            ...(setup ? { setup } : {}),
            ...(startup ? { startup } : {}),
            ...(defaultTabs ? { defaultTabs } : {})
          },
          { allowRuntimeEnvironment: false }
        )
        .catch((error) => console.error('Failed to activate CLI-created worktree:', error))
    })
  )

  registerTerminalPresentationIpcBridge(unsubs)
  registerTerminalRequestIpcBridge(unsubs)
  registerPtySourceDisownedIpcBridge(unsubs)
  registerTerminalUiRoutingIpcBridge(unsubs)
  registerSessionTabIpcBridge(unsubs)
  registerMobileAndTerminalCloseIpcBridge(unsubs, backgroundWakeDispatcher.request)
  registerUpdaterStatusIpcBridge(unsubs)
  registerBrowserStateIpcBridge(unsubs, isRuntimeEnvironmentActive)
  registerContentCreationIpcBridge(unsubs, isRuntimeEnvironmentActive)
  registerBrowserRequestIpcBridge(unsubs, isRuntimeEnvironmentActive)
  registerTabLifecycleIpcBridge(unsubs)
  registerRateLimitIpcBridge(unsubs)
  registerDirectSshStateIpcBridge(unsubs, directSshRuntime)
  registerRemoteWorkspaceIpcBridge(unsubs, directSshRuntime)
  registerZoomIpcBridge(unsubs)
  const agentStatusBridge = registerAgentStatusIpcBridge(unsubs)
  const disposeMobileDriverHydration = registerMobileDriverIpcBridge(
    unsubs,
    isRuntimeEnvironmentActive
  )

  return () => {
    agentStatusBridge.disposeAsyncState()
    onCleanupPhase?.('agent.disposeAsyncState')
    disposeMobileDriverHydration()
    onCleanupPhase?.('mobile.disposeHydration')
    unsubscribeRuntimeEnvironmentStore()
    onCleanupPhase?.('runtimeStore.unsubscribe')
    agentStatusBridge.unsubscribeStore()
    onCleanupPhase?.('agentStore.unsubscribe')
    unsubs.forEach((unsubscribe) => unsubscribe())
    onCleanupPhase?.('ipc.dispose')
    directSshRuntime.stop()
    onCleanupPhase?.('directSsh.stop')
    resetAgentHookCompletionNotificationCoordinators()
    onCleanupPhase?.('notifications.reset')
  }
}
