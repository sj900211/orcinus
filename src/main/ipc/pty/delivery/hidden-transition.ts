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
): {
  droppable: boolean
  droppedWhileHidden: boolean
  hiddenDropEpisode?: number
  policyChanged: boolean
} {
  const settings = session.getSettings?.()
  const wasDroppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  let unmarked: ReturnType<typeof unmarkHiddenRendererPty> = { droppedWhileHidden: false }
  if (hidden) {
    markHiddenRendererPty(reportingWebContentsId, id)
  } else {
    unmarked = unmarkHiddenRendererPty(reportingWebContentsId, id)
  }
  const droppable = shouldDropHiddenRendererPtyDataForOwner(id, settings)
  return { droppable, ...unmarked, policyChanged: wasDroppable !== droppable }
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
