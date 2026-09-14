import type { UsageSnapshot, UsageShape, UsageData, UsageApi } from './usage-provider-types'
import type { UsageRange } from '../../../../shared/usage-range'
import {
  createAllUsageFiltersActions,
  normalizeUsageFilterRange,
  type AllUsageFiltersSlice
} from './usage-filter-actions'
import type { StateCreator } from 'zustand'
import type {
  ClaudeUsageRange,
  ClaudeUsageScope,
  ClaudeUsageSnapshot
} from '../../../../shared/claude-usage-types'
import type {
  CodexUsageRange,
  CodexUsageScope,
  CodexUsageSnapshot
} from '../../../../shared/codex-usage-types'
import type {
  OpenCodeUsageRange,
  OpenCodeUsageScope,
  OpenCodeUsageSnapshot
} from '../../../../shared/opencode-usage-types'
import type { AppState } from '../types'

type ProviderUsageSlice<
  Prefix extends string,
  Name extends string,
  T extends UsageShape<string, UsageRange, UsageSnapshot>
> = {
  [K in keyof UsageData<T> as `${Prefix}Usage${Capitalize<K & string>}`]: UsageData<T>[K]
} & Record<`set${Name}UsageEnabled`, (enabled: boolean) => Promise<void>> &
  Record<`set${Name}UsageScope`, (scope: T['scope']) => Promise<void>> &
  Record<`set${Name}UsageRange`, (range: T['range']) => Promise<void>> &
  Record<`fetch${Name}Usage`, (opts?: { forceRefresh?: boolean }) => Promise<void>> &
  Record<`enable${Name}Usage`, () => Promise<void>> &
  Record<`refresh${Name}Usage`, () => Promise<void>>

type UsageProviderConfig<
  Prefix extends string,
  Name extends string,
  T extends UsageShape<string, UsageRange, UsageSnapshot>
> = {
  prefix: Prefix
  name: Name
  initialScope: T['scope']
  initialRange: T['range']
  getApi: () => UsageApi<T>
  hasCachedData: (scanState: T['snapshot']['scanState']) => boolean
}

const usageDataFields = [
  'scope',
  'range',
  'scanState',
  'summary',
  'daily',
  'modelBreakdown',
  'projectBreakdown',
  'recentSessions'
] as const satisfies readonly (keyof UsageData<UsageShape<string, UsageRange, UsageSnapshot>>)[]

function usageDataKey(prefix: string, field: string): string {
  return `${prefix}Usage${field[0].toUpperCase()}${field.slice(1)}`
}

function readUsageData<T extends UsageShape<string, UsageRange, UsageSnapshot>>(
  state: AppState,
  prefix: string
): UsageData<T> {
  const values = state as unknown as Record<string, unknown>
  return Object.fromEntries(
    usageDataFields.map((field) => [field, values[usageDataKey(prefix, field)]])
  ) as UsageData<T>
}

function createUsagePatch<T extends UsageShape<string, UsageRange, UsageSnapshot>>(
  prefix: string,
  patch: Partial<UsageData<T>>
): Partial<AppState> {
  return Object.fromEntries(
    usageDataFields
      .filter((field) => field in patch)
      .map((field) => [usageDataKey(prefix, field), patch[field]])
  ) as Partial<AppState>
}

function createUsageProviderSlice<
  Prefix extends string,
  Name extends string,
  T extends UsageShape<string, UsageRange, UsageSnapshot>
>(
  config: UsageProviderConfig<Prefix, Name, T>
): StateCreator<AppState, [], [], ProviderUsageSlice<Prefix, Name, T>> {
  return (set, get) => {
    const update = (patch: Partial<UsageData<T>>): void =>
      set(createUsagePatch(config.prefix, patch))
    const read = (): UsageData<T> => readUsageData<T>(get(), config.prefix)
    let requestGeneration = 0
    const updateSnapshot = (snapshot: T['snapshot']): void =>
      update({
        scanState: snapshot.scanState,
        summary: snapshot.summary,
        daily: snapshot.daily,
        modelBreakdown: snapshot.modelBreakdown,
        projectBreakdown: snapshot.projectBreakdown,
        recentSessions: snapshot.recentSessions
      })

    const fetchUsage = async (opts?: { forceRefresh?: boolean }): Promise<void> => {
      const generation = ++requestGeneration
      try {
        const api = config.getApi()
        const scanState = (await api.getScanState()) as T['snapshot']['scanState'] | undefined
        // Desktop-only usage APIs resolve undefined in paired web clients.
        if (!scanState || generation !== requestGeneration) {
          return
        }

        const current = read()
        const preserveLoading =
          opts?.forceRefresh === true &&
          current.scanState?.enabled === true &&
          current.summary === null
        update({
          scanState: preserveLoading
            ? {
                ...scanState,
                isScanning: true,
                lastScanCompletedAt: null,
                lastScanError: null
              }
            : scanState
        })
        if (!scanState.enabled) {
          return
        }

        const selection = read()
        const snapshot = await api.getSnapshot({
          scope: selection.scope,
          range: selection.range,
          limit: 10
        })
        if (generation !== requestGeneration) {
          return
        }
        if (
          snapshot.scanState.lastScanCompletedAt !== null ||
          config.hasCachedData(snapshot.scanState)
        ) {
          updateSnapshot({
            ...snapshot,
            scanState:
              opts?.forceRefresh === true
                ? { ...snapshot.scanState, isScanning: true }
                : snapshot.scanState
          })
        } else {
          update({ scanState: { ...scanState, isScanning: true, lastScanError: null } })
        }

        await api.refresh({ force: opts?.forceRefresh ?? false })
        if (generation !== requestGeneration) {
          return
        }
        const refreshedSelection = read()
        const refreshedSnapshot = await api.getSnapshot({
          scope: refreshedSelection.scope,
          range: refreshedSelection.range,
          limit: 10
        })
        if (generation !== requestGeneration) {
          return
        }
        updateSnapshot(refreshedSnapshot)
      } catch (error) {
        console.error(`Failed to fetch ${config.name} usage:`, error)
      }
    }

    const setEnabled = async (enabled: boolean): Promise<void> => {
      ++requestGeneration
      try {
        const nextScanState = (await config.getApi().setEnabled({ enabled })) as
          | T['snapshot']['scanState']
          | undefined
        if (!nextScanState) {
          return
        }
        update({
          scanState: enabled
            ? {
                ...nextScanState,
                isScanning: true,
                lastScanCompletedAt: null,
                lastScanError: null
              }
            : nextScanState,
          summary: null,
          daily: [],
          modelBreakdown: [],
          projectBreakdown: [],
          recentSessions: []
        })
        if (enabled) {
          await fetchUsage({ forceRefresh: true })
        }
      } catch (error) {
        console.error(`Failed to update ${config.name} usage setting:`, error)
      }
    }

    return {
      ...createUsagePatch(config.prefix, {
        scope: config.initialScope,
        range: config.initialRange,
        scanState: null,
        summary: null,
        daily: [],
        modelBreakdown: [],
        projectBreakdown: [],
        recentSessions: []
      }),
      [`set${config.name}UsageEnabled`]: setEnabled,
      [`set${config.name}UsageScope`]: async (scope: T['scope']) => {
        update({ scope })
        await fetchUsage()
      },
      [`set${config.name}UsageRange`]: async (range: T['range']) => {
        const normalized = normalizeUsageFilterRange(range)
        if (!normalized) {
          return
        }
        update({ range: normalized })
        await fetchUsage()
      },
      [`fetch${config.name}Usage`]: fetchUsage,
      [`enable${config.name}Usage`]: () => setEnabled(true),
      [`refresh${config.name}Usage`]: () => fetchUsage({ forceRefresh: true })
    } as ProviderUsageSlice<Prefix, Name, T>
  }
}

type ClaudeUsageShape = UsageShape<ClaudeUsageScope, ClaudeUsageRange, ClaudeUsageSnapshot>
type CodexUsageShape = UsageShape<CodexUsageScope, CodexUsageRange, CodexUsageSnapshot>
type OpenCodeUsageShape = UsageShape<OpenCodeUsageScope, OpenCodeUsageRange, OpenCodeUsageSnapshot>

export type ClaudeUsageSlice = ProviderUsageSlice<'claude', 'Claude', ClaudeUsageShape> &
  AllUsageFiltersSlice
export type CodexUsageSlice = ProviderUsageSlice<'codex', 'Codex', CodexUsageShape>
export type OpenCodeUsageSlice = ProviderUsageSlice<'openCode', 'OpenCode', OpenCodeUsageShape>

const createClaudeProviderSlice = createUsageProviderSlice<'claude', 'Claude', ClaudeUsageShape>({
  prefix: 'claude',
  name: 'Claude',
  initialScope: 'all',
  initialRange: '30d',
  getApi: () => window.api.claudeUsage,
  hasCachedData: (state) => state.hasAnyClaudeData
})

export const createCodexUsageSlice = createUsageProviderSlice<'codex', 'Codex', CodexUsageShape>({
  prefix: 'codex',
  name: 'Codex',
  initialScope: 'all',
  initialRange: '30d',
  getApi: () => window.api.codexUsage,
  hasCachedData: (state) => state.hasAnyCodexData
})

export const createOpenCodeUsageSlice = createUsageProviderSlice<
  'openCode',
  'OpenCode',
  OpenCodeUsageShape
>({
  prefix: 'openCode',
  name: 'OpenCode',
  initialScope: 'all',
  initialRange: '30d',
  getApi: () => window.api.openCodeUsage,
  hasCachedData: (state) => state.hasAnyOpenCodeData
})

export const createClaudeUsageSlice: StateCreator<AppState, [], [], ClaudeUsageSlice> = (
  ...args
) => ({
  ...createClaudeProviderSlice(...args),
  ...createAllUsageFiltersActions(...args)
})
