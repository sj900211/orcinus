/** Drop hidden renderer delivery after model ingestion; reveal restores a snapshot, while sidecar interest keeps raw bytes flowing. */
import type { GlobalSettings } from '../../shared/global-settings-types'

export type HiddenPtyDeliveryGateSettings = Pick<
  GlobalSettings,
  'terminalMainSideEffectAuthority' | 'terminalHiddenDeliveryGate'
>

// Fork: hidden/interest marks are keyed by the reporting window's webContentsId so one window's reload cannot
// clear another's; delivery decisions consult the PTY's owner window (window-affinity-router).
const hiddenRendererPtysByWebContents = new Map<number, Set<string>>()
// Sidecar consumers need live bytes even without a visible terminal view; interest in the owner window suppresses its gate.
const deliveryInterestRendererPtysByWebContents = new Map<number, Set<string>>()
// Keep drop memory until painted-restore ACK or teardown; reveal markers may reach no handler.
// Drops after reveal start a new episode so an older snapshot ACK cannot retire a newer gap.
// Kept global: it records PTY history, not renderer state.
const droppedSinceHiddenPtys = new Map<
  string,
  { state: 'unrevealed' | 'awaiting-paint'; episode: number }
>()
let nextHiddenDropEpisode = 1
// Runtime spawns have no view to re-mark them after reload; retain their mark until visible mount or teardown.
// Fork: kept window-independent rather than shadowed into a hidden set and re-added after reset, so per-window resets cannot clear them.
const runtimeOwnedHiddenRendererPtys = new Set<string>()

let droppedHiddenDeliveryChars = 0
let droppedHiddenDeliveryChunks = 0

function windowSet(map: Map<number, Set<string>>, webContentsId: number): Set<string> {
  let set = map.get(webContentsId)
  if (!set) {
    set = new Set()
    map.set(webContentsId, set)
  }
  return set
}

function deleteFromWindowSet(
  map: Map<number, Set<string>>,
  webContentsId: number,
  id: string
): boolean {
  const set = map.get(webContentsId)
  if (!set?.delete(id)) {
    return false
  }
  if (set.size === 0) {
    map.delete(webContentsId)
  }
  return true
}

function countDistinct(map: Map<number, Set<string>>): number {
  const ids = new Set<string>()
  for (const set of map.values()) {
    for (const id of set) {
      ids.add(id)
    }
  }
  return ids.size
}

/** Every hidden PTY: marks held by any window, plus the window-independent
 *  runtime-owned ones. */
function collectHiddenPtyIds(): Set<string> {
  const ids = new Set<string>(runtimeOwnedHiddenRendererPtys)
  for (const set of hiddenRendererPtysByWebContents.values()) {
    for (const id of set) {
      ids.add(id)
    }
  }
  return ids
}

export function isHiddenPtyDeliveryGateEnabled(
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    settings?.terminalMainSideEffectAuthority !== false &&
    settings?.terminalHiddenDeliveryGate !== false
  )
}

/** Re-marking in one window must preserve drop memory across hidden remounts and renderer reloads. */
export function markHiddenRendererPty(webContentsId: number, id: string): void {
  windowSet(hiddenRendererPtysByWebContents, webContentsId).add(id)
}

/** Reveal in one window reads the latch without retiring it: the marker may reach no handler. */
export function unmarkHiddenRendererPty(
  webContentsId: number,
  id: string
): { droppedWhileHidden: boolean; hiddenDropEpisode?: number } {
  deleteFromWindowSet(hiddenRendererPtysByWebContents, webContentsId, id)
  // A renderer unmark means a view exists now, so the runtime-owned mark is spent.
  runtimeOwnedHiddenRendererPtys.delete(id)
  const latch = droppedSinceHiddenPtys.get(id)
  if (!latch) {
    return { droppedWhileHidden: false }
  }
  latch.state = 'awaiting-paint'
  return { droppedWhileHidden: true, hiddenDropEpisode: latch.episode }
}

/** Only a painted-restore ACK for the revealed episode can retire its drop memory. */
export function consumeHiddenRendererPtyDropMemory(id: string, hiddenDropEpisode?: number): void {
  const latch = droppedSinceHiddenPtys.get(id)
  if (latch?.state === 'awaiting-paint' && latch.episode === hiddenDropEpisode) {
    droppedSinceHiddenPtys.delete(id)
  }
}

export function isHiddenRendererPty(webContentsId: number, id: string): boolean {
  return (
    (hiddenRendererPtysByWebContents.get(webContentsId)?.has(id) ?? false) ||
    runtimeOwnedHiddenRendererPtys.has(id)
  )
}

export function markRuntimeOwnedHiddenRendererPty(id: string): void {
  runtimeOwnedHiddenRendererPtys.add(id)
}

export function isRuntimeOwnedHiddenRendererPty(id: string): boolean {
  return runtimeOwnedHiddenRendererPtys.has(id)
}

/** For teardown/diagnostics: whether any window still holds a hidden mark for
 *  this PTY, or the runtime holds one on no window's behalf. */
export function isHiddenRendererPtyInAnyWindow(id: string): boolean {
  if (runtimeOwnedHiddenRendererPtys.has(id)) {
    return true
  }
  for (const set of hiddenRendererPtysByWebContents.values()) {
    if (set.has(id)) {
      return true
    }
  }
  return false
}

/** Include hidden PTYs from any window in diagnostics even when all bytes were dropped before send accounting. */
export function getHiddenRendererPtyIds(): string[] {
  return [...collectHiddenPtyIds()]
}

/** Renderer-side ref-counted interest, surfaced as boolean transitions. */
export function setRendererPtyDeliveryInterest(
  webContentsId: number,
  id: string,
  interested: boolean
): void {
  if (interested) {
    windowSet(deliveryInterestRendererPtysByWebContents, webContentsId).add(id)
  } else {
    deleteFromWindowSet(deliveryInterestRendererPtysByWebContents, webContentsId, id)
  }
}

export function shouldDropHiddenRendererPtyData(
  webContentsId: number,
  id: string,
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    isHiddenPtyDeliveryGateEnabled(settings) &&
    isHiddenRendererPty(webContentsId, id) &&
    !(deliveryInterestRendererPtysByWebContents.get(webContentsId)?.has(id) ?? false)
  )
}

/** Union across windows — for callers with no owner window in scope (query authority on a windowless app). */
export function shouldDropHiddenRendererPtyDataInAnyWindow(
  id: string,
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  if (!isHiddenPtyDeliveryGateEnabled(settings) || !isHiddenRendererPtyInAnyWindow(id)) {
    return false
  }
  for (const set of deliveryInterestRendererPtysByWebContents.values()) {
    if (set.has(id)) {
      return false
    }
  }
  return true
}

/** Request a restore marker on the first drop after retirement or reveal. */
export function recordHiddenRendererPtyDataDrop(
  id: string,
  chars: number
): { shouldEmitRestoreMarker: boolean; hiddenDropEpisode: number } {
  droppedHiddenDeliveryChars += chars
  droppedHiddenDeliveryChunks += 1
  const latch = droppedSinceHiddenPtys.get(id)
  if (latch?.state === 'unrevealed') {
    return { shouldEmitRestoreMarker: false, hiddenDropEpisode: latch.episode }
  }
  const episode = nextHiddenDropEpisode++
  droppedSinceHiddenPtys.set(id, { state: 'unrevealed', episode })
  return { shouldEmitRestoreMarker: true, hiddenDropEpisode: episode }
}

export function hiddenRendererPtyDropEpisode(id: string): number | undefined {
  return droppedSinceHiddenPtys.get(id)?.episode
}

/** One window's reload clears its renderer-owned marks/interest; other windows' marks, runtime marks and unrestored drop episodes must survive. */
export function resetRendererScopedHiddenPtyDeliveryState(webContentsId?: number): void {
  // Why optional: handler re-registration (tests) clears EVERY window's state.
  if (webContentsId === undefined) {
    hiddenRendererPtysByWebContents.clear()
    deliveryInterestRendererPtysByWebContents.clear()
    return
  }
  hiddenRendererPtysByWebContents.delete(webContentsId)
  deliveryInterestRendererPtysByWebContents.delete(webContentsId)
}

export function clearHiddenRendererPtyDeliveryState(id: string): void {
  // Deleting the visited entry mid-iteration is safe for Map iterators.
  for (const webContentsId of hiddenRendererPtysByWebContents.keys()) {
    deleteFromWindowSet(hiddenRendererPtysByWebContents, webContentsId, id)
  }
  for (const webContentsId of deliveryInterestRendererPtysByWebContents.keys()) {
    deleteFromWindowSet(deliveryInterestRendererPtysByWebContents, webContentsId, id)
  }
  runtimeOwnedHiddenRendererPtys.delete(id)
  droppedSinceHiddenPtys.delete(id)
}

export type HiddenRendererPtyDeliveryDebug = {
  hiddenDeliveryGatedPtyCount: number
  deliveryInterestPtyCount: number
  hiddenDeliveryDroppedChars: number
  hiddenDeliveryDroppedChunks: number
}

export function getHiddenRendererPtyDeliveryDebug(): HiddenRendererPtyDeliveryDebug {
  return {
    hiddenDeliveryGatedPtyCount: collectHiddenPtyIds().size,
    deliveryInterestPtyCount: countDistinct(deliveryInterestRendererPtysByWebContents),
    hiddenDeliveryDroppedChars: droppedHiddenDeliveryChars,
    hiddenDeliveryDroppedChunks: droppedHiddenDeliveryChunks
  }
}

export function resetHiddenRendererPtyDeliveryDebugCounters(): void {
  droppedHiddenDeliveryChars = 0
  droppedHiddenDeliveryChunks = 0
}

export function _resetHiddenRendererPtyDeliveryGateForTest(): void {
  hiddenRendererPtysByWebContents.clear()
  deliveryInterestRendererPtysByWebContents.clear()
  runtimeOwnedHiddenRendererPtys.clear()
  droppedSinceHiddenPtys.clear()
  resetHiddenRendererPtyDeliveryDebugCounters()
}
