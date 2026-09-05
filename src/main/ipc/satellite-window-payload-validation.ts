// Wire-payload validators for satellite window IPC (split from
// satellite-window.ts for the max-lines rule; pure functions, no state).
import type {
  PersistedSatelliteWindowSession,
  SatelliteBootFile,
  SatelliteFileEntry,
  SatelliteMovedFile
} from '../../shared/satellite-window-payloads'

export function isBootFile(value: unknown): value is SatelliteBootFile {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const record = value as Record<string, unknown>
  return (['filePath', 'relativePath', 'language'] as const).every(
    (key) => typeof record[key] === 'string' && record[key] !== ''
  )
}

export function isMovedFile(value: unknown): value is SatelliteMovedFile {
  if (!isBootFile(value)) {
    return false
  }
  const record = value as Record<string, unknown>
  const optionalString = (key: string): boolean =>
    record[key] === undefined || typeof record[key] === 'string'
  const optionalNumber = (key: string): boolean =>
    record[key] === undefined || (typeof record[key] === 'number' && Number.isFinite(record[key]))
  const selectionsValid =
    record.selections === undefined ||
    (Array.isArray(record.selections) &&
      record.selections.every(
        (sel) =>
          typeof sel === 'object' &&
          sel !== null &&
          (
            [
              'selectionStartLineNumber',
              'selectionStartColumn',
              'positionLineNumber',
              'positionColumn'
            ] as const
          ).every((key) => typeof (sel as Record<string, unknown>)[key] === 'number')
      ))
  return (
    optionalString('dirtyDraftContent') &&
    optionalString('lastKnownDiskSignature') &&
    optionalString('markdownViewMode') &&
    optionalNumber('cursorLine') &&
    optionalNumber('scrollTop') &&
    selectionsValid
  )
}

export function isFileEntryList(value: unknown): value is SatelliteFileEntry[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as Record<string, unknown>).fileId === 'string' &&
        typeof (entry as Record<string, unknown>).filePath === 'string' &&
        typeof (entry as Record<string, unknown>).relativePath === 'string' &&
        typeof (entry as Record<string, unknown>).language === 'string'
    )
  )
}

/** Load-time salvage for the persisted restore list: malformed entries mean
 *  "skip restore", never a startup crash (mobile-tab-selections precedent). */
export function normalizeSatelliteWindowSessions(
  value: unknown
): PersistedSatelliteWindowSession[] {
  if (!Array.isArray(value)) {
    return []
  }
  const sessions: PersistedSatelliteWindowSession[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) {
      continue
    }
    const record = entry as Record<string, unknown>
    if (typeof record.satelliteId !== 'string' || record.satelliteId === '') {
      continue
    }
    if (typeof record.worktreeId !== 'string' || record.worktreeId === '') {
      continue
    }
    if (!Array.isArray(record.files) || !record.files.every((file) => isMovedFile(file))) {
      continue
    }
    const bounds = record.bounds
    const boundsValid =
      bounds === undefined ||
      (typeof bounds === 'object' &&
        bounds !== null &&
        (['x', 'y', 'width', 'height'] as const).every(
          (key) => typeof (bounds as Record<string, unknown>)[key] === 'number'
        ))
    if (!boundsValid) {
      continue
    }
    sessions.push(entry as PersistedSatelliteWindowSession)
  }
  return sessions
}
