import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import Database from '../sqlite/sync-database'
import { parseOpenCodeUsageDatabase } from './scanner'
import { parseOpenCodeUsageRow } from './opencode-usage-row-parsing'
import {
  buildOpenCodeUsageSummary,
  buildOpenCodeUsageDailyPoints,
  buildOpenCodeUsageBreakdownRows,
  buildOpenCodeUsageRecentSessions
} from './snapshot-rollups'

it.each([undefined, 2000])('preserves cache writes and explicit totals (%s)', (total) => {
  const row = {
    id: 'message',
    session_id: 'session',
    time_created: 1_777_777_700_000,
    time_updated: null,
    directory: null,
    title: null,
    worktree: null,
    session_model: null,
    data: JSON.stringify({ tokens: { input: 100, output: 20, cache: { write: 1000 }, total } })
  }
  expect(parseOpenCodeUsageRow(row)).toMatchObject({
    cacheWriteTokens: 1000,
    totalTokens: total ?? 1120
  })
  row.data = JSON.stringify({
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 2000, write: 1000 } }
  })
  expect(parseOpenCodeUsageRow(row)).toMatchObject({
    inputTokens: 100,
    cachedInputTokens: 2000,
    cacheWriteTokens: 1000,
    totalTokens: 3125
  })
})

it('preserves cache writes from session storage through all snapshot rollups', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'opencode-cache-write-'))
  try {
    const path = join(dir, 'opencode.db')
    const db = new Database(path)
    try {
      db.exec(`CREATE TABLE session (
        id TEXT, directory TEXT, title TEXT, cost REAL, tokens_input INTEGER,
        tokens_output INTEGER, tokens_reasoning INTEGER, tokens_cache_read INTEGER,
        tokens_cache_write INTEGER, time_created INTEGER, time_updated INTEGER
      ); INSERT INTO session VALUES ('session', '/project', '', 0, 100, 20, 0, 0, 1000, 1777777700000, 1777777700000);`)
    } finally {
      db.close()
    }
    const { sessions, dailyAggregates } = await parseOpenCodeUsageDatabase(path, [])
    const expected = { cacheWriteTokens: 1000, totalTokens: 1120 }
    expect(sessions[0]).toMatchObject(expected)
    expect(sessions[0].modelBreakdown[0]).toMatchObject(expected)
    expect(sessions[0].locationBreakdown[0]).toMatchObject(expected)
    expect(sessions[0].locationModelBreakdown[0]).toMatchObject(expected)
    expect(dailyAggregates[0]).toMatchObject(expected)
    expect(buildOpenCodeUsageSummary('all', 'all', dailyAggregates, sessions)).toMatchObject(
      expected
    )
    expect(buildOpenCodeUsageDailyPoints(dailyAggregates)[0]).toMatchObject(expected)
    expect(buildOpenCodeUsageBreakdownRows('model', dailyAggregates, sessions)[0]).toMatchObject(
      expected
    )
    expect(buildOpenCodeUsageBreakdownRows('project', dailyAggregates, sessions)[0]).toMatchObject(
      expected
    )
    expect(buildOpenCodeUsageRecentSessions(sessions)[0]).toMatchObject(expected)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
