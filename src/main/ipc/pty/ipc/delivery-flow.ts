import { getPtyIpc } from '../../pty-host-bindings'
import type {
  PtyDeliveryWriteOff,
  PtyRendererDeliveryHealthReply,
  PtyRendererDeliveryStateReport
} from '../../../../shared/pty-renderer-delivery-health'
import { tryGetProviderForPty } from '../provider/registry'
import { PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS } from '../delivery/constants'
import { applyRendererCumulativeAck, writeOffLostRendererDelivery } from '../delivery/accounting'
import {
  ackAttributionFlowState,
  clearDeliveryResyncProbe,
  clearDispatcherReadyWatchdog,
  flowStateForSenderEvent,
  getOrCreateWindowFlowState,
  resetWindowScopedDeliveryStateForLifecycle
} from '../delivery/window-flow-state'
import { isPtyEventFromTrustedAppWindow } from './write-input'
import type { PtyIpcSession } from '../session'

// Renderer→main delivery flow control: cumulative ACK credit, resync replies, wedge-heal health
// reports, and the per-window dispatcher-ready handshake. Every handler attributes to the SENDER
// window's flow state so one window's reload or stale counters can't corrupt another's delivery.
export function installPtyDeliveryFlowIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()
  const { mainWindow } = session

  // Why: renderer ACKs bound main→renderer delivery without stopping PTY ingestion — agent/status consumers still see every chunk via the provider/runtime path.
  ipcMain.removeAllListeners('pty:ackData')
  ipcMain.on(
    'pty:ackData',
    (event, args: { id: string; charCount?: number; processedChars?: number }) => {
      const senderFlowState = flowStateForSenderEvent(session, event)
      senderFlowState.lastAckReceivedAtMs = Date.now()
      // Why: a live ACK channel means a future unanswered probe is a fresh diagnostic event, not a continuation of the last silent streak.
      senderFlowState.deliveryResyncUnansweredWarnLogged = false
      const ackSenderState = ackAttributionFlowState(session, event)
      let acknowledged = 0
      if (!ackSenderState) {
        acknowledged = 0
      } else if (typeof args.processedChars === 'number' && Number.isFinite(args.processedChars)) {
        acknowledged = applyRendererCumulativeAck(
          session,
          ackSenderState,
          args.id,
          Math.max(0, args.processedChars)
        )
      } else {
        // Why: tolerate legacy per-chunk delta payloads — dev hot-reload can pair an old renderer with a new main.
        // Owner-gated because the synthesized cumulative is derived from the owner's accounting; a
        // non-owner's delta can neither be trusted nor mirrored.
        const accounting = session.rendererDeliveryAccountingByPty.get(args.id)
        const delta = Number.isFinite(args.charCount) ? Math.max(0, args.charCount ?? 0) : 0
        acknowledged =
          accounting && accounting.ownerWebContentsId === ackSenderState.webContentsId
            ? applyRendererCumulativeAck(
                session,
                ackSenderState,
                args.id,
                accounting.ackBaseChars + accounting.ackedChars + delta
              )
            : 0
      }
      tryGetProviderForPty(args.id)?.acknowledgeDataEvent(args.id, acknowledged)
      session.schedulePendingDataAfterCreditReport(acknowledged > 0)
    }
  )

  ipcMain.removeAllListeners('pty:deliveryResyncResponse')
  ipcMain.on(
    'pty:deliveryResyncResponse',
    (event, args: { requestId: number; processedCharsByPty: Record<string, number> }) => {
      const senderFlowState = flowStateForSenderEvent(session, event)
      if (
        senderFlowState.deliveryResyncOutstandingRequestId === null ||
        args?.requestId !== senderFlowState.deliveryResyncOutstandingRequestId
      ) {
        return
      }
      clearDeliveryResyncProbe(senderFlowState)
      senderFlowState.deliveryResyncUnansweredWarnLogged = false
      // Why max-merge: the renderer's cumulative totals are authoritative for what it processed, draining exactly the in-flight debt from lost ACKs.
      const ackSenderState = ackAttributionFlowState(session, event)
      let creditedAny = false
      if (ackSenderState) {
        for (const [id, processedChars] of Object.entries(args.processedCharsByPty ?? {})) {
          if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
            continue
          }
          const acknowledged = applyRendererCumulativeAck(
            session,
            ackSenderState,
            id,
            Math.max(0, processedChars)
          )
          if (acknowledged > 0) {
            creditedAny = true
            tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
          }
        }
      }
      session.schedulePendingDataAfterCreditReport(creditedAny)
    }
  )

  // Why invoke + renderer-initiated: the field wedge (v1.4.121-rc.0) kills every main→renderer push channel while invoke survives, so the resync rides here plus a write-off lane.
  ipcMain.removeHandler('pty:reportRendererDeliveryState')
  ipcMain.handle(
    'pty:reportRendererDeliveryState',
    (event, args: PtyRendererDeliveryStateReport): PtyRendererDeliveryHealthReply => {
      const senderFlowState = flowStateForSenderEvent(session, event)
      // Extra repair lane for the lost-ACK variant: identical max-merge to the resync response, so a heal is only reached when merging cannot drain.
      const ackSenderState = ackAttributionFlowState(session, event)
      let creditedAny = false
      if (ackSenderState) {
        for (const [id, processedChars] of Object.entries(args?.processedCharsByPty ?? {})) {
          if (typeof processedChars !== 'number' || !Number.isFinite(processedChars)) {
            continue
          }
          const acknowledged = applyRendererCumulativeAck(
            session,
            ackSenderState,
            id,
            Math.max(0, processedChars)
          )
          if (acknowledged > 0) {
            creditedAny = true
            tryGetProviderForPty(id)?.acknowledgeDataEvent(id, acknowledged)
          }
        }
      }
      let writtenOff: PtyDeliveryWriteOff[] = []
      // Why the main-side ACK-silence check: requiring main to have also seen no ACK stops a buggy/foreign caller from writing off live delivery.
      if (
        args?.heal === true &&
        senderFlowState.inFlightTotalChars > 0 &&
        (senderFlowState.lastAckReceivedAtMs === null ||
          Date.now() - senderFlowState.lastAckReceivedAtMs >= PTY_DELIVERY_HEAL_MIN_ACK_SILENCE_MS)
      ) {
        writtenOff = writeOffLostRendererDelivery(session, args, senderFlowState)
        creditedAny ||= writtenOff.length > 0
      }
      session.schedulePendingDataAfterCreditReport(creditedAny)
      let inFlightPtyCount = 0
      for (const accounting of session.rendererDeliveryAccountingByPty.values()) {
        if (
          accounting.ownerWebContentsId === senderFlowState.webContentsId &&
          accounting.sentChars - accounting.ackedChars > 0
        ) {
          inFlightPtyCount++
        }
      }
      return {
        inFlightTotalChars: senderFlowState.inFlightTotalChars,
        inFlightPtyCount,
        msSinceLastAck:
          senderFlowState.lastAckReceivedAtMs === null
            ? null
            : Date.now() - senderFlowState.lastAckReceivedAtMs,
        ...(writtenOff.length > 0 ? { writtenOff } : {})
      }
    }
  )

  // Why: renderer signals its pty:data listener is live; until then sends are held so boot-window bytes can't drop into a listener-less page and pin the gate.
  ipcMain.removeAllListeners('pty:rendererDispatcherReady')
  ipcMain.on('pty:rendererDispatcherReady', (event) => {
    // Why: the reconcile below destructively clears delivery accounting, so a straggler handshake from an untrusted window must not reset app-window state.
    if (!isPtyEventFromTrustedAppWindow(event, mainWindow)) {
      return
    }
    const senderFlowState = getOrCreateWindowFlowState(session, event.sender)
    // Why: a handshake while the gate is already open means a page load whose lifecycle reset was missed; clear that page's stale accounting so it can't permanently gate survivors.
    if (senderFlowState.dispatcherReady) {
      resetWindowScopedDeliveryStateForLifecycle(session, senderFlowState.webContentsId)
    }
    // Why: real handshake landed — cancel the self-heal watchdog so it can't later force-open the gate.
    clearDispatcherReadyWatchdog(senderFlowState)
    senderFlowState.dispatcherReady = true
    session.pendingData.reactivateBlocked()
    session.schedulePendingDataFlush(0)
  })
}
