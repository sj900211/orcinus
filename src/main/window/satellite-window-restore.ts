import type { BrowserWindow } from 'electron'
import type { Store } from '../persistence'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import type { PersistedSatelliteWindowSession } from '../../shared/satellite-window-payloads'
import { getSatellite } from './satellite-window-registry'
import { pushOpenFile } from '../ipc/satellite-push-queue'
import { wireSatelliteWindowLifecycle } from '../ipc/satellite-window-lifecycle'
import { createSatelliteWindow } from './create-satellite-window'

let restoreDone = false

// Restore-at-launch (spec revision 5-7): recreate each persisted satellite via
// the SAME open + push-queue path a live move uses — the boot file opens from
// the URL, every staged file (dirty drafts included) rides queued pushes that
// flush on satelliteWindow:ready, and applyMovedEditorFile merges the boot
// tab's draft. v1 parents everything onto the routed main window: project
// windows are not restored at startup at all, so no original parent can exist
// (recon-verified; D4 no-adoption governed live re-homing, not restore).
export function restoreSatelliteWindows(store: Store, parent: BrowserWindow): void {
  if (restoreDone) {
    return
  }
  restoreDone = true
  for (const session of store.getSatelliteWindowSessions()) {
    // Post-review C7 belt: the repo vanished while the app was closed — a
    // restored window could only boot into an error; prune instead (the
    // renderer bootFailed signal is the backstop for subtler failures).
    const repoId = getRepoIdFromWorktreeId(session.worktreeId)
    if (!store.getRepos().some((repo) => repo.id === repoId)) {
      store.removeSatelliteWindowSession(session.satelliteId)
      continue
    }
    if (session.files.length === 0) {
      store.removeSatelliteWindowSession(session.satelliteId)
      continue
    }
    recreatePersistedSatellite(store, parent, session)
  }
}

function recreatePersistedSatellite(
  store: Store,
  parent: BrowserWindow,
  session: PersistedSatelliteWindowSession
): void {
  const [bootFile] = session.files
  const { satelliteId, window } = createSatelliteWindow(
    parent,
    session.worktreeId,
    {
      filePath: bootFile.filePath,
      relativePath: bootFile.relativePath,
      language: bootFile.language
    },
    {
      ...(session.bounds ? { initialBounds: session.bounds } : {}),
      startSubordinationHidden: true
    }
  )
  wireSatelliteWindowLifecycle(window, satelliteId, store)
  // Re-key the persisted entry under the NEW satelliteId immediately — a
  // crash before the renderer's first stage must not lose the files.
  store.removeSatelliteWindowSession(session.satelliteId)
  store.setSatelliteWindowSession({
    satelliteId,
    worktreeId: session.worktreeId,
    files: session.files,
    ...(session.bounds ? { bounds: session.bounds } : {})
  })
  // Every staged file rides the push queue; the boot file's push merges its
  // draft/cursor into the boot-opened clean tab (reuse branch).
  for (const file of session.files) {
    pushOpenFile(satelliteId, file)
  }
}

/** Aborted quit (post-review C6): satellites destroyed by the quit sweep stay
 *  dead while the app lives on — recreate every persisted entry whose window
 *  is no longer in the registry, using the same path as launch restore. */
export function restoreMissingSatelliteWindows(store: Store, parent: BrowserWindow): void {
  for (const session of store.getSatelliteWindowSessions()) {
    if (getSatellite(session.satelliteId)) {
      continue
    }
    if (session.files.length === 0) {
      store.removeSatelliteWindowSession(session.satelliteId)
      continue
    }
    recreatePersistedSatellite(store, parent, session)
  }
}
