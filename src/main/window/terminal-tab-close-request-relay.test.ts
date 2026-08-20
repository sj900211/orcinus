import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const ipcEmitter = new EventEmitter()
const ipcMainMock = {
  on: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcEmitter.on(channel, listener)
  }),
  removeListener: vi.fn((channel: string, listener: (...args: unknown[]) => void) => {
    ipcEmitter.removeListener(channel, listener)
  })
}

vi.mock('electron', () => ({ ipcMain: ipcMainMock }))

function createWindow() {
  const webContents = { isDestroyed: () => false, send: vi.fn() }
  return { isDestroyed: () => false, webContents }
}

describe('requestTerminalTabCloseFromRenderer', () => {
  beforeEach(() => {
    ipcEmitter.removeAllListeners()
    ipcMainMock.on.mockClear()
    ipcMainMock.removeListener.mockClear()
  })

  it('waits for a targeted renderer durability acknowledgement', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const mainWindow = createWindow()
    const otherWebContents = {}
    const pending = requestTerminalTabCloseFromRenderer([mainWindow] as never, 'tab-1', {
      localPtyTeardownOwnedExternally: true
    })
    const request = mainWindow.webContents.send.mock.calls[0]?.[1] as {
      requestId: string
      tabId: string
      localPtyTeardownOwnedExternally?: boolean
    }

    expect(request.tabId).toBe('tab-1')
    expect(request.localPtyTeardownOwnedExternally).toBe(true)
    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: otherWebContents },
      { requestId: request.requestId }
    )
    let settled = false
    void pending.finally(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: mainWindow.webContents },
      { requestId: request.requestId }
    )
    await expect(pending).resolves.toBeUndefined()
  })

  it('propagates renderer cancellation instead of reporting success', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const mainWindow = createWindow()
    const pending = requestTerminalTabCloseFromRenderer([mainWindow] as never, 'tab-pinned')
    const request = mainWindow.webContents.send.mock.calls[0]?.[1] as { requestId: string }

    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: mainWindow.webContents },
      { requestId: request.requestId, error: 'terminal_tab_pinned' }
    )

    await expect(pending).rejects.toThrow('terminal_tab_pinned')
  })

  it('broadcasts one request to every app window and accepts whichever owns the tab', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')
    const mainWindow = createWindow()
    const workspaceWindow = createWindow()
    const pending = requestTerminalTabCloseFromRenderer(
      [mainWindow, workspaceWindow] as never,
      'tab-ws'
    )
    const mainRequest = mainWindow.webContents.send.mock.calls[0]?.[1] as { requestId: string }
    const workspaceRequest = workspaceWindow.webContents.send.mock.calls[0]?.[1] as {
      requestId: string
    }

    // One transaction: both windows see the same requestId; the non-owner never replies.
    expect(workspaceRequest.requestId).toBe(mainRequest.requestId)
    ipcEmitter.emit(
      'ui:terminalTabCloseResponse',
      { sender: workspaceWindow.webContents },
      { requestId: workspaceRequest.requestId }
    )

    await expect(pending).resolves.toBeUndefined()
  })

  it('rejects when no live app window exists', async () => {
    const { requestTerminalTabCloseFromRenderer } =
      await import('./terminal-tab-close-request-relay')

    await expect(requestTerminalTabCloseFromRenderer([], 'tab-none')).rejects.toThrow(
      'renderer_unavailable'
    )
  })
})
