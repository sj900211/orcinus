import { redactPtyIdForDiagnostics } from '../../../../shared/pty-delivery-diagnostics'
import type { PtyModelRestoreReason } from '../../../../shared/pty-model-restore-marker'
import { sendToPtyOwner } from '../../../window/window-affinity-router'
import { mainDeliveryBreadcrumbs } from './debug'
import { recordPtyRendererDeliveryPressure } from './accounting'
import { ownerFlowStateForPty, releasePtyAccountingForOwnerChange } from './window-flow-state'
import type { PtyDataPayload, PtyIpcSession } from '../session'

export function makePtyDataPayload(
  id: string,
  data: string,
  startSeq: number | undefined,
  containsBackgroundOutput: boolean | undefined,
  rawLength = data.length,
  transformed = false
): PtyDataPayload {
  const payload: PtyDataPayload = { id, data }
  if (typeof startSeq === 'number') {
    payload.seq = startSeq + rawLength
  }
  if (typeof startSeq === 'number' || rawLength !== data.length || transformed) {
    payload.rawLength = rawLength
  }
  if (transformed) {
    payload.transformed = true
  }
  if (containsBackgroundOutput === true) {
    payload.background = true
  }
  return payload
}

export function getPtyPayloadCharCount(payload: { data: string; rawLength?: number }): number {
  return Math.max(0, payload.rawLength ?? payload.data.length)
}

// Why out-of-band (not pty:data): an in-band empty chunk is indistinguishable from one fully consumed by renderer-side OSC-9999 stripping, which spuriously restored visible panes.
export function sendModelRestoreNeededMarker(
  id: string,
  reason: PtyModelRestoreReason,
  markerSeq: number | undefined
): boolean {
  return sendToPtyOwner(id, 'pty:modelRestoreNeeded', {
    id,
    reason,
    ...(typeof markerSeq === 'number' ? { markerSeq } : {})
  })
}

export function sendPtyDataToRenderer(
  session: PtyIpcSession,
  id: string,
  payload: PtyDataPayload,
  projectionAdmissionIds?: readonly string[]
): { sent: boolean; projectionsTransferred: boolean } {
  const charCount = getPtyPayloadCharCount(payload)
  const ownerState = ownerFlowStateForPty(session, id)
  if (!ownerState) {
    session.rendererDeliveryRestoreNeededPtys.add(id)
    if (projectionAdmissionIds) {
      session.sshOutputIntake?.transferProjections(projectionAdmissionIds, 'renderer-send-failed')
    }
    mainDeliveryBreadcrumbs.record('pty-data-send-failed', {
      id: redactPtyIdForDiagnostics(id),
      chars: charCount
    })
    return { sent: false, projectionsTransferred: projectionAdmissionIds !== undefined }
  }
  let accounting = session.rendererDeliveryAccountingByPty.get(id)
  if (accounting && accounting.ownerWebContentsId !== ownerState.webContentsId) {
    releasePtyAccountingForOwnerChange(session, id, accounting)
    accounting = undefined
  }
  const hadAccounting = accounting !== undefined
  if (accounting) {
    accounting.sentChars += charCount
    accounting.lastSendAtMs = Date.now()
  } else {
    session.rendererDeliveryAccountingByPty.set(id, {
      sentChars: charCount,
      ackedChars: 0,
      lastSendAtMs: Date.now(),
      lastAckAtMs: null,
      ownerWebContentsId: ownerState.webContentsId,
      ackBaseChars: ownerState.lastCumulativeAckByPty.get(id) ?? 0
    })
  }
  ownerState.inFlightTotalChars += charCount
  recordPtyRendererDeliveryPressure(session, id)
  try {
    ownerState.webContents.send('pty:data', payload)
  } catch (error) {
    const current = session.rendererDeliveryAccountingByPty.get(id)
    if (current) {
      const inFlightBeforeRollback = current.sentChars - current.ackedChars
      current.sentChars = Math.max(0, current.sentChars - charCount)
      current.ackedChars = Math.min(current.ackedChars, current.sentChars)
      const inFlightAfterRollback = current.sentChars - current.ackedChars
      ownerState.inFlightTotalChars = Math.max(
        0,
        ownerState.inFlightTotalChars - (inFlightBeforeRollback - inFlightAfterRollback)
      )
      if (!hadAccounting && current.sentChars === 0) {
        session.rendererDeliveryAccountingByPty.delete(id)
      }
    }
    session.rendererDeliveryRestoreNeededPtys.add(id)
    if (projectionAdmissionIds) {
      session.sshOutputIntake?.transferProjections(projectionAdmissionIds, 'renderer-send-failed')
    }
    mainDeliveryBreadcrumbs.record('pty-data-send-failed', {
      id: redactPtyIdForDiagnostics(id),
      chars: charCount
    })
    console.error('[pty] renderer data send failed; payload will not be retried', error)
    return { sent: false, projectionsTransferred: projectionAdmissionIds !== undefined }
  }
  let projectionsTransferred = false
  if (projectionAdmissionIds) {
    try {
      session.sshOutputIntake?.publishProjectionPrefix(
        projectionAdmissionIds,
        payload.data.length,
        charCount
      )
    } catch {
      session.sshOutputIntake?.transferProjections(
        projectionAdmissionIds,
        'projection-publish-failed'
      )
      projectionsTransferred = true
    }
  }
  if (session.rendererDeliveryRestoreNeededPtys.has(id)) {
    // Why keep the latch on failure: the marker must eventually reach the owner or the pane repaints from a gapped stream.
    if (
      sendModelRestoreNeededMarker(id, 'delivery-heal', session.runtime?.getPtyOutputSequence(id))
    ) {
      session.rendererDeliveryRestoreNeededPtys.delete(id)
    } else {
      console.error('[pty] renderer delivery-heal marker send failed; restore remains pending')
    }
  }
  return { sent: true, projectionsTransferred }
}
