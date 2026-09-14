import type { UsageRange } from '../../../../shared/usage-range'

export type UsageSnapshot = {
  scanState: {
    enabled: boolean
    isScanning: boolean
    lastScanCompletedAt: number | null
    lastScanError: string | null
  }
  summary: object
  daily: object[]
  modelBreakdown: object[]
  projectBreakdown: object[]
  recentSessions: object[]
}

export type UsageShape<
  Scope extends string,
  Range extends UsageRange,
  Snapshot extends UsageSnapshot
> = {
  scope: Scope
  range: Range
  snapshot: Snapshot
}

export type UsageData<T extends UsageShape<string, UsageRange, UsageSnapshot>> = {
  scope: T['scope']
  range: T['range']
  scanState: T['snapshot']['scanState'] | null
  summary: T['snapshot']['summary'] | null
  daily: T['snapshot']['daily']
  modelBreakdown: T['snapshot']['modelBreakdown']
  projectBreakdown: T['snapshot']['projectBreakdown']
  recentSessions: T['snapshot']['recentSessions']
}

export type UsageApi<T extends UsageShape<string, UsageRange, UsageSnapshot>> = {
  getScanState: () => Promise<T['snapshot']['scanState']>
  setEnabled: (args: { enabled: boolean }) => Promise<T['snapshot']['scanState']>
  refresh: (args?: { force?: boolean }) => Promise<T['snapshot']['scanState']>
  getSnapshot: (args: {
    scope: T['scope']
    range: T['range']
    limit?: number
  }) => Promise<T['snapshot']>
}
