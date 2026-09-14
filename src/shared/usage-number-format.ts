export type UsageNumberFormat = 'compact' | 'full'

export const DEFAULT_USAGE_NUMBER_FORMAT: UsageNumberFormat = 'compact'

export function normalizeUsageNumberFormat(value: unknown): UsageNumberFormat {
  return value === 'full' ? 'full' : DEFAULT_USAGE_NUMBER_FORMAT
}
