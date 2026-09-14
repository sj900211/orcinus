import { describe, expect, it } from 'vitest'
import { formatUsageNumber, type UsageNumberFormat } from './usage-number-format'
import { formatTokens } from './usage-formatters'
import { formatUsageTokens } from './usage-overview-model'

describe('formatUsageNumber', () => {
  it.each([
    [1_200_000_000, '1.2B'],
    [1_500, '1.5K'],
    [999, '999']
  ])('formats %i consistently in compact mode', (value, expected) => {
    expect(formatUsageNumber(value, 'compact')).toBe(expected)
    expect(formatTokens(value)).toBe(expected)
    expect(formatUsageTokens(value)).toBe(expected)
  })

  it('uses locale grouping without abbreviation in full mode', () => {
    expect(formatUsageNumber(1_200_000_000, 'full')).toBe((1_200_000_000).toLocaleString('en-US'))
  })

  it.each<UsageNumberFormat>(['compact', 'full'])(
    'handles zero and negatives in %s mode',
    (mode) => {
      expect(formatUsageNumber(0, mode)).toBe('0')
      expect(formatUsageNumber(-1_500, mode)).toBe(
        mode === 'compact' ? '-1.5K' : (-1_500).toLocaleString('en-US')
      )
    }
  )
})
