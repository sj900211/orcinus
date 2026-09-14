import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseUsageRange } from '../../../../shared/usage-range'
import { formatDateRange, getShareUsageRangeLabel } from './share-card-utils'

afterEach(() => vi.useRealTimers())

it.each(['7d', '30d', '90d'])('uses the %s filter lower bound for the share label', (range) => {
  vi.useFakeTimers()
  const now = new Date(2026, 8, 14, 12)
  vi.setSystemTime(now)
  const since = parseUsageRange(range)?.since
  const start = new Date(`${since}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
  const end = now.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  expect(formatDateRange(range)).toBe(`${start} – ${end}`)
  if (range === '7d') {
    expect(since).toBe('2026-09-08')
  }
})

describe('share card range labels', () => {
  it('labels custom ranges and preserves their actual inclusive dates', () => {
    const range = 'custom:2026-05-01..2026-06-30'
    expect(getShareUsageRangeLabel(range)).toBe('Custom range')
    expect(formatDateRange(range)).toBe('2026-05-01 – 2026-06-30')
  })
  it('preserves preset labels and does not treat malformed custom ranges as valid', () => {
    expect(getShareUsageRangeLabel('7d')).toBe('Last 7 days')
    expect(getShareUsageRangeLabel('all')).toBe('All time')
    expect(getShareUsageRangeLabel('custom:invalid')).toBe('custom:invalid')
  })
})
