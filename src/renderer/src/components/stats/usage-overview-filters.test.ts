import { describe, expect, it } from 'vitest'
import { commonUsageFilter, getUsageOverviewDays } from './usage-overview-filters'
import type { UsageRange } from '../../../../shared/usage-range'

describe('overview shared filter projection', () => {
  it('shows a common value only when all three providers agree', () => {
    expect(commonUsageFilter('all', 'all', 'all')).toBe('all')
    expect(commonUsageFilter('all', 'orca', 'all')).toBe('mixed')
    expect(commonUsageFilter('7d', '7d', '30d')).toBe('mixed')
  })
  it.each<[UsageRange | 'mixed', number]>([
    ['7d', 7],
    ['30d', 30],
    ['90d', 90],
    ['all', 42],
    ['mixed', 42]
  ])('derives %s grid length', (range, count) => {
    const days = getUsageOverviewDays([], range, new Date(2026, 8, 14, 12))
    expect(days).toHaveLength(count)
    expect(days.at(-1)?.day).toBe('2026-09-14')
  })
  it('anchors historical custom ranges to their inclusive end, including DST and leap days', () => {
    const days = getUsageOverviewDays([], 'custom:2024-02-28..2024-03-11')
    expect(days).toHaveLength(13)
    expect(days[0].day).toBe('2024-02-28')
    expect(days.at(-1)?.day).toBe('2024-03-11')
    expect(getUsageOverviewDays([], 'custom:2026-06-01..2026-06-01')).toHaveLength(1)
  })
})
