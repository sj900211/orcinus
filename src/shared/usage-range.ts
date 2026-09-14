export const USAGE_RANGE_PRESETS = ['7d', '30d', '90d', 'all'] as const
export type UsageRangePreset = (typeof USAGE_RANGE_PRESETS)[number]
export type UsageRange = UsageRangePreset | `custom:${string}`
export const MAX_CUSTOM_RANGE_MONTHS = 3

export function formatUsageDay(date: Date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function parseDay(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null
  }
  const date = new Date(`${day}T00:00:00Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day ? null : date
}

export function parseUsageRange(
  range: string
): { since: string | null; until: string | null } | null {
  if (range === 'all') {
    return { since: null, until: null }
  }
  if (range === '7d' || range === '30d' || range === '90d') {
    const date = new Date()
    date.setDate(date.getDate() - (Number.parseInt(range, 10) - 1))
    return { since: formatUsageDay(date), until: null }
  }
  const match = /^custom:(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(range)
  if (!match || !parseDay(match[1]) || !parseDay(match[2]) || match[1] > match[2]) {
    return null
  }
  return { since: match[1], until: match[2] }
}

export function clampCustomRange(
  start: string,
  end: string,
  today: string
): { start: string; end: string } | null {
  if (!parseDay(start) || !parseDay(end) || !parseDay(today) || start > end) {
    return null
  }
  start = start > today ? today : start
  end = end > today ? today : end
  const date = parseDay(start)
  if (!date) {
    return null
  }
  const day = date.getUTCDate()
  date.setUTCDate(1)
  date.setUTCMonth(date.getUTCMonth() + MAX_CUSTOM_RANGE_MONTHS + 1)
  date.setUTCDate(0)
  date.setUTCDate(Math.min(day, date.getUTCDate()))
  const maximum = date.toISOString().slice(0, 10)
  return { start, end: end > maximum ? maximum : end }
}

export function buildCustomRange(start: string, end: string): UsageRange {
  return `custom:${start}..${end}`
}
