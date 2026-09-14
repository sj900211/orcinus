import { createUIStore } from '@/store/slices/ui-slice-test-harness'
import {
  createClaudeUsageSlice,
  createCodexUsageSlice,
  createOpenCodeUsageSlice
} from '@/store/slices/usage-provider-slices'

export function createUsagePaneStore() {
  const store = createUIStore()
  const args = [store.setState, store.getState, store] as const
  store.setState({
    ...createClaudeUsageSlice(...args),
    ...createCodexUsageSlice(...args),
    ...createOpenCodeUsageSlice(...args)
  })
  const scan = {
    enabled: true,
    isScanning: false,
    lastScanStartedAt: 1,
    lastScanCompletedAt: 1,
    lastScanError: null
  }
  const summary = {
    scope: 'all' as const,
    range: '30d' as const,
    sessions: 1,
    inputTokens: 1500,
    outputTokens: 100,
    estimatedCostUsd: null,
    topModel: 'model',
    topProject: 'project'
  }
  store.setState({
    claudeUsageScanState: { ...scan, hasAnyClaudeData: true },
    codexUsageScanState: { ...scan, hasAnyCodexData: true },
    openCodeUsageScanState: { ...scan, hasAnyOpenCodeData: true },
    claudeUsageSummary: {
      ...summary,
      turns: 1,
      zeroCacheReadTurns: 0,
      cacheReadTokens: 300,
      cacheWriteTokens: 200,
      cacheReuseRate: null,
      hasAnyClaudeData: true
    },
    codexUsageSummary: {
      ...summary,
      events: 1,
      cachedInputTokens: 300,
      reasoningOutputTokens: 0,
      totalTokens: 1600,
      hasAnyCodexData: true
    },
    openCodeUsageSummary: {
      ...summary,
      events: 1,
      cachedInputTokens: 300,
      reasoningOutputTokens: 0,
      totalTokens: 1600,
      hasAnyOpenCodeData: true
    }
  })
  return store
}
