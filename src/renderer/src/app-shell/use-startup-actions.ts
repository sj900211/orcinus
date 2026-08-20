import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '../store'

/** The store actions the one-shot boot chain in use-app-startup-hydration drives. */
export function useStartupActions() {
  // Why: consolidate action refs into one useShallow subscription so React runs one equality check per store mutation instead of one per action.
  return useAppStore(
    useShallow((s) => ({
      fetchReposForAllHosts: s.fetchReposForAllHosts,
      awaitLocalRepoCatalogSettlement: s.awaitLocalRepoCatalogSettlement,
      fetchProjectGroupsForAllHosts: s.fetchProjectGroupsForAllHosts,
      fetchFolderWorkspacesForAllHosts: s.fetchFolderWorkspacesForAllHosts,
      fetchAllWorktrees: s.fetchAllWorktrees,
      fetchWorktrees: s.fetchWorktrees,
      fetchWorktreeLineage: s.fetchWorktreeLineage,
      fetchOrcaProfiles: s.fetchOrcaProfiles,
      fetchSettings: s.fetchSettings,
      awaitOwnerWorktreeVisibilityDefaultsHydration:
        s.awaitOwnerWorktreeVisibilityDefaultsHydration,
      fetchKeybindings: s.fetchKeybindings,
      initGitHubCache: s.initGitHubCache,
      hydrateWorkspaceSession: s.hydrateWorkspaceSession,
      hydrateTabsSession: s.hydrateTabsSession,
      hydrateEditorSession: s.hydrateEditorSession,
      hydrateBrowserSession: s.hydrateBrowserSession,
      fetchBrowserSessionProfiles: s.fetchBrowserSessionProfiles,
      reconnectPersistedTerminals: s.reconnectPersistedTerminals,
      setDeferredSshReconnectTargets: s.setDeferredSshReconnectTargets,
      setSshConnectionState: s.setSshConnectionState,
      hydratePersistedUI: s.hydratePersistedUI,
      setHydrationSucceeded: s.setHydrationSucceeded,
      pruneLastVisitedTimestamps: s.pruneLastVisitedTimestamps,
      seedActiveWorktreeLastVisitedIfMissing: s.seedActiveWorktreeLastVisitedIfMissing
    }))
  )
}
