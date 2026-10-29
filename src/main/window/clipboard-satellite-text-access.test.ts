import { beforeEach, describe, expect, it, vi } from 'vitest'

const { handlers, clipboardReadText, clipboardWriteText, clipboardReadImage } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  clipboardReadText: vi.fn(() => 'satellite clipboard text'),
  clipboardWriteText: vi.fn(),
  clipboardReadImage: vi.fn()
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp'), commandLine: { getSwitchValue: vi.fn(() => 'x11') } },
  clipboard: {
    readText: clipboardReadText,
    readBuffer: vi.fn(),
    writeText: clipboardWriteText,
    readImage: clipboardReadImage,
    writeImage: vi.fn(),
    writeBuffer: vi.fn()
  },
  ipcMain: {
    removeHandler: (channel: string) => handlers.delete(channel),
    handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
      handlers.set(channel, handler)
  },
  nativeImage: { createFromBuffer: vi.fn() }
}))

vi.mock('./dashboard-popout-window', () => ({ isDashboardPopoutRenderer: () => false }))
vi.mock('./clipboard-remote-file-copy', () => ({
  cleanupExpiredRemoteClipboardFiles: vi.fn(async () => undefined),
  scheduleLegacyRemoteClipboardFileCleanup: vi.fn()
}))

import {
  registerClipboardHandlers,
  setTrustedClipboardRendererWebContentsId
} from './clipboard-ipc-handlers'
import {
  addTrustedClipboardTextWebContentsId,
  removeTrustedClipboardTextWebContentsId
} from './satellite-clipboard-text-trust'

const satelliteEvent = {
  sender: {
    id: 42,
    isDestroyed: () => false,
    getType: () => 'window',
    getURL: () => 'file:///editor.html'
  }
}
const UNAUTHORIZED = 'Unauthorized clipboard IPC sender'

describe('satellite editor clipboard access', () => {
  beforeEach(() => {
    handlers.clear()
    vi.clearAllMocks()
    clipboardReadText.mockReturnValue('satellite clipboard text')
    removeTrustedClipboardTextWebContentsId(42)
    setTrustedClipboardRendererWebContentsId(17)
    registerClipboardHandlers({} as never)
  })

  it('allows text copy and paste only while the satellite is registered', async () => {
    await expect(handlers.get('clipboard:readText')?.(satelliteEvent)).rejects.toThrow(UNAUTHORIZED)

    addTrustedClipboardTextWebContentsId(42)
    await expect(handlers.get('clipboard:readText')?.(satelliteEvent)).resolves.toBe(
      'satellite clipboard text'
    )
    await expect(
      handlers.get('clipboard:writeText')?.(satelliteEvent, 'copied path')
    ).resolves.toBeUndefined()
    expect(clipboardWriteText).toHaveBeenCalledWith('copied path')

    removeTrustedClipboardTextWebContentsId(42)
    await expect(handlers.get('clipboard:readText')?.(satelliteEvent)).rejects.toThrow(UNAUTHORIZED)
  })

  it('does not extend satellite authority to image or file clipboard APIs', async () => {
    addTrustedClipboardTextWebContentsId(42)
    await expect(handlers.get('clipboard:saveImageAsTempFile')?.(satelliteEvent)).rejects.toThrow(
      UNAUTHORIZED
    )
    expect(() => handlers.get('clipboard:readFilePaths')?.(satelliteEvent)).toThrow(UNAUTHORIZED)
    expect(clipboardReadImage).not.toHaveBeenCalled()
  })
})
