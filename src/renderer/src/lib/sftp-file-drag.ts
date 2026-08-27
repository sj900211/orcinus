// A drag that ORIGINATES from the SFTP Server Explorer. Carried as a SECONDARY mime alongside the
// shared WORKSPACE_FILE_PATH_MIME so a drop target can tell a remote-origin drag from a local-origin
// one — both panels reuse the same row component and would otherwise be indistinguishable. The
// payload names the source host so a download can be routed from the drag itself, never from a
// panel's current selection (which may differ or change mid-drag).
export const SFTP_FILE_DRAG_MIME = 'text/x-orca-sftp-file'

export type SftpFileDragPayload = { hostId: string; paths: string[] }

export function encodeSftpFileDrag(payload: SftpFileDragPayload): string {
  return JSON.stringify(payload)
}

/**
 * Read the SFTP drag payload, or null when the drag is not an SFTP-origin drag (or is malformed).
 * Only usable on `drop` — browsers blank `getData` during `dragover`; gate hover with hasSftpFileDrag.
 */
export function readSftpFileDrag(
  dataTransfer: Pick<DataTransfer, 'getData'>
): SftpFileDragPayload | null {
  const raw = dataTransfer.getData(SFTP_FILE_DRAG_MIME)
  if (!raw) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      typeof (parsed as SftpFileDragPayload).hostId === 'string' &&
      Array.isArray((parsed as SftpFileDragPayload).paths)
    ) {
      const { hostId, paths } = parsed as SftpFileDragPayload
      const cleanPaths = paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
      if (hostId.length > 0 && cleanPaths.length > 0) {
        return { hostId, paths: cleanPaths }
      }
    }
  } catch {
    // Malformed payload — treat as a non-SFTP drag.
  }
  return null
}

/**
 * True when the drag carries the SFTP mime. Uses `types` (available during `dragover`, unlike
 * `getData`), so drop targets can short-circuit a remote-origin drag BEFORE the shared local/remote
 * move handling — a remote drag must never be treated as a filesystem move.
 */
export function hasSftpFileDrag(dataTransfer: Pick<DataTransfer, 'types'>): boolean {
  return Array.from(dataTransfer.types).includes(SFTP_FILE_DRAG_MIME)
}
