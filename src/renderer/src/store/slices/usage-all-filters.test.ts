import { afterEach, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import type { AppState } from '../types'
import {
  createClaudeUsageSlice,
  createCodexUsageSlice,
  createOpenCodeUsageSlice
} from './usage-provider-slices'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([1, 2])('discards a delayed Claude 30d snapshot at fetch stage %i', async (stage) => {
  const scanState = { enabled: true, lastScanCompletedAt: 1 }
  const snapshot = (range: string) => ({
    scope: 'all',
    range,
    scanState,
    summary: { range },
    daily: [],
    modelBreakdown: [],
    projectBreakdown: [],
    recentSessions: []
  })
  const delayed = Promise.withResolvers<ReturnType<typeof snapshot>>()
  const started = Promise.withResolvers<void>()
  let oldRequests = 0
  const api = {
    getScanState: vi.fn().mockResolvedValue(scanState),
    getSnapshot: vi.fn(async ({ range }: { range: string }) => snapshot(range)),
    refresh: vi.fn().mockResolvedValue(scanState)
  }
  vi.stubGlobal('window', {
    api: {
      codexUsage: api,
      openCodeUsage: api,
      claudeUsage: {
        ...api,
        getSnapshot: vi.fn(({ range }: { range: string }) => {
          if (range === '30d' && ++oldRequests === stage) {
            started.resolve()
            return delayed.promise
          }
          return Promise.resolve(snapshot(range))
        })
      }
    }
  })
  const store = create<AppState>()(
    (...args) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only initialized usage slices are accessed.
      ({
        ...createClaudeUsageSlice(...args),
        ...createCodexUsageSlice(...args),
        ...createOpenCodeUsageSlice(...args)
      }) as AppState
  )
  const pending = store.getState().fetchClaudeUsage()
  await started.promise
  await store.getState().setAllUsageFilters({ range: '7d' })
  delayed.resolve(snapshot('30d'))
  await pending
  const state = store.getState()
  expect([state.claudeUsageRange, state.codexUsageRange, state.openCodeUsageRange]).toEqual([
    '7d',
    '7d',
    '7d'
  ])
  expect(state.claudeUsageSummary).toEqual({ range: '7d' })
})

it('updates all provider filters atomically before fetching each once and keeps range normalization', async () => {
  const getScanState = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('window', {
    api: {
      claudeUsage: { getScanState },
      codexUsage: { getScanState },
      openCodeUsage: { getScanState }
    }
  })
  const store = create<AppState>()(
    (...args) =>
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: Only the three initialized usage slices are accessed in this test.
      ({
        ...createClaudeUsageSlice(...args),
        ...createCodexUsageSlice(...args),
        ...createOpenCodeUsageSlice(...args)
      }) as AppState
  )
  const snapshots: string[][] = []
  store.subscribe((s) =>
    snapshots.push([
      s.claudeUsageScope,
      s.codexUsageScope,
      s.openCodeUsageScope,
      s.claudeUsageRange,
      s.codexUsageRange,
      s.openCodeUsageRange
    ])
  )
  await store.getState().setAllUsageFilters({ scope: 'orca', range: '7d' })
  expect(snapshots).toEqual([['orca', 'orca', 'orca', '7d', '7d', '7d']])
  expect(getScanState).toHaveBeenCalledTimes(3)
  await store.getState().setCodexUsageRange('30d')
  await store.getState().setAllUsageFilters({ scope: 'all' })
  expect(store.getState().codexUsageRange).toBe('30d')
  expect(store.getState().claudeUsageRange).toBe('7d')
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 14, 12))
  await store.getState().setAllUsageFilters({ range: 'custom:2026-06-13..2026-09-14' })
  expect([
    store.getState().claudeUsageRange,
    store.getState().codexUsageRange,
    store.getState().openCodeUsageRange
  ]).toEqual(Array(3).fill('custom:2026-06-13..2026-09-13'))
  getScanState.mockClear()
  await store.getState().setAllUsageFilters({ scope: 'orca', range: 'custom:invalid' })
  await store.getState().setAllUsageFilters({})
  expect(getScanState).not.toHaveBeenCalled()
  expect(store.getState().claudeUsageScope).toBe('all')
})
