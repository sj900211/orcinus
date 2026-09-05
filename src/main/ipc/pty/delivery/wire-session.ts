import { resetHiddenRendererPtyDeliveryDebugCounters } from '../../pty-hidden-delivery-gate'
import {
  setReadPtyRendererDeliveryDebugSnapshot,
  setResetPtyRendererDeliveryDebugSnapshot,
  setResetRendererDeliveryAccountingForLifecycleReset,
  setClearRendererDispatcherReadyWatchdog,
  setTeardownOutgoingPtyIpcSession
} from './debug'
import {
  setInvalidatePendingPtyDrainPolicy,
  setInvalidatePendingPtyDrainPriority
} from './visibility-state'
import { setClearBackgroundedDeliverySyncForPty } from '../provider/listener-lifecycle'
import {
  canSendPtyDataToRenderer,
  clearPendingPtyData,
  deletePendingPtyData,
  schedulePendingDataAfterCreditReport,
  setPendingPtyData
} from './accounting'
import {
  readCurrentPtyRendererDeliveryDebugSnapshot,
  seedPtyRendererDeliveryPeaksFromCurrentState
} from './debug-snapshot'
import {
  flushPendingData,
  invalidatePendingPtyDrainClassification,
  schedulePendingDataFlush
} from './flush'
import {
  clearDeliveryResyncProbe,
  clearDispatcherReadyWatchdog,
  resetWindowScopedDeliveryStateForLifecycle,
  teardownOutgoingWindowFlowStates
} from './window-flow-state'
import { sendModelRestoreNeededMarker, sendPtyDataToRenderer } from './payload'
import {
  resyncBackgroundedDeliveriesAfterGateReset,
  syncPtyBackgroundedDelivery,
  updateProducerFlowControl
} from './producer-sync'
import {
  acceptPtyDataForRenderer,
  clearDeliveredHiddenRendererResizeOutput,
  clearHiddenRendererResizeOutput,
  rendererPtyIsKnownHidden
} from './accept'
import {
  consumeSyntheticKillExit,
  finalizePtyExitForRenderer,
  preparePtyExitForRenderer,
  rememberRetiredRejectedPty,
  rememberSyntheticKillExit,
  sendPtyExitToRenderer,
  sendPtySpawnedToRenderer
} from './exit'
import {
  transitionHiddenRendererPtyDeliveryState,
  transitionSpawnHiddenRendererPtyDeliveryState
} from './hidden-transition'
import { requestSerializedBuffer } from '../ipc/serialize-buffer'
import { shutdownProviderAndDetectExit } from '../provider/shutdown-detect'
import type { PtyIpcSession } from '../session'

export function wirePtyIpcSession(session: PtyIpcSession): void {
  session.canSendPtyDataToRenderer = (id, options) => canSendPtyDataToRenderer(session, id, options)
  session.schedulePendingDataFlush = (delayMs) => schedulePendingDataFlush(session, delayMs)
  session.flushPendingData = () => flushPendingData(session)
  session.sendPtyDataToRenderer = (id, payload, projectionAdmissionIds) =>
    sendPtyDataToRenderer(session, id, payload, projectionAdmissionIds)
  session.sendModelRestoreNeededMarker = (id, reason, markerSeq) =>
    sendModelRestoreNeededMarker(id, reason, markerSeq)
  session.updateProducerFlowControl = (id) => updateProducerFlowControl(session, id)
  session.readCurrentPtyRendererDeliveryDebugSnapshot = () =>
    readCurrentPtyRendererDeliveryDebugSnapshot(session)
  session.clearPendingPtyData = () => clearPendingPtyData(session)
  session.deletePendingPtyData = (id) => deletePendingPtyData(session, id)
  session.setPendingPtyData = (id, pending) => setPendingPtyData(session, id, pending)
  session.acceptPtyDataForRenderer = (payload, outputSeq, projection) =>
    acceptPtyDataForRenderer(session, payload, outputSeq, projection)
  session.preparePtyExitForRenderer = (payload) => preparePtyExitForRenderer(session, payload)
  session.finalizePtyExitForRenderer = (payload) => finalizePtyExitForRenderer(session, payload)
  session.sendPtyExitToRenderer = (payload) => sendPtyExitToRenderer(session, payload)
  session.sendPtySpawnedToRenderer = (id) => sendPtySpawnedToRenderer(session, id)
  session.requestSerializedBuffer = (ptyId, opts) => requestSerializedBuffer(session, ptyId, opts)
  session.shutdownProviderAndDetectExit = (provider, id, opts) =>
    shutdownProviderAndDetectExit(provider, id, opts)
  session.rememberSyntheticKillExit = (id) => rememberSyntheticKillExit(session, id)
  session.rememberRetiredRejectedPty = (id) => rememberRetiredRejectedPty(session, id)
  session.consumeSyntheticKillExit = (id) => consumeSyntheticKillExit(session, id)
  session.syncPtyBackgroundedDelivery = (id, caller) =>
    syncPtyBackgroundedDelivery(session, id, caller)
  session.resyncBackgroundedDeliveriesAfterGateReset = () =>
    resyncBackgroundedDeliveriesAfterGateReset(session)
  session.transitionHiddenRendererPtyDeliveryState = (reportingWebContentsId, id, hidden) =>
    transitionHiddenRendererPtyDeliveryState(session, reportingWebContentsId, id, hidden)
  session.transitionSpawnHiddenRendererPtyDeliveryState = (id, hidden, worktreeId) =>
    transitionSpawnHiddenRendererPtyDeliveryState(session, id, hidden, worktreeId)
  session.rendererPtyIsKnownHidden = rendererPtyIsKnownHidden
  session.clearHiddenRendererResizeOutput = clearHiddenRendererResizeOutput
  session.clearDeliveredHiddenRendererResizeOutput = clearDeliveredHiddenRendererResizeOutput
  session.schedulePendingDataAfterCreditReport = (creditedAny) =>
    schedulePendingDataAfterCreditReport(session, creditedAny)

  setClearBackgroundedDeliverySyncForPty((id: string) => {
    session.backgroundedDeliverySyncByPty.delete(id)
  })
  if (session.runtime) {
    session.runtime.onRemoteTerminalViewPresenceChanged = (id) =>
      session.syncPtyBackgroundedDelivery(id, 'remote-view')
  }

  setReadPtyRendererDeliveryDebugSnapshot(session.readCurrentPtyRendererDeliveryDebugSnapshot)
  setResetPtyRendererDeliveryDebugSnapshot(() => {
    session.peakPendingChars = 0
    session.peakMaxPendingCharsByPty = 0
    session.peakRendererInFlightChars = 0
    session.peakMaxRendererInFlightCharsByPty = 0
    session.ackGatedFlushSkipCount = 0
    session.pendingDroppedChars = 0
    resetHiddenRendererPtyDeliveryDebugCounters()
    seedPtyRendererDeliveryPeaksFromCurrentState(session)
  })
  setResetRendererDeliveryAccountingForLifecycleReset(() => {
    // Why main-scoped: a main-window reload resets only main-owned delivery; workspace windows carry their own lifecycle listeners.
    resetWindowScopedDeliveryStateForLifecycle(session, session.mainFlowState.webContentsId)
  })
  // Why the bridge: let a later re-registration cancel this closure's timers before wiring its own.
  setClearRendererDispatcherReadyWatchdog(() => {
    for (const state of session.windowFlowStates.values()) {
      clearDispatcherReadyWatchdog(state)
      clearDeliveryResyncProbe(state)
    }
  })
  // Why the bridge: a re-registration retires this whole session — release its stranded producer pauses,
  // stop its flush timer, and detach its workspace webContents listeners before the new session wires up.
  setTeardownOutgoingPtyIpcSession(() => teardownOutgoingWindowFlowStates(session))
  setInvalidatePendingPtyDrainPriority((id, schedule) =>
    invalidatePendingPtyDrainClassification(session, id, schedule)
  )
  setInvalidatePendingPtyDrainPolicy((id, schedule) =>
    invalidatePendingPtyDrainClassification(session, id, schedule)
  )
}
