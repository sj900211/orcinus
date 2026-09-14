import { describe, expect, it } from 'vitest'
import type { ClaudeUsageDailyAggregate, ClaudeUsagePersistedState } from './types'
import { buildSummary, buildBreakdown } from './claude-usage-report-aggregation'

function dailyRow(day: string, model: string): ClaudeUsageDailyAggregate {
  return {
    day,
    model,
    projectKey: 'project',
    projectLabel: 'project',
    repoId: null,
    worktreeId: 'worktree-1',
    turnCount: 1,
    zeroCacheReadTurnCount: 0,
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cacheWrite1hTokens: 0
  }
}

function stateWithDaily(dailyAggregates: ClaudeUsageDailyAggregate[]): ClaudeUsagePersistedState {
  return {
    schemaVersion: 6,
    worktreeFingerprint: null,
    processedFiles: [],
    sessions: [],
    dailyAggregates,
    scanState: {
      enabled: true,
      lastScanStartedAt: null,
      lastScanCompletedAt: null,
      lastScanError: null
    }
  }
}

describe('buildSummary Claude Sonnet 5 pricing over time', () => {
  it.each(['cacheReadTokens', 'cacheWriteTokens'] as const)(
    'ranks models and projects by totals including %s',
    (cacheField) => {
      const state = stateWithDaily(
        Array.from({ length: 6 }, (_, index) => ({
          ...dailyRow('2026-06-01', `model${index}`),
          projectKey: `project${index}`,
          projectLabel: `project${index}`,
          inputTokens: 6 - index,
          outputTokens: 0,
          [cacheField]: index === 5 ? 1_000_000 : 0
        }))
      )
      expect(buildSummary(state, 'all', 'all')).toMatchObject({
        topModel: 'model5',
        topProject: 'project5'
      })
      expect(buildBreakdown(state, 'all', 'all', 'model')[0].key).toBe('model5')
      expect(buildBreakdown(state, 'all', 'all', 'project')[0].key).toBe('project5')
    }
  )
  it('includes cache reads and writes in the selected range total', () => {
    const state = stateWithDaily([
      { ...dailyRow('2026-06-01', 'claude-sonnet-5'), cacheReadTokens: 300, cacheWriteTokens: 400 },
      dailyRow('2026-05-01', 'claude-sonnet-5')
    ])
    expect(buildSummary(state, 'all', 'custom:2026-06-01..2026-06-01').totalTokens).toBe(2_000_700)
    expect(buildSummary(stateWithDaily([]), 'all', 'all').totalTokens).toBe(0)
  })
  // Why: the "All" range re-prices historical days on every render, so a day inside the
  // announced 2026-08-31 introductory window has to price the same as a later day —
  // the scheduled $3/$15 increase was cancelled and never took effect.
  it('prices an introductory-window day and a post-window day at the same $2/$10 rate', () => {
    const inWindow = buildSummary(
      stateWithDaily([dailyRow('2026-08-15', 'claude-sonnet-5')]),
      'all',
      'all'
    )
    const afterWindow = buildSummary(
      stateWithDaily([dailyRow('2026-09-15', 'claude-sonnet-5')]),
      'all',
      'all'
    )

    expect(inWindow.estimatedCostUsd).toBeCloseTo(12)
    expect(afterWindow.estimatedCostUsd).toBeCloseTo(12)
  })

  it('sums both days in the All range without re-pricing history upward', () => {
    const summary = buildSummary(
      stateWithDaily([
        dailyRow('2026-08-15', 'claude-sonnet-5'),
        dailyRow('2026-09-15', 'claude-sonnet-5')
      ]),
      'all',
      'all'
    )

    expect(summary.estimatedCostUsd).toBeCloseTo(24)
  })
})
