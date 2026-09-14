import type { ClaudeUsageDailyPoint } from './claude-usage-types'

export function getClaudeUsageTotal(
  tokens: Pick<
    ClaudeUsageDailyPoint,
    'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'
  >
): number {
  return tokens.inputTokens + tokens.outputTokens + tokens.cacheReadTokens + tokens.cacheWriteTokens
}
