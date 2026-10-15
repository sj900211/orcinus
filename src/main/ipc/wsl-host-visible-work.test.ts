import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ handle: vi.fn() }))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: mocks.handle, removeHandler: vi.fn() }
}))

import { registerWslHostHandlers } from './wsl-host-handlers'
import { channelHandlerLookup } from './runtime-environments-ipc-test-harness'
import { setWslHostService } from '../wsl/wsl-host-service-instance'

const handler = channelHandlerLookup(mocks.handle)

function sender(id: number): { sender: EventEmitter & { id: number } } {
  return { sender: Object.assign(new EventEmitter(), { id }) }
}

function register(): void {
  registerWslHostHandlers({
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a running service is preset, so the args are never read.
    store: {} as never,
    getUserDataPath: () => '',
    invalidateTransport: vi.fn()
  })
}

describe('wslHosts:setVisibleWork', () => {
  afterEach(() => {
    setWslHostService(null)
    mocks.handle.mockReset()
  })

  it('merges every window report and forgets a destroyed window', async () => {
    const setVisibleWork = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the handler under test calls only setVisibleWork.
    setWslHostService({ setVisibleWork } as never)
    register()
    const report = handler<{ environmentIds: string[] }, void>('wslHosts:setVisibleWork')
    const first = sender(1)

    await report(first, { environmentIds: ['wsl:a'] })
    await report(sender(2), { environmentIds: [] })
    expect(setVisibleWork).toHaveBeenLastCalledWith(['wsl:a'])

    // Re-registering (a recreated main window) must keep the reports of windows still open.
    mocks.handle.mockReset()
    register()
    await handler<{ environmentIds: string[] }, void>('wslHosts:setVisibleWork')(sender(2), {
      environmentIds: []
    })
    expect(setVisibleWork).toHaveBeenLastCalledWith(['wsl:a'])

    first.sender.emit('destroyed')
    expect(setVisibleWork).toHaveBeenLastCalledWith([])
  })
})
