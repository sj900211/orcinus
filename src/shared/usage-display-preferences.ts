import type { PersistedUIState } from './persisted-ui-state-types'
import { normalizeStatusBarUsageMode } from './status-bar-usage-mode'
import { normalizeUsageNumberFormat } from './usage-number-format'
import { normalizeUsagePercentageDisplay } from './usage-percentage-display'

export function normalizeUsageDisplayPreferences(
  ui: Pick<PersistedUIState, 'statusBarUsageMode' | 'usageNumberFormat' | 'usagePercentageDisplay'>
) {
  return {
    statusBarUsageMode: normalizeStatusBarUsageMode(ui.statusBarUsageMode),
    usageNumberFormat: normalizeUsageNumberFormat(ui.usageNumberFormat),
    usagePercentageDisplay: normalizeUsagePercentageDisplay(ui.usagePercentageDisplay)
  }
}
