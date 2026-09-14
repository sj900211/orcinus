import { useEffect, useState, type ReactNode } from 'react'
import {
  buildCustomRange,
  clampCustomRange,
  formatUsageDay,
  parseUsageRange,
  USAGE_RANGE_PRESETS,
  type UsageRange,
  type UsageRangePreset
} from '../../../../shared/usage-range'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem
} from '../ui/dropdown-menu'
import { translate } from '@/i18n/i18n'

export function customUsageRangeLabel(): string {
  return translate('auto.components.stats.UsageCustomRangeFields.custom', 'Custom range')
}

export function usageRangeLabel(
  range: UsageRange,
  labels: Record<UsageRangePreset, string>
): string {
  return range === '7d' || range === '30d' || range === '90d' || range === 'all'
    ? labels[range]
    : `${customUsageRangeLabel()}: ${range.slice(7).replace('..', ' – ')}`
}

export function UsageCustomRangeFields({
  range,
  onValueChange
}: {
  range: UsageRange
  onValueChange: (range: UsageRange) => void | Promise<void>
}): React.JSX.Element {
  const parsed = range.startsWith('custom:') ? parseUsageRange(range) : null
  const [start, setStart] = useState(parsed?.since ?? '')
  const [end, setEnd] = useState(parsed?.until ?? '')
  useEffect(() => {
    const selection = range.startsWith('custom:') ? parseUsageRange(range) : null
    setStart(selection?.since ?? '')
    setEnd(selection?.until ?? '')
  }, [range])
  const today = formatUsageDay()
  const maximumEnd = clampCustomRange(start, today, today)?.end ?? today
  const change = (nextStart: string, nextEnd: string): void => {
    setStart(nextStart)
    setEnd(nextEnd)
    const clamped = clampCustomRange(nextStart, nextEnd, today)
    if (!clamped) {
      return
    }
    setStart(clamped.start)
    setEnd(clamped.end)
    void onValueChange(buildCustomRange(clamped.start, clamped.end))
  }

  return (
    <div
      className="space-y-2 px-2 py-1"
      onKeyDown={(event) => {
        if (event.key !== 'Escape') {
          event.stopPropagation()
        }
      }}
    >
      <label className="flex items-center justify-between gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-foreground focus-within:ring-1 focus-within:ring-ring">
        <span className="text-muted-foreground">
          {translate('auto.components.stats.UsageCustomRangeFields.start', 'Start date')}
        </span>
        <input
          type="date"
          autoFocus
          value={start}
          min="0001-01-01"
          max={end && end < today ? end : today}
          onChange={(event) => change(event.target.value, end)}
          className="h-5 min-w-0 cursor-pointer border-none bg-transparent p-0 text-xs text-foreground outline-none"
        />
      </label>
      <label className="flex items-center justify-between gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-foreground focus-within:ring-1 focus-within:ring-ring">
        <span className="text-muted-foreground">
          {translate('auto.components.stats.UsageCustomRangeFields.end', 'End date')}
        </span>
        <input
          type="date"
          value={end}
          min={start || '0001-01-01'}
          max={maximumEnd}
          onChange={(event) => change(start, event.target.value)}
          className="h-5 min-w-0 cursor-pointer border-none bg-transparent p-0 text-xs text-foreground outline-none"
        />
      </label>
    </div>
  )
}

export function UsageRangeFilter({
  label,
  range,
  presetLabels,
  onValueChange
}: {
  label: ReactNode
  range: UsageRange
  presetLabels: Record<UsageRangePreset, string>
  onValueChange: (range: UsageRange) => void | Promise<void>
}): React.JSX.Element {
  const [custom, setCustom] = useState(range.startsWith('custom:'))
  useEffect(() => {
    setCustom(range.startsWith('custom:'))
  }, [range])
  return (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={custom ? 'custom' : range}
        onValueChange={(value) => {
          setCustom(value === 'custom')
          if (value === '7d' || value === '30d' || value === '90d' || value === 'all') {
            void onValueChange(value)
          }
        }}
      >
        {USAGE_RANGE_PRESETS.map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {presetLabels[value]}
          </DropdownMenuRadioItem>
        ))}
        <DropdownMenuRadioItem value="custom" onSelect={(event) => event.preventDefault()}>
          {customUsageRangeLabel()}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {custom && <UsageCustomRangeFields range={range} onValueChange={onValueChange} />}
    </>
  )
}
