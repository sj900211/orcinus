/**
 * Main-side hidden-delivery gate for renderer PTY byte delivery (Phase 4 of
 * the terminal model/view architecture).
 *
 * The renderer marks a PTY hidden when no visible view consumes its bytes;
 * main then drops renderer-bound delivery AFTER model ingestion — the runtime
 * already parsed the chunk, and reveal restores from the model snapshot via
 * the existing seq-guarded machinery. Any renderer party that still needs raw
 * bytes (dispatcher sidecars) registers delivery
 * interest, which suppresses the gate for that PTY.
 *
 * Hidden/interest marks are keyed by the reporting window's webContentsId so
 * one window's reload cannot clear another window's marks; delivery decisions
 * consult the PTY's owner window (see window-affinity-router).
 */
import type { GlobalSettings } from '../../shared/global-settings-types'

export type HiddenPtyDeliveryGateSettings = Pick<
  GlobalSettings,
  'terminalMainSideEffectAuthority' | 'terminalHiddenDeliveryGate'
>

const hiddenRendererPtysByWebContents = new Map<number, Set<string>>()
// Why: sidecar consumers (paste-draft pacing, background agent launches,
// automation observers) need live bytes even while no visible view exists. Any
// registered interest in the owner window suppresses the gate for that PTY.
const deliveryInterestRendererPtysByWebContents = new Map<number, Set<string>>()
// Why: reveal must restore from the model only when bytes were actually
// dropped. Doubles as the one-shot marker latch: the first gated drop emits a
// restore marker, and the latch is consumed only by unmark (which re-emits)
// or full PTY teardown — never by re-marking hidden, so drop memory survives
// hidden remounts and renderer reloads. Kept global: it records PTY history,
// not renderer state.
const droppedSinceHiddenPtys = new Set<string>()

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

/** Gate kill switches, both read main-side: the gate only operates under main
 *  side-effect authority AND the gate-specific setting (both default on). */
export function isHiddenPtyDeliveryGateEnabled(
  settings: HiddenPtyDeliveryGateSettings | null | undefined
): boolean {
  return (
    settings?.terminalMainSideEffectAuthority !== false &&
    settings?.terminalHiddenDeliveryGate !== false
  )
}

/** Renderer-reported "no visible view needs bytes" bit for one window. Never
 *  clears drop memory: a hidden remount or renderer reload re-marks an
 *  already-dropped PTY, and erasing the latch there would make the eventual
 *  reveal skip the restore. Unmark is the only consumer of the latch. */
export function markHiddenRendererPty(webContentsId: number, id: string): void {
  windowSet(hiddenRendererPtysByWebContents, webContentsId).add(id)
}

/** Clears the window's hidden bit. Returns whether bytes were dropped while
 *  hidden so the caller can emit a restore marker to the now-visible renderer. */
export function unmarkHiddenRendererPty(
  webContentsId: number,
  id: string
): { droppedWhileHidden: boolean } {
  deleteFromWindowSet(hiddenRendererPtysByWebContents, webContentsId, id)
  const droppedWhileHidden = droppedSinceHiddenPtys.delete(id)
  return { droppedWhileHidden }
}

export function isHiddenRendererPty(webContentsId: number, id: string): boolean {
  return hiddenRendererPtysByWebContents.get(webContentsId)?.has(id) ?? false
}

/** For teardown/diagnostics: whether any window still holds a hidden mark for this PTY. */
export function isHiddenRendererPtyInAnyWindow(id: string): boolean {
  for (const set of hiddenRendererPtysByWebContents.values()) {
    if (set.has(id)) {
      return true
    }
  }
  return false
}

/** For freeze diagnostics only: hidden ptys (in any window) must appear in the
 *  per-pty report table even when the gate dropped every byte before any
 *  send/accounting. */
export function getHiddenRendererPtyIds(): string[] {
  const ids = new Set<string>()
  for (const set of hiddenRendererPtysByWebContents.values()) {
    for (const id of set) {
      ids.add(id)
    }
  }
  return [...ids]
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
    (hiddenRendererPtysByWebContents.get(webContentsId)?.has(id) ?? false) &&
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

/** Record one gated drop. Returns whether the caller should emit the one-shot
 *  empty restore-marker chunk (first drop since this PTY went hidden). */
export function recordHiddenRendererPtyDataDrop(
  id: string,
  chars: number
): { shouldEmitRestoreMarker: boolean } {
  droppedHiddenDeliveryChars += chars
  droppedHiddenDeliveryChunks += 1
  if (droppedSinceHiddenPtys.has(id)) {
    return { shouldEmitRestoreMarker: false }
  }
  droppedSinceHiddenPtys.add(id)
  return { shouldEmitRestoreMarker: true }
}

/** One window's renderer process replaced (reload / crash): its ref-counted
 *  interest holds and hidden marks died with it, so keeping them would gate
 *  (or force-feed) PTYs no live renderer party asked about. Other windows'
 *  marks stay. Drop memory is preserved — surviving daemon/SSH PTYs may have
 *  dropped bytes the old renderer never restored; the new renderer's first
 *  hidden/visible sync re-marks or unmarks and the unmark path re-emits the
 *  restore marker. */
export function resetRendererScopedHiddenPtyDeliveryState(webContentsId: number): void {
  hiddenRendererPtysByWebContents.delete(webContentsId)
  deliveryInterestRendererPtysByWebContents.delete(webContentsId)
}

/** Full per-PTY teardown — wired into clearProviderPtyState so every exit
 *  path (local, daemon, SSH, connection teardown) releases gate state in
 *  every window. */
export function clearHiddenRendererPtyDeliveryState(id: string): void {
  // Deleting the visited entry mid-iteration is safe for Map iterators.
  for (const webContentsId of hiddenRendererPtysByWebContents.keys()) {
    deleteFromWindowSet(hiddenRendererPtysByWebContents, webContentsId, id)
  }
  for (const webContentsId of deliveryInterestRendererPtysByWebContents.keys()) {
    deleteFromWindowSet(deliveryInterestRendererPtysByWebContents, webContentsId, id)
  }
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
    hiddenDeliveryGatedPtyCount: countDistinct(hiddenRendererPtysByWebContents),
    deliveryInterestPtyCount: countDistinct(deliveryInterestRendererPtysByWebContents),
    hiddenDeliveryDroppedChars: droppedHiddenDeliveryChars,
    hiddenDeliveryDroppedChunks: droppedHiddenDeliveryChunks
  }
}

export function resetHiddenRendererPtyDeliveryDebugCounters(): void {
  droppedHiddenDeliveryChars = 0
  droppedHiddenDeliveryChunks = 0
}

/** Test seam: reset all module state between tests. */
export function _resetHiddenRendererPtyDeliveryGateForTest(): void {
  hiddenRendererPtysByWebContents.clear()
  deliveryInterestRendererPtysByWebContents.clear()
  droppedSinceHiddenPtys.clear()
  resetHiddenRendererPtyDeliveryDebugCounters()
}
