import {
  clampCustomRange,
  formatUsageDay,
  parseUsageRange,
  type UsageRange
} from '../../shared/usage-range'

export function getUsageRangeBounds(range: UsageRange): {
  since: string | null
  until: string | null
} {
  const parsed = parseUsageRange(range)
  if (!parsed) {
    throw new Error('Invalid usage range: expected a preset or ordered custom dates')
  }
  if (parsed.since && parsed.until) {
    const clamped = clampCustomRange(parsed.since, parsed.until, formatUsageDay())
    if (!clamped) {
      throw new Error('Invalid custom usage range')
    }
    return { since: clamped.start, until: clamped.end }
  }
  return parsed
}

export function getUsageRangeCutoff(range: UsageRange): string | null {
  return getUsageRangeBounds(range).since
}

export function getLocalUsageDay(timestamp: string): string | null {
  const parsed = new Date(timestamp)
  return Number.isNaN(parsed.getTime()) ? null : formatUsageDay(parsed)
}
