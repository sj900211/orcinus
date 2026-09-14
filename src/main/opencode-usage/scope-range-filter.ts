import type { OpenCodeUsageRange, OpenCodeUsageScope } from '../../shared/opencode-usage-types'
import type { OpenCodeUsageDailyAggregate, OpenCodeUsageSession } from './types'
import { getLocalUsageDay, getUsageRangeBounds } from '../usage/usage-calendar-range'

export function filterDailyAggregatesByScopeAndRange(
  dailyAggregates: OpenCodeUsageDailyAggregate[],
  scope: OpenCodeUsageScope,
  range: OpenCodeUsageRange
): OpenCodeUsageDailyAggregate[] {
  const { since: cutoff, until } = getUsageRangeBounds(range)
  return dailyAggregates.filter((row) => {
    if (scope === 'orca' && !row.worktreeId) {
      return false
    }
    if ((cutoff && row.day < cutoff) || (until && row.day > until)) {
      return false
    }
    return true
  })
}

export function filterSessionsByScopeAndRange(
  sessions: OpenCodeUsageSession[],
  scope: OpenCodeUsageScope,
  range: OpenCodeUsageRange
): OpenCodeUsageSession[] {
  const { since: cutoff, until } = getUsageRangeBounds(range)
  return sessions.filter((session) => {
    if (scope === 'orca' && !session.primaryWorktreeId) {
      return false
    }
    if (cutoff || until) {
      const day = getLocalUsageDay(session.lastTimestamp)
      if (!day || (cutoff && day < cutoff) || (until && day > until)) {
        return false
      }
    }
    return true
  })
}
