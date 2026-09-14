import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getLocalUsageDay, getUsageRangeBounds, getUsageRangeCutoff } from './usage-calendar-range'

describe('usage calendar ranges', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 3, 10, 12))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it.each([
    ['7d', '2026-04-04'],
    ['30d', '2026-03-12'],
    ['90d', '2026-01-11'],
    ['all', null]
  ] as const)('uses an inclusive local-calendar cutoff for %s', (range, expected) => {
    expect(getUsageRangeCutoff(range)).toBe(expected)
  })

  it('maps timestamps to local calendar days and rejects invalid values', () => {
    const localTimestamp = new Date(2026, 3, 4, 23, 30).toISOString()

    expect(getLocalUsageDay(localTimestamp)).toBe('2026-04-04')
    expect(getLocalUsageDay('not-a-date')).toBeNull()
  })

  it('includes custom bounds and defensively clamps calendar months and future dates', () => {
    expect(getUsageRangeBounds('custom:2025-11-30..2026-03-01')).toEqual({
      since: '2025-11-30',
      until: '2026-02-28'
    })
    expect(getUsageRangeBounds('custom:2026-04-01..2026-04-30')).toEqual({
      since: '2026-04-01',
      until: '2026-04-10'
    })
    expect(getUsageRangeCutoff('custom:2026-04-01..2026-04-03')).toBe('2026-04-01')
    expect(getUsageRangeBounds('all')).toEqual({ since: null, until: null })
    expect(getUsageRangeBounds('7d')).toEqual({ since: '2026-04-04', until: null })
  })

  it.each(['custom:invalid', 'custom:2026-04-03..2026-04-01'] as const)('rejects %s', (range) => {
    expect(() => getUsageRangeBounds(range)).toThrow('Invalid usage range')
  })
})
