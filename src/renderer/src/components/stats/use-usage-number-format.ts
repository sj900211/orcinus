import { useCallback } from 'react'
import { useAppStore } from '@/store'
import { formatUsageNumber } from './usage-number-format'

export function useUsageNumberFormat() {
  const mode = useAppStore((state) => state.usageNumberFormat)
  const setMode = useAppStore((state) => state.setUsageNumberFormat)
  const formatNumber = useCallback((value: number) => formatUsageNumber(value, mode), [mode])
  return { mode, setMode, formatNumber }
}
