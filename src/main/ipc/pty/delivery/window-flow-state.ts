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
  // Why: removes the webContents lifecycle listeners this session attached, so a re-registration can
  // detach the outgoing session instead of leaking a listener (and the whole dead session) per macOS re-activate.
  detachLifecycleListeners: (() => void) | null
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
    lastCumulativeAckByPty: new Map(),
    detachLifecycleListeners: null
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

// Why strict for real senders: sender-scoped IPC (acks, resync replies, heal reports) mirrors each
// window's renderer counter and drives the heal write-off, which force-acks and drops pending for the
// reporting window's owned ptys. A real-but-unknown sender (a destroyed workspace window's queued invoke,
// or one not yet handshaken) must NOT resolve to main, or its ack/report would corrupt main-owned
// delivery. Only a senderless event (tests, legacy relays) falls back to main, as in the single-window era.
export function flowStateForSenderEvent(
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
  const onRenderProcessGone = scopedReset
  const onNavigation = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => {
    if (!details.isMainFrame || details.isSameDocument) {
      return
    }
    scopedReset()
  }
  const onDestroyed = (): void => {
    if (activeWindowFlowSession !== session) {
      return
    }
    scopedReset()
    clearDispatcherReadyWatchdog(state)
    clearDeliveryResyncProbe(state)
    session.windowFlowStates.delete(state.webContentsId)
  }
  const { webContents } = state
  webContents.on('render-process-gone', onRenderProcessGone)
  webContents.on('did-start-navigation', onNavigation)
  webContents.on('destroyed', onDestroyed)
  state.detachLifecycleListeners = (): void => {
    webContents.removeListener('render-process-gone', onRenderProcessGone)
    webContents.removeListener('did-start-navigation', onNavigation)
    webContents.removeListener('destroyed', onDestroyed)
  }
  // Why: a workspace window enters tracking mid-session with no navigation reset behind it; the watchdog self-heals a lost handshake.
  armDispatcherReadyWatchdog(session, state)
}

// Why: a re-registration (macOS re-activate builds a fresh session) orphans this session. Retire it so
// its stranded producer pauses don't wedge a surviving project-window PTY, its flush timer stops firing
// against dead bookkeeping, and its workspace webContents listeners (which pin the whole dead session)
// are detached. The activeWindowFlowSession token already makes any late listener a no-op; this frees them.
export function teardownOutgoingWindowFlowStates(session: PtyIpcSession): void {
  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }
  session.producerFlowControl.releaseAll()
  for (const state of session.windowFlowStates.values()) {
    clearDispatcherReadyWatchdog(state)
    clearDeliveryResyncProbe(state)
    state.detachLifecycleListeners?.()
  }
  session.windowFlowStates.clear()
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
