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
  options: { localPtyTeardownOwnedExternally?: boolean } = {}
): Promise<void> {
  const targets = windows.filter(
    (window) => !window.isDestroyed() && !window.webContents.isDestroyed()
  )
  if (targets.length === 0) {
    throw new Error('renderer_unavailable')
  }
  const requestId = randomUUID()
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      reject(new Error('terminal_tab_close_timeout'))
    }, TERMINAL_TAB_CLOSE_TIMEOUT_MS)
    const targetWebContents = new Set(targets.map((window) => window.webContents))
    const onResponse = (event: Electron.IpcMainEvent, response: TerminalTabCloseResponse): void => {
      // Why: request IDs are visible to renderer code; only a targeted app
      // window may commit or reject its lifecycle transaction.
      if (!targetWebContents.has(event.sender) || response.requestId !== requestId) {
        return
      }
      clearTimeout(timeout)
      ipcMain.removeListener('ui:terminalTabCloseResponse', onResponse)
      if (response.error) {
        reject(new Error(response.error))
      } else {
        resolve()
      }
    }
    ipcMain.on('ui:terminalTabCloseResponse', onResponse)
    const request: TerminalTabCloseRequest = { requestId, tabId, ...options }
    for (const window of targets) {
      try {
        window.webContents.send('ui:terminalTabCloseRequest', request)
      } catch {
        // Why: one disposed frame must not cancel the broadcast — another window may own the tab.
      }
    }
  })
}
