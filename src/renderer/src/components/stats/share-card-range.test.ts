import { describe, expect, it } from 'vitest'
import { formatDateRange, getShareUsageRangeLabel } from './share-card-utils'

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
