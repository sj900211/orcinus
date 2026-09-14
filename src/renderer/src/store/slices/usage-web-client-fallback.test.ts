import { create } from 'zustand'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AppState } from '../types'
import {
  createClaudeUsageSlice,
  createCodexUsageSlice,
  createOpenCodeUsageSlice
} from './usage-provider-slices'

// Paired web clients resolve unbridged desktop usage calls to undefined.

function stubWebClientFallback(): void {
  const undefinedAsync = vi.fn(() => Promise.resolve(undefined))
  const provider = {
    getScanState: undefinedAsync,
    setEnabled: undefinedAsync,
    getSnapshot: undefinedAsync,
    refresh: undefinedAsync,
    getSummary: undefinedAsync,
    getDaily: undefinedAsync,
    getBreakdown: undefinedAsync,
    getRecentSessions: undefinedAsync
  }
  vi.stubGlobal('window', {
    api: {
      claudeUsage: provider,
      codexUsage: provider,
      openCodeUsage: provider
    }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('usage slices in the web client (preload fallback -> undefined)', () => {
  it('claude: fetch and enable no-op without throwing', async () => {
    stubWebClientFallback()
    const store = create<AppState>()((...args) => createClaudeUsageSlice(...args) as AppState)
    await expect(store.getState().fetchClaudeUsage()).resolves.toBeUndefined()
    await expect(store.getState().enableClaudeUsage()).resolves.toBeUndefined()
    expect(store.getState().claudeUsageScanState).toBeNull()
    expect(store.getState().claudeUsageSummary).toBeNull()
  })

  it('codex: fetch and enable no-op without throwing', async () => {
    stubWebClientFallback()
    const store = create<AppState>()((...args) => createCodexUsageSlice(...args) as AppState)
    await expect(store.getState().fetchCodexUsage()).resolves.toBeUndefined()
    await expect(store.getState().enableCodexUsage()).resolves.toBeUndefined()
    expect(store.getState().codexUsageScanState).toBeNull()
    expect(store.getState().codexUsageSummary).toBeNull()
  })

  it('opencode: fetch and enable no-op without throwing', async () => {
    stubWebClientFallback()
    const store = create<AppState>()((...args) => createOpenCodeUsageSlice(...args) as AppState)
    await expect(store.getState().fetchOpenCodeUsage()).resolves.toBeUndefined()
    await expect(store.getState().enableOpenCodeUsage()).resolves.toBeUndefined()
    expect(store.getState().openCodeUsageScanState).toBeNull()
    expect(store.getState().openCodeUsageSummary).toBeNull()
  })
})

it('defaults all provider scopes to all and normalizes custom ranges', async () => {
  stubWebClientFallback()
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 14, 12))
  try {
    const store = create<AppState>()(
      (...args) =>
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: This test accesses only the initialized usage slices.
        ({
          ...createClaudeUsageSlice(...args),
          ...createCodexUsageSlice(...args),
          ...createOpenCodeUsageSlice(...args)
        }) as AppState
    )
    expect([
      store.getState().claudeUsageScope,
      store.getState().codexUsageScope,
      store.getState().openCodeUsageScope
    ]).toEqual(['all', 'all', 'all'])
    for (const setter of [
      store.getState().setClaudeUsageRange,
      store.getState().setCodexUsageRange,
      store.getState().setOpenCodeUsageRange
    ]) {
      await setter('custom:2026-06-13..2026-09-14')
      await setter('custom:2026-09-14..2026-06-13')
      await setter('custom:invalid')
    }
    expect([
      store.getState().claudeUsageRange,
      store.getState().codexUsageRange,
      store.getState().openCodeUsageRange
    ]).toEqual(Array(3).fill('custom:2026-06-13..2026-09-13'))
  } finally {
    vi.useRealTimers()
  }
})
