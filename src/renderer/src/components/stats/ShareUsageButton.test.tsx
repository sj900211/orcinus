// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from 'zustand'
import type { AppState } from '@/store/types'
import { createUsagePaneStore } from './usage-pane-test-state'
import { ShareUsageButton } from './ShareUsageButton'

const store = createUsagePaneStore()
vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (s: AppState) => T) => useStore(store, selector)
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('uses the selected number format, cache-inclusive total and custom dates in the share text', async () => {
  const openUrl = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('api', { shell: { openUrl } })
  store.setState({ usageNumberFormat: 'full' })
  const summary = store.getState().claudeUsageSummary
  expect(summary).not.toBeNull()
  if (!summary) {
    throw new Error('Missing test summary')
  }
  const user = userEvent.setup()
  render(
    <ShareUsageButton
      provider="claude"
      summary={summary}
      daily={[]}
      range="custom:2026-01-01..2026-01-03"
    />
  )
  await user.click(screen.getByRole('button', { name: 'Share usage' }))
  await user.click(screen.getByRole('button', { name: 'Share on X' }))
  expect(openUrl).toHaveBeenCalledOnce()
  const url = new URL(openUrl.mock.calls[0][0])
  expect(url.searchParams.get('text')).toContain('2,100 tokens')
  expect(url.searchParams.get('text')).toContain('Custom range (2026-01-01 – 2026-01-03)')
})
