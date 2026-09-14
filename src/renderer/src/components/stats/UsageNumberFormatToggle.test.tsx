// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from 'zustand'
import type { AppState } from '@/store/types'
import { createUIStore } from '@/store/slices/ui-slice-test-harness'
import { UsageNumberFormatToggle } from './UsageNumberFormatToggle'
import { UsageBreakdownSection } from './UsageBreakdownSection'
import { CodexUsageDailyChart } from './CodexUsageDailyChart'
import { ShareUsageCard } from './ShareUsageCard'
import { formatUsageNumber } from './usage-number-format'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'

const store = createUIStore()
vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (state: AppState) => T) => useStore(store, selector)
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('renders the reusable menu toggle and updates token displays and persistence', async () => {
  const setUI = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('api', { ui: { set: setUI } })
  const user = userEvent.setup()
  render(
    <>
      <DropdownMenu>
        <DropdownMenuTrigger>Options</DropdownMenuTrigger>
        <DropdownMenuContent>
          <UsageNumberFormatToggle />
        </DropdownMenuContent>
      </DropdownMenu>
      <UsageBreakdownSection
        title="Models"
        topLabel="Top:"
        topValue="model"
        eventsOrTurns="events"
        rows={[{ key: 'model', label: 'model', tokens: 1500, sessions: 1, eventsOrTurns: 1 }]}
      />
      <CodexUsageDailyChart
        daily={[
          {
            day: '2026-09-13',
            inputTokens: 1500,
            outputTokens: 0,
            totalTokens: 1500,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0
          }
        ]}
      />
      <ShareUsageCard
        provider="codex"
        range="7d"
        summary={{
          scope: 'all',
          range: '7d',
          inputTokens: 1500,
          outputTokens: 0,
          totalTokens: 1500,
          cachedInputTokens: 0,
          reasoningOutputTokens: 0,
          sessions: 1,
          events: 1,
          estimatedCostUsd: null,
          topModel: 'model',
          topProject: 'project',
          hasAnyCodexData: true
        }}
        daily={[
          {
            day: '2026-09-13',
            inputTokens: 1500,
            outputTokens: 0,
            totalTokens: 1500,
            cachedInputTokens: 0,
            reasoningOutputTokens: 0
          }
        ]}
      />
    </>
  )
  expect(screen.getAllByText(formatUsageNumber(1500, 'compact'))).toHaveLength(5)
  await user.click(screen.getByRole('button', { name: 'Options' }))
  expect(screen.getByText('Number format')).toBeInTheDocument()
  expect(screen.getByRole('menuitemradio', { name: 'Compact (K/M/B)' })).toBeChecked()
  await user.click(screen.getByRole('menuitemradio', { name: 'Full numbers' }))
  expect(store.getState().usageNumberFormat).toBe('full')
  expect(setUI).toHaveBeenCalledWith({ usageNumberFormat: 'full' })
  expect(screen.getAllByText((1500).toLocaleString('en-US'))).toHaveLength(5)
})
