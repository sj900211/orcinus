import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerSessionCheckpointRequestListener } from './session-checkpoint-request'

type CheckpointRequestCallback = (args: { requestId: string }) => void

function stubSessionApi(overrides: Partial<Record<'onCheckpointRequest', unknown>> = {}) {
  let requestCallback: CheckpointRequestCallback | null = null
  const unsubscribe = vi.fn()
  const sendCheckpointReply = vi.fn()
  const onCheckpointRequest = vi.fn((callback: CheckpointRequestCallback) => {
    requestCallback = callback
    return unsubscribe
  })
  vi.stubGlobal('window', {
    api: {
      session: {
        onCheckpointRequest,
        sendCheckpointReply,
        ...overrides
      }
    }
  })
  return {
    fireRequest: (requestId: string) => requestCallback?.({ requestId }),
    onCheckpointRequest,
    sendCheckpointReply,
    unsubscribe
  }
}

describe('registerSessionCheckpointRequestListener', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('stages the checkpoint and replies ok with the same requestId', () => {
    const api = stubSessionApi()
    const stage = vi.fn()

    const cleanup = registerSessionCheckpointRequestListener(stage)
    api.fireRequest('req-1')

    expect(stage).toHaveBeenCalledTimes(1)
    expect(api.sendCheckpointReply).toHaveBeenCalledWith({ requestId: 'req-1', ok: true })

    cleanup()
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('replies ok:false when the checkpoint throws so main can degrade instead of hanging', () => {
    const api = stubSessionApi()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stage = vi.fn(() => {
      throw new Error('serialize failed')
    })

    registerSessionCheckpointRequestListener(stage)
    api.fireRequest('req-2')

    expect(api.sendCheckpointReply).toHaveBeenCalledWith({ requestId: 'req-2', ok: false })
    expect(errorSpy).toHaveBeenCalled()
  })

  it('no-ops on a partial session API (web preload, older doubles)', () => {
    vi.stubGlobal('window', { api: { session: {} } })
    const cleanup = registerSessionCheckpointRequestListener(vi.fn())
    expect(() => cleanup()).not.toThrow()
  })
})
