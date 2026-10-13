// Why electron-free: orcad bundles the PTY write path, which checks this trust on plain Node.
import type { WebContents } from 'electron'

let trustedUIRendererWebContentsId: number | null = null
// Why: workspace windows are equally privileged app UI, but the primary id keeps
// exclusive ownership of sendToTrustedUIRenderer targeting.
const additionalTrustedUIRendererWebContentsIds = new Set<number>()

export function getTrustedUIRendererWebContentsId(): number | null {
  return trustedUIRendererWebContentsId
}

export function setTrustedUIRendererWebContentsId(webContentsId: number | null): void {
  trustedUIRendererWebContentsId = webContentsId
}

export function clearTrustedUIRendererWebContentsId(webContentsId: number): void {
  if (trustedUIRendererWebContentsId === webContentsId) {
    trustedUIRendererWebContentsId = null
  }
}

export function addTrustedUIRendererWebContentsId(webContentsId: number): void {
  additionalTrustedUIRendererWebContentsIds.add(webContentsId)
}

export function removeTrustedUIRendererWebContentsId(webContentsId: number): void {
  additionalTrustedUIRendererWebContentsIds.delete(webContentsId)
}

export function isTrustedUIRenderer(sender: WebContents): boolean {
  if (sender.isDestroyed() || sender.getType() !== 'window') {
    return false
  }
  if (additionalTrustedUIRendererWebContentsIds.has(sender.id)) {
    return true
  }
  if (trustedUIRendererWebContentsId != null) {
    return sender.id === trustedUIRendererWebContentsId
  }

  const senderUrl = sender.getURL()
  if (process.env.ELECTRON_RENDERER_URL) {
    try {
      return new URL(senderUrl).origin === new URL(process.env.ELECTRON_RENDERER_URL).origin
    } catch {
      return false
    }
  }

  // Why: packaged fallback must be tied to the created main window id, not any
  // file:// document that can obtain this IPC channel.
  return false
}
