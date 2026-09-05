import { markHiddenRendererPty, unmarkHiddenRendererPty } from '../../pty-hidden-delivery-gate'
import { shouldDropHiddenRendererPtyDataForOwner } from '../pty-owner-gate'
import {
  resolvePtyOwnerWindow,
  resolveWorktreeOwnerWindow
} from '../../../window/window-affinity-router'
import { invalidatePendingPtyDrainPolicy } from './visibility-state'
import type { PtyIpcSession } from '../session'

// Why owner-scoped reads with reporter-scoped writes: delivery decisions consult the OWNER window's
// gate marks, while each reporting window records what its own views can see.
export function transitionHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  reportingWebContentsId: number,
  id: string,
  hidden: boolean
): { droppable: boolean; droppedWhileHidden: boolean; policyChanged: boolean } {
  const settings = session.getSettings?.()
  const wasDroppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  let droppedWhileHidden = false
  if (hidden) {
    markHiddenRendererPty(reportingWebContentsId, id)
  } else {
    droppedWhileHidden = unmarkHiddenRendererPty(reportingWebContentsId, id).droppedWhileHidden
  }
  const droppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  return { droppable, droppedWhileHidden, policyChanged: wasDroppable !== droppable }
}

// Why owner attribution: spawn-time marks must land where delivery decisions read them, not on the requesting window.
export function transitionSpawnHiddenRendererPtyDeliveryState(
  session: PtyIpcSession,
  id: string,
  hidden: boolean,
  worktreeId?: string
): void {
  const owner =
    worktreeId !== undefined ? resolveWorktreeOwnerWindow(worktreeId) : resolvePtyOwnerWindow(id)
  const reportingWebContentsId = owner ? owner.webContents.id : session.mainFlowState.webContentsId
  const transition = transitionHiddenRendererPtyDeliveryState(
    session,
    reportingWebContentsId,
    id,
    hidden
  )
  if (transition.policyChanged) {
    invalidatePendingPtyDrainPolicy(id)
  }
}
