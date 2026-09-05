import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { resolvePtyOwnerWindow } from '../../../window/window-affinity-router'
import { resetRendererScopedHiddenPtyDeliveryState } from '../../pty-hidden-delivery-gate'
import { PTY_DISPATCHER_READY_WATCHDOG_MS } from './constants'
import type { PtyIpcSession, RendererPtyDeliveryAccounting } from '../session'

// Why: dispatcher-ready gates, ACK freshness, in-flight totals, and resync probes are per-renderer
// facts — one Map entry per app window so a workspace window's reload can't clobber the others.
export type RendererWindowFlowState = {
  webContents: WebContents
  webContentsId: number
  inFlightTotalChars: number
  lastAckReceivedAtMs: number | null
  // Why: gate sends until the page's pty:data listener exists; else webContents.send drops bytes but still counts them in-flight, permanently pinning the gate.
  dispatcherReady: boolean
  dispatcherReadyWatchdogTimer: ReturnType<typeof setTimeout> | null
  deliveryResyncOutstandingRequestId: number | null
  deliveryResyncTimer: ReturnType<typeof setTimeout> | null
  deliveryResyncUnansweredWarnLogged: boolean
  // Why: mirrors this window's renderer-side cumulative processed counter per pty (it survives owner
  // changes there); a re-owning window's fresh accounting baselines against it or stale totals over-credit.
  lastCumulativeAckByPty: Map<string, number>
}

// Why a session token (not a generation counter): a re-registration creates a new session whose
// workspace lifecycle listeners must not fire against the outgoing session's closures.
let activeWindowFlowSession: PtyIpcSession | null = null

export function setActiveWindowFlowSession(session: PtyIpcSession): void {
  activeWindowFlowSession = session
}

export function createWindowFlowState(
  session: PtyIpcSession,
  webContents: WebContents
): RendererWindowFlowState {
  const state: RendererWindowFlowState = {
    webContents,
    webContentsId: webContents.id,
    inFlightTotalChars: 0,
    lastAckReceivedAtMs: null,
    dispatcherReady: false,
    dispatcherReadyWatchdogTimer: null,
    deliveryResyncOutstandingRequestId: null,
    deliveryResyncTimer: null,
    deliveryResyncUnansweredWarnLogged: false,
    lastCumulativeAckByPty: new Map()
  }
  session.windowFlowStates.set(webContents.id, state)
  return state
}

export function getOrCreateWindowFlowState(
  session: PtyIpcSession,
  webContents: WebContents
): RendererWindowFlowState {
  const existing = session.windowFlowStates.get(webContents.id)
  if (existing) {
    return existing
  }
  const state = createWindowFlowState(session, webContents)
  if (webContents !== session.mainFlowState.webContents) {
    trackWorkspaceWindowDeliveryLifecycle(session, state)
  }
  return state
}

export function totalRendererInFlightChars(session: PtyIpcSession): number {
  let total = 0
  for (const state of session.windowFlowStates.values()) {
    total += state.inFlightTotalChars
  }
  return total
}

export function ownerFlowStateForPty(
  session: PtyIpcSession,
  id: string
): RendererWindowFlowState | null {
  const owner = resolvePtyOwnerWindow(id)
  const webContents = owner?.webContents
  if (
    !webContents ||
    (typeof webContents.isDestroyed === 'function' && webContents.isDestroyed())
  ) {
    return null
  }
  return getOrCreateWindowFlowState(session, webContents)
}

// Why: attribute sender-scoped IPC (ACKs, resync replies, health reports) to that window's state; unknown senders fall back to the main window like the single-window era.
export function flowStateForSenderEvent(
  session: PtyIpcSession,
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined
): RendererWindowFlowState {
  const senderId = event?.sender?.id
  return (
    (senderId !== undefined ? session.windowFlowStates.get(senderId) : undefined) ??
    session.mainFlowState
  )
}

// Why strict (no main fallback for real senders): ack crediting mirrors each window's renderer
// counter, so a destroyed window's queued acks must be dropped, not booked onto the main window.
// A senderless event (tests, legacy relays) still presents as main.
export function ackAttributionFlowState(
  session: PtyIpcSession,
  event: IpcMainEvent | IpcMainInvokeEvent | null | undefined
): RendererWindowFlowState | null {
  const senderId = event?.sender?.id
  return senderId === undefined
    ? session.mainFlowState
    : (session.windowFlowStates.get(senderId) ?? null)
}

export function ptyBelongsToWindow(
  session: PtyIpcSession,
  id: string,
  webContentsId: number
): boolean {
  const accounting = session.rendererDeliveryAccountingByPty.get(id)
  if (accounting) {
    return accounting.ownerWebContentsId === webContentsId
  }
  const owner = resolvePtyOwnerWindow(id)
  return owner
    ? owner.webContents.id === webContentsId
    : webContentsId === session.mainFlowState.webContentsId
}

export function clearDeliveryResyncProbe(state: RendererWindowFlowState): void {
  state.deliveryResyncOutstandingRequestId = null
  if (state.deliveryResyncTimer) {
    clearTimeout(state.deliveryResyncTimer)
    state.deliveryResyncTimer = null
  }
}

export function clearDispatcherReadyWatchdog(state: RendererWindowFlowState): void {
  if (state.dispatcherReadyWatchdogTimer) {
    clearTimeout(state.dispatcherReadyWatchdogTimer)
    state.dispatcherReadyWatchdogTimer = null
  }
}

function isFlowStateWebContentsDestroyed(state: RendererWindowFlowState): boolean {
  return typeof state.webContents.isDestroyed === 'function' && state.webContents.isDestroyed()
}

export function armDispatcherReadyWatchdog(
  session: PtyIpcSession,
  state: RendererWindowFlowState
): void {
  clearDispatcherReadyWatchdog(state)
  if (isFlowStateWebContentsDestroyed(state)) {
    return
  }
  // Why: one-shot self-heal — force the gate open if the reloaded page never signals ready, so a dropped handshake can't hold it forever. Unref'd so it can't keep the process alive.
  state.dispatcherReadyWatchdogTimer = setTimeout(() => {
    state.dispatcherReadyWatchdogTimer = null
    if (state.dispatcherReady || isFlowStateWebContentsDestroyed(state)) {
      return
    }
    state.dispatcherReady = true
    session.rendererDispatcherReadyForcedCount += 1
    session.pendingData.reactivateBlocked()
    session.schedulePendingDataFlush(0)
  }, PTY_DISPATCHER_READY_WATCHDOG_MS)
  state.dispatcherReadyWatchdogTimer.unref?.()
}

function trackWorkspaceWindowDeliveryLifecycle(
  session: PtyIpcSession,
  state: RendererWindowFlowState
): void {
  const scopedReset = (): void => {
    if (activeWindowFlowSession !== session) {
      return
    }
    resetWindowScopedDeliveryStateForLifecycle(session, state.webContentsId)
    resetRendererScopedHiddenPtyDeliveryState(state.webContentsId)
    session.resyncBackgroundedDeliveriesAfterGateReset()
  }
  state.webContents.on('render-process-gone', scopedReset)
  state.webContents.on(
    'did-start-navigation',
    (details: { isMainFrame: boolean; isSameDocument: boolean }) => {
      if (!details.isMainFrame || details.isSameDocument) {
        return
      }
      scopedReset()
    }
  )
  state.webContents.on('destroyed', () => {
    if (activeWindowFlowSession !== session) {
      return
    }
    scopedReset()
    clearDispatcherReadyWatchdog(state)
    clearDeliveryResyncProbe(state)
    session.windowFlowStates.delete(state.webContentsId)
  })
  // Why: a workspace window enters tracking mid-session with no navigation reset behind it; the watchdog self-heals a lost handshake.
  armDispatcherReadyWatchdog(session, state)
}

// Why: bytes in flight to the previous owner can never be acked by the new one (renderer counters restart per window); release the debt and latch a restore marker for the new owner.
export function releasePtyAccountingForOwnerChange(
  session: PtyIpcSession,
  id: string,
  accounting: RendererPtyDeliveryAccounting
): void {
  const inFlight = Math.max(0, accounting.sentChars - accounting.ackedChars)
  const previousOwnerState = session.windowFlowStates.get(accounting.ownerWebContentsId)
  if (previousOwnerState) {
    previousOwnerState.inFlightTotalChars = Math.max(
      0,
      previousOwnerState.inFlightTotalChars - inFlight
    )
  }
  session.sshOutputIntake?.transferPtyProjections(id, 'pty-owner-window-changed')
  session.rendererDeliveryAccountingByPty.delete(id)
  session.rendererDeliveryRestoreNeededPtys.add(id)
}

export function resetWindowScopedDeliveryStateForLifecycle(
  session: PtyIpcSession,
  webContentsId: number
): void {
  const state = session.windowFlowStates.get(webContentsId)
  // Why lossless: pendingData bytes were bound for the dead page; the replacement repaints from main's authoritative sources, which superset it.
  session.lastLifecycleResetClearedChars = state?.inFlightTotalChars ?? 0
  session.rendererLifecycleResetCount += 1
  if (state) {
    clearDeliveryResyncProbe(state)
    state.deliveryResyncUnansweredWarnLogged = false
  }
  // Why: a closing project window's live PTYs fall back to main, which must repaint them; the
  // main window's own reload repaints from itself, so it keeps the plain delete (no owner change).
  const isOwnerWindowGone = webContentsId !== session.mainFlowState.webContentsId
  const ownerGonePtyIds = new Set<string>()
  // Deleting the visited entry mid-iteration is safe for Map/Set iterators.
  for (const [id, accounting] of session.rendererDeliveryAccountingByPty) {
    if (accounting.ownerWebContentsId !== webContentsId) {
      continue
    }
    // Why release before clearing: pending bytes and credits belonged to the dead page; releasing producer pauses first keeps no shell wedged.
    session.producerFlowControl.release(id)
    session.sshOutputIntake?.transferPtyProjections(id, 'renderer-lifecycle-reset')
    if (isOwnerWindowGone) {
      // Latches a restore marker for the new (main) owner instead of dropping the PTY silently.
      releasePtyAccountingForOwnerChange(session, id, accounting)
      ownerGonePtyIds.add(id)
    } else {
      session.rendererDeliveryAccountingByPty.delete(id)
    }
  }
  for (const id of session.pendingData.keys()) {
    if (!ptyBelongsToWindow(session, id, webContentsId)) {
      continue
    }
    const pending = session.pendingData.get(id)
    if (pending?.projectionAdmissionIds) {
      session.sshOutputIntake?.transferProjections(
        pending.projectionAdmissionIds,
        'renderer-lifecycle-reset'
      )
    }
    session.pendingData.delete(id)
    session.producerFlowControl.release(id)
    session.sourceCreditPendingPtys.delete(id)
  }
  for (const id of session.pendingOverflowMarkedPtys) {
    if (ptyBelongsToWindow(session, id, webContentsId)) {
      session.pendingOverflowMarkedPtys.delete(id)
    }
  }
  for (const id of session.rendererDeliveryRestoreNeededPtys) {
    // Why keep ownerGonePtyIds: their restore latch was just added above for the new (main) owner; the deferred emit below consumes it.
    if (!ownerGonePtyIds.has(id) && ptyBelongsToWindow(session, id, webContentsId)) {
      session.rendererDeliveryRestoreNeededPtys.delete(id)
    }
  }
  if (state) {
    state.inFlightTotalChars = 0
    // Why: the dead page's renderer counters reset with it; a kept mirror would over-discount the replacement's acks.
    state.lastCumulativeAckByPty.clear()
    // Why hold sends: the reloading page's pty:data listener is gone until it re-registers/handshakes, so bytes would drop into a listener-less page and re-pin the gate.
    state.dispatcherReady = false
    // Why: arm the self-heal watchdog so a never-arriving handshake can't hold the gate forever; the real handshake cancels it.
    armDispatcherReadyWatchdog(session, state)
  }
  if (ownerGonePtyIds.size > 0) {
    // Why deferred: the BrowserWindow 'closed' handler that unregisters the project window from the
    // routing registry runs after this webContents-'destroyed' reset; waiting a turn lets
    // resolvePtyOwnerWindow fall the marker through to main instead of the dying project window.
    setImmediate(() => {
      for (const id of ownerGonePtyIds) {
        if (!session.rendererDeliveryRestoreNeededPtys.has(id)) {
          continue
        }
        if (
          session.sendModelRestoreNeededMarker(
            id,
            'renderer-window-closed',
            session.runtime?.getPtyOutputSequence(id)
          )
        ) {
          session.rendererDeliveryRestoreNeededPtys.delete(id)
        } else {
          console.warn(
            '[pty] restore marker after window close found no owner; PTY output may stall'
          )
        }
      }
    })
  }
}

// Why: with every app window gone nothing can ever drain or ack again — wipe delivery bookkeeping and release producers so shells can't wedge.
export function teardownAllRendererDeliveryState(session: PtyIpcSession): void {
  session.producerFlowControl.releaseAll()
  for (const state of session.windowFlowStates.values()) {
    clearDeliveryResyncProbe(state)
    clearDispatcherReadyWatchdog(state)
    state.inFlightTotalChars = 0
    state.lastCumulativeAckByPty.clear()
  }
  session.clearPendingPtyData()
  session.pendingOverflowMarkedPtys.clear()
  session.rendererDeliveryAccountingByPty.clear()
}
