// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from 'zustand'
import type { AppState } from '@/store/types'
import { createUsagePaneStore } from './usage-pane-test-state'
import { UsageOverviewPane } from './UsageOverviewPane'
import { TooltipProvider } from '../ui/tooltip'

const store = createUsagePaneStore()
vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (s: AppState) => T) => useStore(store, selector)
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('projects mixed agent filters, applies presets/custom dates to all providers and mounts the number toggle', async () => {
  const getScanState = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('api', {
    ui: { set: vi.fn().mockResolvedValue(undefined) },
    claudeUsage: { getScanState },
    codexUsage: { getScanState },
    openCodeUsage: { getScanState }
  })
  store.setState({ claudeUsageScope: 'orca', codexUsageRange: '7d' })
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <UsageOverviewPane />
    </TooltipProvider>
  )
  expect(screen.getByText('Mixed · Mixed')).toBeInTheDocument()
  const openMenu = () => user.click(screen.getByRole('button', { name: 'Usage overview filters' }))
  await openMenu()
  await user.click(screen.getByRole('menuitemradio', { name: 'All local usage' }))
  expect(store.getState().claudeUsageScope).toBe('all')
  await openMenu()
  await user.click(screen.getByRole('menuitemradio', { name: 'Last 7 days' }))
  expect([
    store.getState().claudeUsageRange,
    store.getState().codexUsageRange,
    store.getState().openCodeUsageRange
  ]).toEqual(['7d', '7d', '7d'])
  expect(screen.getByLabelText('Recent token activity heatmap').children).toHaveLength(7)
  await openMenu()
  await user.click(screen.getByRole('menuitemradio', { name: 'Custom range' }))
  fireEvent.change(screen.getByLabelText('Start date'), { target: { value: '2026-01-01' } })
  await act(async () => {
    fireEvent.change(screen.getByLabelText('End date'), { target: { value: '2026-01-03' } })
  })
  expect(store.getState().openCodeUsageRange).toBe('custom:2026-01-01..2026-01-03')
  expect(screen.getByLabelText('Recent token activity heatmap').children).toHaveLength(3)
  await user.click(screen.getByRole('menuitemradio', { name: 'Full numbers' }))
  expect(screen.getByText('Total tokens').parentElement).toHaveTextContent('5,300')
})
