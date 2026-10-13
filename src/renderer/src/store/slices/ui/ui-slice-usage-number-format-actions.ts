import type { UISlice, UISliceGet, UISliceSet } from './ui-slice-contract'
import {
  DEFAULT_USAGE_NUMBER_FORMAT,
  normalizeUsageNumberFormat
} from '../../../../../shared/usage-number-format'

export function createUiUsageNumberFormatActions(
  set: UISliceSet,
  _get: UISliceGet
): Partial<UISlice> {
  return {
    usageNumberFormat: DEFAULT_USAGE_NUMBER_FORMAT,
    setUsageNumberFormat: (mode) => {
      const normalized = normalizeUsageNumberFormat(mode)
      window.api.ui.set({ usageNumberFormat: normalized }).catch(console.error)
      set({ usageNumberFormat: normalized })
    }
  }
}
