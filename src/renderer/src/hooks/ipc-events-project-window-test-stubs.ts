// Split from ipc-events-test-harness.ts for the max-lines rule: the fork's project-window and
// satellite-window preload stubs that useIpcEvents reaches through app-lifetime-ipc-bridge.

type OpenProjectsChangedListener = (projectKeys: string[]) => void

/** Overrides for the fork's window namespaces, plus the open-projects push a suite fires. */
export function createProjectWindowApiStubs(): {
  projectWindow: Record<string, unknown>
  satelliteWindow: Record<string, unknown>
  openProjectsChanged: OpenProjectsChangedListener
} {
  let openProjectsChangedListener: OpenProjectsChangedListener | null = null
  return {
    projectWindow: {
      onOpenProjectsChanged: (listener: OpenProjectsChangedListener) => {
        openProjectsChangedListener = listener
        return () => {}
      }
    },
    // Why: the mirror hydration awaits getMirror, so the default function stub would throw.
    satelliteWindow: { getMirror: () => Promise.resolve(null) },
    openProjectsChanged: (projectKeys) => {
      if (typeof openProjectsChangedListener !== 'function') {
        throw new Error('Expected the open-projects-changed listener to be registered')
      }
      openProjectsChangedListener(projectKeys)
    }
  }
}
