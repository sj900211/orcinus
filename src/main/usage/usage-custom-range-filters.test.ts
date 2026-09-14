import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getFilteredDaily as claudeDaily,
  getFilteredSessions as claudeSessions
} from '../claude-usage/claude-usage-scope-filters'
import {
  getFilteredDaily as codexDaily,
  getFilteredSessions as codexSessions
} from '../codex-usage/codex-usage-scope-filters'
import {
  filterDailyAggregatesByScopeAndRange,
  filterSessionsByScopeAndRange
} from '../opencode-usage/scope-range-filter'

const days = ['2026-06-12', '2026-06-13', '2026-09-13', '2026-09-14']
const dailyAggregates = days.map((day) => ({
  day,
  model: null,
  projectKey: 'local',
  projectLabel: 'Local',
  repoId: null,
  worktreeId: null,
  turnCount: 1,
  zeroCacheReadTurnCount: 0,
  eventCount: 1,
  inputTokens: 1,
  outputTokens: 1,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cacheWrite1hTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 2,
  hasInferredPricing: false,
  estimatedCostUsd: null
}))
const sessions = days.map((day) => ({
  sessionId: day,
  firstTimestamp: `${day}T12:00:00`,
  lastTimestamp: `${day}T23:30:00`,
  model: null,
  lastCwd: null,
  lastGitBranch: null,
  primaryWorktreeId: null,
  primaryRepoId: null,
  turnCount: 1,
  totalInputTokens: 1,
  totalOutputTokens: 1,
  totalCacheReadTokens: 0,
  totalCacheWriteTokens: 0,
  totalCacheWrite1hTokens: 0,
  locationBreakdown: [],
  primaryModel: null,
  hasMixedModels: false,
  primaryProjectLabel: 'Local',
  hasMixedLocations: false,
  eventCount: 1,
  totalCachedInputTokens: 0,
  totalReasoningOutputTokens: 0,
  totalTokens: 2,
  hasInferredPricing: false,
  modelBreakdown: [],
  locationModelBreakdown: [],
  estimatedCostUsd: null
}))
const state = {
  schemaVersion: 1,
  worktreeFingerprint: null,
  processedFiles: [],
  dailyAggregates,
  sessions,
  scanState: {
    enabled: true,
    lastScanStartedAt: null,
    lastScanCompletedAt: null,
    lastScanError: null
  }
}
const range = 'custom:2026-06-13..2026-09-13'

describe('custom inclusive bounds in provider filters', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 8, 14, 12))
  })
  afterEach(() => vi.useRealTimers())

  it('Claude excludes days and sessions after until', () => {
    expect(claudeDaily(state, 'all', range).map((row) => row.day)).toEqual(days.slice(1, 3))
    expect(claudeSessions(state, 'all', range).map((row) => row.sessionId)).toEqual(
      days.slice(1, 3)
    )
  })
  it('Codex excludes days and sessions after until', () => {
    expect(codexDaily(state, 'all', range).map((row) => row.day)).toEqual(days.slice(1, 3))
    expect(codexSessions(state, 'all', range).map((row) => row.sessionId)).toEqual(days.slice(1, 3))
  })
  it('OpenCode excludes days and sessions after until', () => {
    expect(
      filterDailyAggregatesByScopeAndRange(dailyAggregates, 'all', range).map((row) => row.day)
    ).toEqual(days.slice(1, 3))
    expect(
      filterSessionsByScopeAndRange(sessions, 'all', range).map((row) => row.sessionId)
    ).toEqual(days.slice(1, 3))
  })
})
