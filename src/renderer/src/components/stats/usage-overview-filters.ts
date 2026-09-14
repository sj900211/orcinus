import { useAppStore } from '@/store'
import { parseUsageRange, type UsageRange } from '../../../../shared/usage-range'
import { getRecentUsageDays } from './usage-overview-daily-series'
import type { UsageOverviewDailyPoint } from './usage-overview-types'

export function commonUsageFilter<T extends string>(first: T, second: T, third: T): T | 'mixed' {
  return first === second && first === third ? first : 'mixed'
}

export function useUsageOverviewFilters() {
  const scope = useAppStore((s) =>
    commonUsageFilter(s.claudeUsageScope, s.codexUsageScope, s.openCodeUsageScope)
  )
  const range = useAppStore((s) =>
    commonUsageFilter(s.claudeUsageRange, s.codexUsageRange, s.openCodeUsageRange)
  )
  const setFilters = useAppStore((s) => s.setAllUsageFilters)
  return { scope, range, setFilters }
}

export function getUsageOverviewDays(
  daily: UsageOverviewDailyPoint[],
  range: UsageRange | 'mixed',
  now = new Date()
): UsageOverviewDailyPoint[] {
  if (range === 'all' || range === 'mixed') {
    return getRecentUsageDays(daily, 42, now)
  }
  const parsed = parseUsageRange(range)
  if (!parsed) {
    return getRecentUsageDays(daily, 42, now)
  }
  if (parsed.since && parsed.until) {
    const count =
      (Date.parse(`${parsed.until}T00:00:00Z`) - Date.parse(`${parsed.since}T00:00:00Z`)) /
        86_400_000 +
      1
    return getRecentUsageDays(daily, count, new Date(`${parsed.until}T12:00:00`))
  }
  return getRecentUsageDays(daily, Number.parseInt(range, 10), now)
}
