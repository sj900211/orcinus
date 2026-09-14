import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import {
  USAGE_RANGE_PRESETS,
  type UsageRange,
  type UsageRangePreset
} from '../../../../shared/usage-range'
import { Button } from '../ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '../ui/dropdown-menu'
import { UsageFilterRadioGroup } from './UsageTrackingPaneShell'
import {
  UsageCustomRangeFields,
  UsageRangeFilter,
  customUsageRangeLabel,
  usageRangeLabel
} from './UsageCustomRangeFields'
import { UsageNumberFormatToggle } from './UsageNumberFormatToggle'
import type { useUsageOverviewFilters } from './usage-overview-filters'

function rangeLabels(): Record<UsageRangePreset, string> {
  return {
    '7d': translate('auto.components.stats.ClaudeUsagePane.rangeLast7Days', 'Last 7 days'),
    '30d': translate('auto.components.stats.ClaudeUsagePane.rangeLast30Days', 'Last 30 days'),
    '90d': translate('auto.components.stats.ClaudeUsagePane.rangeLast90Days', 'Last 90 days'),
    all: translate('auto.components.stats.ClaudeUsagePane.rangeAllTime', 'All time')
  }
}

function mixedLabel(): string {
  return translate('auto.components.stats.UsageOverviewFilters.mixed', 'Mixed')
}

type FilterProps = ReturnType<typeof useUsageOverviewFilters>

export function UsageOverviewFilterSummary({
  scope,
  range
}: Pick<FilterProps, 'scope' | 'range'>): React.JSX.Element {
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      {scope === 'mixed'
        ? mixedLabel()
        : scope === 'all'
          ? translate('auto.components.stats.UsageOverviewFilters.allLocal', 'All local usage')
          : translate('auto.components.stats.ClaudeUsagePane.4f8368c272', 'Orca worktrees only')}
      {' · '}
      {range === 'mixed' ? mixedLabel() : usageRangeLabel(range, rangeLabels())}
    </p>
  )
}

function MixedRangeFilter({
  onValueChange
}: {
  onValueChange: (range: UsageRange) => Promise<void>
}): React.JSX.Element {
  const [custom, setCustom] = useState(false)
  const labels = rangeLabels()
  return (
    <>
      <DropdownMenuLabel>
        {translate('auto.components.stats.ClaudeUsagePane.505be9aac4', 'Range')}
      </DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={custom ? 'custom' : 'mixed'}
        onValueChange={(value) => {
          if (value === 'custom') {
            setCustom(true)
          } else if (value === '7d' || value === '30d' || value === '90d' || value === 'all') {
            void onValueChange(value)
          }
        }}
      >
        <DropdownMenuRadioItem value="mixed" disabled>
          {mixedLabel()}
        </DropdownMenuRadioItem>
        {USAGE_RANGE_PRESETS.map((value) => (
          <DropdownMenuRadioItem key={value} value={value}>
            {labels[value]}
          </DropdownMenuRadioItem>
        ))}
        <DropdownMenuRadioItem value="custom" onSelect={(event) => event.preventDefault()}>
          {customUsageRangeLabel()}
        </DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {custom && <UsageCustomRangeFields range="all" onValueChange={onValueChange} />}
    </>
  )
}

export function UsageOverviewFilters({ scope, range, setFilters }: FilterProps): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={translate(
            'auto.components.stats.UsageOverviewFilters.options',
            'Usage overview filters'
          )}
        >
          <SlidersHorizontal className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <UsageFilterRadioGroup
          label={translate('auto.components.stats.ClaudeUsagePane.f61cffb9c8', 'Scope')}
          value={scope}
          options={[
            ...(scope === 'mixed' ? [{ value: 'mixed' as const, label: mixedLabel() }] : []),
            {
              value: 'orca',
              label: translate(
                'auto.components.stats.ClaudeUsagePane.4f8368c272',
                'Orca worktrees only'
              )
            },
            {
              value: 'all',
              label: translate(
                'auto.components.stats.UsageOverviewFilters.allLocal',
                'All local usage'
              )
            }
          ]}
          onValueChange={(value) => {
            if (value === 'all' || value === 'orca') {
              void setFilters({ scope: value })
            }
          }}
        />
        <DropdownMenuSeparator />
        {range === 'mixed' ? (
          <MixedRangeFilter onValueChange={(range) => setFilters({ range })} />
        ) : (
          <UsageRangeFilter
            label={translate('auto.components.stats.ClaudeUsagePane.505be9aac4', 'Range')}
            range={range}
            presetLabels={rangeLabels()}
            onValueChange={(range) => setFilters({ range })}
          />
        )}
        <DropdownMenuSeparator />
        <UsageNumberFormatToggle />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
