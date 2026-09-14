import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildCustomRange, clampCustomRange, parseUsageRange } from './usage-range'

afterEach(() => vi.useRealTimers())

describe('usage ranges', () => {
  it('parses local-calendar presets and custom dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 14, 12))
    expect(parseUsageRange('7d')).toEqual({ since: '2026-09-08', until: null })
    expect(parseUsageRange('all')).toEqual({ since: null, until: null })
    expect(parseUsageRange(buildCustomRange('2026-06-13', '2026-09-13'))).toEqual({
      since: '2026-06-13',
      until: '2026-09-13'
    })
  })

  it.each([
    'bad',
    'custom:2026-02-30..2026-03-01',
    'custom:2026-9-01..2026-09-02',
    'custom:2026-09-14..2026-06-13',
    'custom:2026-06-13..2026-09-13junk'
  ])('rejects %s', (range) => {
    expect(parseUsageRange(range)).toBeNull()
  })

  it.each([
    ['2026-06-13', '2026-09-13', '2026-09-14', '2026-06-13', '2026-09-13'],
    ['2026-06-13', '2026-09-14', '2026-09-14', '2026-06-13', '2026-09-13'],
    ['2025-11-30', '2026-03-01', '2026-09-14', '2025-11-30', '2026-02-28'],
    ['2023-11-30', '2024-03-01', '2026-09-14', '2023-11-30', '2024-02-29'],
    ['2026-09-01', '2026-10-01', '2026-09-14', '2026-09-01', '2026-09-14'],
    ['2026-10-01', '2026-10-02', '2026-09-14', '2026-09-14', '2026-09-14']
  ])('clamps %s..%s with today %s', (start, end, today, expectedStart, expectedEnd) => {
    expect(clampCustomRange(start, end, today)).toEqual({ start: expectedStart, end: expectedEnd })
  })

  it('rejects reversed or invalid dates before clamping', () => {
    expect(clampCustomRange('2026-09-14', '2026-09-13', '2026-09-14')).toBeNull()
    expect(clampCustomRange('invalid', '2026-09-13', '2026-09-14')).toBeNull()
  })
})
