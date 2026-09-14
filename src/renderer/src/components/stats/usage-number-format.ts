import type { UsageNumberFormat } from '../../../../shared/usage-number-format'

export type { UsageNumberFormat } from '../../../../shared/usage-number-format'

const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1
})

export function formatUsageNumber(value: number, mode: UsageNumberFormat): string {
  return mode === 'full' ? value.toLocaleString('en-US') : compactFormatter.format(value)
}
