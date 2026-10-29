import type { WebContents } from 'electron'
import { isDashboardPopoutRenderer } from './dashboard-popout-window'

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

// Why here (not clipboard-ipc-handlers.ts): that file sits at its max-lines cap.
/** Text-only clipboard senders: the exact dashboard popout and satellite editor windows. */
export function isClipboardTextOnlyRenderer(sender: WebContents): boolean {
  return (
    isDashboardPopoutRenderer(sender) || additionalTrustedClipboardTextWebContentsIds.has(sender.id)
  )
}
