// Per-recipient satellite mirror broadcast (split from satellite-window.ts
// for the max-lines rule). Each app window receives only ITS satellites —
// the mirror drives that parent's open-interception and menu gating.
import type { BrowserWindow } from 'electron'
import type { SatelliteMirrorEntry } from '../../shared/satellite-window-payloads'
import { listSatellitesForParent } from '../window/satellite-window-registry'
import { listAppWindows } from '../window/window-affinity-router'

/**
 * Per-recipient mirror: each app window receives only ITS satellites — the
 * mirror drives that parent's open-interception and menu gating, and other
 * windows have no use for it.
 */
export function buildMirrorEntriesFor(target: BrowserWindow): SatelliteMirrorEntry[] {
  return listSatellitesForParent(target).map((record) => ({
    satelliteId: record.satelliteId,
    worktreeId: record.worktreeId,
    // Why flag-derived (not isVisible()): a booting satellite is invisible but
    // functional, and win32 reports minimized windows as visible — the mirror
    // contract is "hidden by subordination", which only the flags encode.
    visible: !record.hiddenByWorkspaceSwitch && !record.hiddenWithParent,
    files: record.files
  }))
}

export function sendMirrorTo(target: BrowserWindow): void {
  if (target.isDestroyed() || target.webContents.isDestroyed()) {
    return
  }
  const entries = buildMirrorEntriesFor(target)
  try {
    target.webContents.send('satelliteWindow:mirrorChanged', entries)
  } catch {
    // Why: a frame disposed mid-send must not fail the registry mutation that triggered the broadcast.
  }
}

export function broadcastMirror(): void {
  for (const target of listAppWindows()) {
    sendMirrorTo(target)
  }
}
