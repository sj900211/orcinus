import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../../../shared/constants'
import type { PersistedUIState } from '../../../../shared/persisted-ui-state-types'
import { UiUpdateFields } from '../../../../shared/rpc-contract/client-ui-params'
import { getPersistedUI } from '../../../../main/persistence/applying-settings/ui-state-read'
import { updatePersistedUI } from '../../../../main/persistence/applying-settings/ui-state-update'
import { mergeWebUIState } from '../../web/preload-api/web-preference-normalization'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'

afterEach(() => vi.unstubAllGlobals())

describe('usage number format preference', () => {
  it('round-trips the preference from the renderer through persistence and hydration', () => {
    const state = getDefaultPersistedState('~')
    const scheduleSave = vi.fn()
    const operations = {
      state,
      removeRetainedBlob: vi.fn(),
      scheduleSave,
      setActiveView: vi.fn(),
      getUI: () => getPersistedUI(state, 'terminal'),
      notifyUIChanged: vi.fn()
    }
    const setUI = vi.fn(async (updates: Partial<PersistedUIState>) => {
      const { usageNumberFormat } = UiUpdateFields.parse(updates)
      updatePersistedUI(operations, { usageNumberFormat })
    })
    vi.stubGlobal('window', { api: { ui: { set: setUI } } })
    const store = createUIStore()
    expect(store.getState().usageNumberFormat).toBe('compact')
    store.getState().setUsageNumberFormat('full')
    expect(setUI).toHaveBeenCalledWith({ usageNumberFormat: 'full' })
    expect(scheduleSave).toHaveBeenCalledOnce()
    const restarted = createUIStore()
    restarted.getState().hydratePersistedUI(getPersistedUI(state, 'terminal'))
    expect(restarted.getState().usageNumberFormat).toBe('full')
    updatePersistedUI(operations, { statusBarVisible: false })
    expect(getPersistedUI(state, 'terminal').usageNumberFormat).toBe('full')
    expect(
      mergeWebUIState(makePersistedUI(), { usageNumberFormat: 'full' }).usageNumberFormat
    ).toBe('full')
    expect(mergeWebUIState(state.ui, {}).usageNumberFormat).toBe('full')
    restarted.getState().setUsageNumberFormat('compact')
    expect(getPersistedUI(state, 'terminal').usageNumberFormat).toBe('compact')
  })

  it('defaults missing or invalid persisted modes to compact', () => {
    const store = createUIStore()
    store.getState().hydratePersistedUI(makePersistedUI({ usageNumberFormat: undefined }))
    expect(store.getState().usageNumberFormat).toBe('compact')
    const invalid = { usageNumberFormat: 'unknown' }
    // @ts-expect-error Invalid persisted data is normalized at the read boundary.
    store.getState().hydratePersistedUI(makePersistedUI(invalid))
    expect(store.getState().usageNumberFormat).toBe('compact')
  })
})
