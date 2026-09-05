import type { PersistedSatelliteWindowSession } from '../../../shared/satellite-window-payloads'
import type { StoreRuntimeState } from './store-runtime-state'
import type { WriteSchedulingOperations } from './write-scheduling'
import { scheduleSave } from './write-scheduling'

type SatelliteWindowSessionRuntime = Pick<StoreRuntimeState, 'state'>

const satelliteWindowSessionPersistenceContext = Symbol('SatelliteWindowSessionPersistence')
type SatelliteWindowSessionPersistenceContext = {
  runtime: SatelliteWindowSessionRuntime
  scheduling: WriteSchedulingOperations
}

/** Satellite windows to restore at launch (5-7). Staged continuously by each
 *  satellite renderer; entries are removed only on a clean user close of a
 *  READY satellite (every other death keeps the entry for restore). */
export class SatelliteWindowSessionPersistence {
  readonly [satelliteWindowSessionPersistenceContext]: SatelliteWindowSessionPersistenceContext

  constructor(runtime: SatelliteWindowSessionRuntime, scheduling: WriteSchedulingOperations) {
    this[satelliteWindowSessionPersistenceContext] = { runtime, scheduling }
  }

  getSatelliteWindowSessions(): PersistedSatelliteWindowSession[] {
    return (
      this[satelliteWindowSessionPersistenceContext].runtime.state.satelliteWindowSessions ?? []
    )
  }

  setSatelliteWindowSession(entry: PersistedSatelliteWindowSession): void {
    const context = this[satelliteWindowSessionPersistenceContext]
    const rest = (context.runtime.state.satelliteWindowSessions ?? []).filter(
      (candidate) => candidate.satelliteId !== entry.satelliteId
    )
    context.runtime.state.satelliteWindowSessions = [...rest, entry]
    scheduleSave(context.scheduling)
  }

  removeSatelliteWindowSession(satelliteId: string): void {
    const context = this[satelliteWindowSessionPersistenceContext]
    const current = context.runtime.state.satelliteWindowSessions ?? []
    const next = current.filter((candidate) => candidate.satelliteId !== satelliteId)
    if (next.length !== current.length) {
      context.runtime.state.satelliteWindowSessions = next
      scheduleSave(context.scheduling)
    }
  }

  removeSatelliteWindowSessionsForWorktree(worktreeId: string): void {
    const context = this[satelliteWindowSessionPersistenceContext]
    removeSatelliteWindowSessionsForWorktreeFromState(
      context.runtime,
      context.scheduling,
      worktreeId
    )
  }
}

/** Shared with the session-owner removal path: a removed worktree must not
 *  resurrect as a restored satellite (5-7). */
export function removeSatelliteWindowSessionsForWorktreeFromState(
  runtime: SatelliteWindowSessionRuntime,
  scheduling: WriteSchedulingOperations,
  worktreeId: string
): void {
  const current = runtime.state.satelliteWindowSessions ?? []
  const next = current.filter((candidate) => candidate.worktreeId !== worktreeId)
  if (next.length !== current.length) {
    runtime.state.satelliteWindowSessions = next
    scheduleSave(scheduling)
  }
}

export function installSatelliteWindowSessionPersistenceContext(
  target: object,
  source: SatelliteWindowSessionPersistence
): void {
  Object.defineProperty(target, satelliteWindowSessionPersistenceContext, {
    value: source[satelliteWindowSessionPersistenceContext]
  })
}
