// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { useStore } from 'zustand'
import type { AppState } from '@/store/types'
import { createUsagePaneStore } from './usage-pane-test-state'
import { ClaudeUsagePane } from './ClaudeUsagePane'
import { CodexUsagePane } from './CodexUsagePane'
import { OpenCodeUsagePane } from './OpenCodeUsagePane'
import { TooltipProvider } from '../ui/tooltip'

let store = createUsagePaneStore()
vi.mock('@/store', () => ({
  useAppStore: <T,>(selector: (s: AppState) => T) => useStore(store, selector)
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it.each([
  { Pane: ClaudeUsagePane, name: 'Claude', total: '2.1K', full: '2,100' },
  { Pane: CodexUsagePane, name: 'Codex', total: '1.6K', full: '1,600' },
  { Pane: OpenCodeUsagePane, name: 'OpenCode', total: '1.6K', full: '1,600' }
])('mounts the total card and number toggle in $name', async ({ Pane, name, total, full }) => {
  store = createUsagePaneStore()
  const getScanState = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal('api', {
    ui: { set: vi.fn().mockResolvedValue(undefined) },
    claudeUsage: { getScanState },
    codexUsage: { getScanState },
    openCodeUsage: { getScanState }
  })
  const user = userEvent.setup()
  render(
    <TooltipProvider>
      <Pane />
    </TooltipProvider>
  )
  expect(screen.getByText('Total tokens').parentElement).toHaveTextContent(total)
  await user.click(screen.getByRole('button', { name: `${name} usage options` }))
  await user.click(screen.getByRole('menuitemradio', { name: 'Full numbers' }))
  expect(screen.getByText('Total tokens').parentElement).toHaveTextContent(full)
  expect(screen.getByText('Input tokens').parentElement).toHaveTextContent('1,500')
})
