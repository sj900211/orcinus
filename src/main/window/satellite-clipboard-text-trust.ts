import type { WebContents } from 'electron'

// Why a separate additional set (satellite editor windows): like the dashboard
// popout, a satellite needs TEXT clipboard only - its authority must not extend
// to image, file, or remote clipboard operations.
const additionalTrustedClipboardTextWebContentsIds = new Set<number>()

export function addTrustedClipboardTextWebContentsId(webContentsId: number): void {
  additionalTrustedClipboardTextWebContentsIds.add(webContentsId)
}

export function removeTrustedClipboardTextWebContentsId(webContentsId: number): void {
  additionalTrustedClipboardTextWebContentsIds.delete(webContentsId)
}

export function isTrustedClipboardTextSatellite(sender: WebContents): boolean {
  return additionalTrustedClipboardTextWebContentsIds.has(sender.id)
}
