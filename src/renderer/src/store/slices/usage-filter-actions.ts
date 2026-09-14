import type { StateCreator } from 'zustand'
import type { AppState } from '../types'
import type { ClaudeUsageScope } from '../../../../shared/claude-usage-types'
import {
  buildCustomRange,
  clampCustomRange,
  formatUsageDay,
  parseUsageRange,
  type UsageRange
} from '../../../../shared/usage-range'

export function normalizeUsageFilterRange(range: UsageRange): UsageRange | null {
  const parsed = parseUsageRange(range)
  if (!parsed) {
    return null
  }
  if (!parsed.since || !parsed.until) {
    return range
  }
  const clamped = clampCustomRange(parsed.since, parsed.until, formatUsageDay())
  return clamped ? buildCustomRange(clamped.start, clamped.end) : null
}

export type AllUsageFiltersSlice = {
  setAllUsageFilters: (filters: { scope?: ClaudeUsageScope; range?: UsageRange }) => Promise<void>
}

export const createAllUsageFiltersActions: StateCreator<AppState, [], [], AllUsageFiltersSlice> = (
  set,
  get
) => ({
  setAllUsageFilters: async ({ scope, range }) => {
    const normalizedRange = range === undefined ? undefined : normalizeUsageFilterRange(range)
    if (normalizedRange === null || (scope === undefined && range === undefined)) {
      return
    }
    set({
      ...(scope === undefined
        ? {}
        : { claudeUsageScope: scope, codexUsageScope: scope, openCodeUsageScope: scope }),
      ...(normalizedRange === undefined
        ? {}
        : {
            claudeUsageRange: normalizedRange,
            codexUsageRange: normalizedRange,
            openCodeUsageRange: normalizedRange
          })
    })
    await Promise.all([
      get().fetchClaudeUsage(),
      get().fetchCodexUsage(),
      get().fetchOpenCodeUsage()
    ])
  }
})
