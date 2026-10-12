import { randomUUID } from 'node:crypto'

import { ipcMain } from 'electron'
import type { BrowserWindow } from 'electron'
import type {
  TerminalTabCloseRequest,
  TerminalTabCloseResponse
} from '../../shared/terminal-tab-close'

const TERMINAL_TAB_CLOSE_TIMEOUT_MS = 20_000

// Why multiple windows: a terminal tab lives in exactly one app window but the runtime only
// knows the tabId — broadcast the request; windows without the tab never reply.
export async function requestTerminalTabCloseFromRenderer(
  windows: readonly BrowserWindow[],
  tabId: string,
  options: { localPtyTeardownOwnedExternally?: boolean; force?: boolean } = {}
): Promise<void> {
  // Why capture webContents up front: a closed window can make the getter throw, so the
  // teardown after a close must use the reference taken while the window was still alive.
  const targets = windows
    .filter((window) => !window.isDestroyed() && !window.webContents.isDestroyed())
    .map((window) => ({ window, webContents: window.webContents }))
  if (targets.length === 0) {
    throw new Error('renderer_unavailable')
  }
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const targetWebContents = new Set(targets.map((target) => target.webContents))
    const lostListeners = new Map<(typeof targets)[number], () => void>()
    const lost = new Set<Electron.WebContents>()
    let settled = false
    const finish = (error?: Error): void => {
      if (settled) {
        return
      }
      settled = true
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      for (const [target, onLost] of lostListeners) {
        if (typeof target.window.removeListener === 'function') {
          target.window.removeListener('closed', onLost)
        }
        if (typeof target.webContents.removeListener === 'function') {
          target.webContents.removeListener('destroyed', onLost)
          target.webContents.removeListener('render-process-gone', onLost)
        }
      }
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    }
    const timeout = setTimeout(
      () => finish(new Error('terminal_tab_close_timeout')),
      TERMINAL_TAB_CLOSE_TIMEOUT_MS
    )
    const onResponse = (event: Electron.IpcMainEvent, response: TerminalTabCloseResponse): void => {
      // Why: request IDs are visible to renderer code; only a targeted app
      // window may commit or reject its lifecycle transaction.
      if (!targetWebContents.has(event.sender) || response.requestId !== requestId) {
        return
      }
      if (response.error) {
        finish(new Error(response.error))
      } else {
        finish()
      }
    }
    ipcMain.on('ui:terminalTabCloseResponse', onResponse)
    for (const target of targets) {
      const onLost = (): void => {
        lost.add(target.webContents)
        // Why count instead of rejecting on the first loss: one window closing never ends the
        // transaction — the tab's owner may be another window. Only losing every target does.
        if (lost.size >= targets.length) {
          finish(new Error('renderer_unavailable'))
        }
      }
      lostListeners.set(target, onLost)
      if (typeof target.window.once === 'function') {
        target.window.once('closed', onLost)
      }
      if (typeof target.webContents.once === 'function') {
        target.webContents.once('destroyed', onLost)
        target.webContents.once('render-process-gone', onLost)
      }
    }
    const request: TerminalTabCloseRequest = { requestId, tabId, ...options }
    let delivered = false
    for (const target of targets) {
      try {
        target.webContents.send('ui:terminalTabCloseRequest', request)
        delivered = true
      } catch {
        // Why: one disposed frame must not cancel the broadcast — another window may own the tab.
      }
    }
    if (!delivered) {
      finish(new Error('renderer_unavailable'))
    }
  })
}
