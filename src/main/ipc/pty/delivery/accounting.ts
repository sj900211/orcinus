import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryStateReport
} from '../../../../shared/pty-renderer-delivery-health'
import { tryGetProviderForPty } from '../provider/registry'
import { mainDeliveryBreadcrumbs } from './debug'
import {
  PTY_DELIVERY_RESYNC_TIMEOUT_MS,
  PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS,
  PTY_RENDERER_INTERACTIVE_RESERVE_CHARS,
  PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS,
  PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS
} from './constants'
import type { PtyIpcSession } from '../session'
import type { PendingPtyData } from '../../pty-pending-data-drain-queue'
import {
  clearDeliveryResyncProbe,
  ownerFlowStateForPty,
  totalRendererInFlightChars,
  type RendererWindowFlowState
} from './window-flow-state'

export function getRendererInFlightCharsForPty(session: PtyIpcSession, id: string): number {
  const accounting = session.rendererDeliveryAccountingByPty.get(id)
  return accounting ? accounting.sentChars - accounting.ackedChars : 0
}

export function recordPtyRendererDeliveryPressure(session: PtyIpcSession, id: string): void {
  session.peakPendingChars = Math.max(
    session.peakPendingChars,
    session.pendingData.totalPendingChars
  )
  session.peakMaxPendingCharsByPty = Math.max(
    session.peakMaxPendingCharsByPty,
    session.pendingData.get(id)?.data.length ?? 0
  )
  session.peakRendererInFlightChars = Math.max(
    session.peakRendererInFlightChars,
    totalRendererInFlightChars(session)
  )
  session.peakMaxRendererInFlightCharsByPty = Math.max(
    session.peakMaxRendererInFlightCharsByPty,
    getRendererInFlightCharsForPty(session, id)
  )
}

export function setPendingPtyData(
  session: PtyIpcSession,
  id: string,
  pending: PendingPtyData
): void {
  session.pendingData.set(id, pending)
  recordPtyRendererDeliveryPressure(session, id)
}

export function deletePendingPtyData(session: PtyIpcSession, id: string): void {
  session.pendingData.delete(id)
}

export function clearPendingPtyData(session: PtyIpcSession): void {
  for (const pending of session.pendingData.values()) {
    if (pending.projectionAdmissionIds) {
      session.sshOutputIntake?.transferProjections(
        pending.projectionAdmissionIds,
        'renderer-lifecycle-reset'
      )
    }
  }
  session.pendingData.clear()
  session.sourceCreditPendingPtys.clear()
}

export function canSendPtyDataToRenderer(
  session: PtyIpcSession,
  id: string,
  options: { interactive?: boolean } = {}
): boolean {
  const totalLimit =
    PTY_RENDERER_TOTAL_IN_FLIGHT_HIGH_WATER_CHARS +
    (options.interactive === true ? PTY_RENDERER_INTERACTIVE_RESERVE_CHARS : 0)
  // Why per-PTY (not global) reserve: keep one active pane responsive without letting every background pane burst past the cap.
  const ptyLimit =
    PTY_RENDERER_IN_FLIGHT_HIGH_WATER_CHARS +
    (options.interactive === true ? PTY_RENDERER_ACTIVE_PTY_IN_FLIGHT_RESERVE_CHARS : 0)
  const ownerState = ownerFlowStateForPty(session, id)
  return (
    ownerState !== null &&
    getRendererInFlightCharsForPty(session, id) < ptyLimit &&
    ownerState.inFlightTotalChars < totalLimit
  )
}

export function applyCumulativeAck(
  session: PtyIpcSession,
  id: string,
  processedChars: number
): number {
  const accounting = session.rendererDeliveryAccountingByPty.get(id)
  if (!accounting) {
    return 0
  }
  // Clamped to sentChars so a corrupt payload cannot drive in-flight negative.
  const nextAckedChars = Math.min(
    accounting.sentChars,
    Math.max(accounting.ackedChars, processedChars)
  )
  const acknowledged = nextAckedChars - accounting.ackedChars
  accounting.ackedChars = nextAckedChars
  if (acknowledged > 0) {
    accounting.lastAckAtMs = Date.now()
  }
  // Why the accounting's owner (not the acking sender): the debt lives on the window the bytes were sent to.
  const ownerState = session.windowFlowStates.get(accounting.ownerWebContentsId)
  if (ownerState) {
    ownerState.inFlightTotalChars = Math.max(0, ownerState.inFlightTotalChars - acknowledged)
  }
  if (acknowledged > 0) {
    session.sshOutputIntake?.settleProjectionPrefix(id, acknowledged)
  }
  return acknowledged
}

// Renderer-reported cumulative totals enter here: record the sender's counter, then credit only the
// owner window's accounting — a demoted window's stale total would otherwise max-merge as a full ack
// of bytes the new owner never processed.
export function applyRendererCumulativeAck(
  session: PtyIpcSession,
  senderState: RendererWindowFlowState,
  id: string,
  processedChars: number
): number {
  senderState.lastCumulativeAckByPty.set(
    id,
    Math.max(senderState.lastCumulativeAckByPty.get(id) ?? 0, processedChars)
  )
  const accounting = session.rendererDeliveryAccountingByPty.get(id)
  if (!accounting || accounting.ownerWebContentsId !== senderState.webContentsId) {
    return 0
  }
  return applyCumulativeAck(session, id, Math.max(0, processedChars - accounting.ackBaseChars))
}

export function schedulePendingDataAfterCreditReport(
  session: PtyIpcSession,
  creditedAny: boolean
): void {
  if (creditedAny) {
    session.pendingData.reactivateBlocked()
  }
  if (session.pendingData.size > 0 && !session.flushTimer) {
    session.schedulePendingDataFlush(0)
  }
}

// Why: data for a fully gated PTY signals delivery may be stuck on lost ACKs (e.g. dropped across suspend); ask the pty's owner window for authoritative totals instead of a wall-clock guess.
export function requestDeliveryResyncForGatedPty(session: PtyIpcSession, id: string): void {
  const state = ownerFlowStateForPty(session, id)
  if (!state || state.deliveryResyncOutstandingRequestId !== null) {
    return
  }
  session.deliveryResyncRequestSerial += 1
  const requestId = session.deliveryResyncRequestSerial
  state.deliveryResyncOutstandingRequestId = requestId
  state.deliveryResyncTimer = setTimeout(() => {
    if (state.deliveryResyncOutstandingRequestId !== requestId) {
      return
    }
    clearDeliveryResyncProbe(state)
    // Why no mutation on timeout: unanswered means dead IPC that only a reload cures; log once per silent streak to avoid spamming every probe.
    if (state.deliveryResyncUnansweredWarnLogged) {
      return
    }
    state.deliveryResyncUnansweredWarnLogged = true
    console.warn('[pty] delivery resync probe unanswered — renderer IPC unresponsive', {
      msSinceLastAck:
        state.lastAckReceivedAtMs === null ? null : Date.now() - state.lastAckReceivedAtMs,
      ...session.readCurrentPtyRendererDeliveryDebugSnapshot()
    })
  }, PTY_DELIVERY_RESYNC_TIMEOUT_MS)
  state.deliveryResyncTimer.unref?.()
  state.webContents.send('pty:requestDeliveryResync', { requestId })
}

// Why write off: bytes sent but never received after a confirmed wedge are gone (no ACK can repay them); hand back restore markers so panes repaint from the snapshot.
export function writeOffLostRendererDelivery(
  session: PtyIpcSession,
  report: PtyRendererDeliveryStateReport,
  state: RendererWindowFlowState
): PtyDeliveryWriteOff[] {
  const writtenOff: PtyDeliveryWriteOff[] = []
  for (const [id, accounting] of session.rendererDeliveryAccountingByPty) {
    // Why: the reporting window can only vouch for its own delivery; other windows' debts stay.
    if (accounting.ownerWebContentsId !== state.webContentsId) {
      continue
    }
    if (accounting.sentChars - accounting.ackedChars <= 0) {
      continue
    }
    const received = report.receivedCharsByPty?.[id]
    const receivedChars =
      typeof received === 'number' && Number.isFinite(received) ? Math.max(0, received) : 0
    // Why skip: received-but-unparsed bytes are alive in the renderer write queue; their deferred ACK still repays this debt.
    if (receivedChars > accounting.ackedChars) {
      continue
    }
    const acknowledged = applyCumulativeAck(session, id, accounting.sentChars)
    if (acknowledged <= 0) {
      continue
    }
    tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
    // Why drop pending: everything at/before markerSeq comes from the snapshot, so flushing pre-marker bytes would double-paint the restore.
    const pending = session.pendingData.get(id)
    if (pending) {
      if (pending.projectionAdmissionIds) {
        session.sshOutputIntake?.transferProjections(
          pending.projectionAdmissionIds,
          'renderer-delivery-writeoff'
        )
      }
      session.pendingDroppedChars += pending.data.length
      deletePendingPtyData(session, id)
      session.pendingOverflowMarkedPtys.delete(id)
      session.updateProducerFlowControl(id)
    }
    const markerSeq = session.runtime?.getPtyOutputSequence(id)
    writtenOff.push({
      id,
      ...(typeof markerSeq === 'number' ? { markerSeq } : {}),
      writtenOffChars: acknowledged
    })
  }
  if (writtenOff.length > 0) {
    clearDeliveryResyncProbe(state)
    state.deliveryResyncUnansweredWarnLogged = false
    mainDeliveryBreadcrumbs.record('delivery-heal-writeoff', {
      writtenOffPtyCount: writtenOff.length,
      writtenOffChars: writtenOff.reduce((sum, { writtenOffChars }) => sum + writtenOffChars, 0)
    })
    console.warn('[pty] delivery heal: wrote off renderer-bound bytes lost in push channel', {
      rendererPtyDataListenerCount: report.rendererPtyDataListenerCount ?? null,
      msSinceLastAck:
        state.lastAckReceivedAtMs === null ? null : Date.now() - state.lastAckReceivedAtMs,
      writtenOffByPty: writtenOff.map(({ id, writtenOffChars }) => ({ id, writtenOffChars })),
      ...session.readCurrentPtyRendererDeliveryDebugSnapshot()
    })
  }
  return writtenOff
}
