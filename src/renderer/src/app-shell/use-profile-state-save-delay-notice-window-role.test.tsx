// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const notice = vi.hoisted(() => ({ warning: vi.fn(), dismiss: vi.fn() }))
vi.mock('sonner', () => ({ toast: notice }))
vi.mock('@/i18n/i18n', () => ({ translate: (_key: string, fallback: string) => fallback }))

import { useProfileStateSaveDelayNotice } from './use-profile-state-save-delay-notice'

const subscribe = vi.fn(() => () => {})
const read = vi.fn(() => Promise.resolve(true))

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { app: { isProfileStateSaveDelayed: read, onProfileStateSaveDelayChanged: subscribe } }
  })
})
afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

// Fork: main clears the warning only in the primary window, so a project window must never show it.
it('stays silent in a project window', () => {
  window.history.replaceState(null, '', '/?orca-project=repo-1')
  renderHook(useProfileStateSaveDelayNotice)
  expect(subscribe).not.toHaveBeenCalled()
  expect(read).not.toHaveBeenCalled()
})

it('listens in the main window', () => {
  renderHook(useProfileStateSaveDelayNotice)
  expect(subscribe).toHaveBeenCalledOnce()
  expect(read).toHaveBeenCalledOnce()
})
