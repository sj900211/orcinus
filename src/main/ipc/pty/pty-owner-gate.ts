// Owner-window adaptation of the fork's per-window hidden-delivery gate
// (expedition 7, B-tier regate): upstream's split delivery modules are
// window-agnostic — they know only the pty id. Resolve the pty's OWNER window
// through the affinity router (main-window fallback) and key the per-window
// gate on it. The full per-window flow-state accounting is the dungeon-3
// re-implant; until then a missing owner degrades to "deliver" (never drop).
import { resolvePtyOwnerWindow } from '../../window/window-affinity-router'
import {
  isHiddenRendererPty,
  markHiddenRendererPty,
  setRendererPtyDeliveryInterest,
  shouldDropHiddenRendererPtyData,
  unmarkHiddenRendererPty
} from '../pty-hidden-delivery-gate'

function ownerWebContentsId(ptyId: string): number | null {
  const window = resolvePtyOwnerWindow(ptyId)
  return window && !window.isDestroyed() ? window.webContents.id : null
}

export function isHiddenRendererPtyForOwner(id: string): boolean {
  const webContentsId = ownerWebContentsId(id)
  return webContentsId === null ? false : isHiddenRendererPty(webContentsId, id)
}

export function markHiddenRendererPtyForOwner(id: string): void {
  const webContentsId = ownerWebContentsId(id)
  if (webContentsId !== null) {
    markHiddenRendererPty(webContentsId, id)
  }
}

export function unmarkHiddenRendererPtyForOwner(
  id: string
): ReturnType<typeof unmarkHiddenRendererPty> {
  const webContentsId = ownerWebContentsId(id)
  return webContentsId === null
    ? { droppedWhileHidden: false }
    : unmarkHiddenRendererPty(webContentsId, id)
}

export function setRendererPtyDeliveryInterestForOwner(id: string, interested: boolean): void {
  const webContentsId = ownerWebContentsId(id)
  if (webContentsId !== null) {
    setRendererPtyDeliveryInterest(webContentsId, id, interested)
  }
}

export function shouldDropHiddenRendererPtyDataForOwner(
  id: string,
  settings: Parameters<typeof shouldDropHiddenRendererPtyData>[2]
): boolean {
  const webContentsId = ownerWebContentsId(id)
  return webContentsId === null ? false : shouldDropHiddenRendererPtyData(webContentsId, id, settings)
}
