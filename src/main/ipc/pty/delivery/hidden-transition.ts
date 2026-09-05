import {
  markHiddenRendererPtyForOwner,
  shouldDropHiddenRendererPtyDataForOwner,
  unmarkHiddenRendererPtyForOwner
} from '../pty-owner-gate'
import { invalidatePendingPtyDrainPolicy } from './visibility-state'
import type { PtyIpcSession } from '../session'

export function transitionHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean
): { droppable: boolean; droppedWhileHidden: boolean; policyChanged: boolean } {
  const settings = session.getSettings?.()
  const wasDroppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  let droppedWhileHidden = false
  if (hidden) {
    markHiddenRendererPtyForOwner(id)
  } else {
    droppedWhileHidden = unmarkHiddenRendererPtyForOwner(id).droppedWhileHidden
  }
  const droppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  return { droppable, droppedWhileHidden, policyChanged: wasDroppable !== droppable }
}

export function transitionSpawnHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean
): void {
  const transition = transitionHiddenRendererPtyDeliveryState(session, id, hidden)
  if (transition.policyChanged) {
    invalidatePendingPtyDrainPolicy(id)
  }
}
