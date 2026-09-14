// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, it, vi } from 'vitest'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '../ui/dropdown-menu'
import { UsageCustomRangeFields, UsageRangeFilter } from './UsageCustomRangeFields'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

it('keeps the options menu open when custom is selected and exposes native dates', async () => {
  const user = userEvent.setup()
  const onValueChange = vi.fn()
  render(
    <DropdownMenu>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <UsageRangeFilter
          label="Range"
          range="30d"
          presetLabels={{ '7d': '7 days', '30d': '30 days', '90d': '90 days', all: 'All time' }}
          onValueChange={onValueChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
  await user.click(screen.getByText('Options'))
  await user.click(screen.getByRole('menuitemradio', { name: 'Custom range' }))
  expect(screen.getByLabelText('Start date')).toHaveAttribute('type', 'date')
  expect(screen.getByLabelText('Start date')).toHaveFocus()
  expect(screen.getByLabelText('End date')).toHaveAttribute('type', 'date')
  expect(onValueChange).not.toHaveBeenCalled()
})

it('sets native bounds, waits for both dates, rejects reversal, and clamps excessive ranges', () => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(2026, 8, 14, 12))
  const onValueChange = vi.fn()
  render(<UsageCustomRangeFields range="30d" onValueChange={onValueChange} />)
  const start = screen.getByLabelText('Start date')
  const end = screen.getByLabelText('End date')
  expect(start).toHaveAttribute('max', '2026-09-14')
  fireEvent.change(start, { target: { value: '2026-06-13' } })
  expect(onValueChange).not.toHaveBeenCalled()
  expect(end).toHaveAttribute('min', '2026-06-13')
  expect(end).toHaveAttribute('max', '2026-09-13')
  fireEvent.change(end, { target: { value: '2026-06-12' } })
  expect(onValueChange).not.toHaveBeenCalled()
  fireEvent.change(end, { target: { value: '2026-09-14' } })
  expect(onValueChange).toHaveBeenLastCalledWith('custom:2026-06-13..2026-09-13')
  expect(end).toHaveValue('2026-09-13')
})
