import { translate } from '@/i18n/i18n'
import { UsageFilterRadioGroup } from './UsageTrackingPaneShell'
import { useUsageNumberFormat } from './use-usage-number-format'

export function UsageNumberFormatToggle(): React.JSX.Element {
  const { mode, setMode } = useUsageNumberFormat()
  return (
    <UsageFilterRadioGroup
      label={translate('auto.components.stats.UsageNumberFormatToggle.label', 'Number format')}
      value={mode}
      options={[
        {
          value: 'compact',
          label: translate(
            'auto.components.stats.UsageNumberFormatToggle.compact',
            'Compact (K/M/B)'
          )
        },
        {
          value: 'full',
          label: translate('auto.components.stats.UsageNumberFormatToggle.full', 'Full numbers')
        }
      ]}
      onValueChange={setMode}
    />
  )
}
