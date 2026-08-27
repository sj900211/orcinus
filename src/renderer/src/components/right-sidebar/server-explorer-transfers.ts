import { toast } from 'sonner'
import type { SftpTransferProgress } from '../../../../preload/api/sftp-api'
import { translate } from '@/i18n/i18n'

// SFTP transfer orchestration for the Server Explorer: fire a download/upload, then track it as one
// sonner toast keyed by transferId (loading → percentage → done/error), with a cancel action. Kept
// self-contained so the panel only has to subscribe onTransferProgress once and call these.

type TransferKind = 'download' | 'upload'
const tracked = new Map<string, { kind: TransferKind; label: string; remoteDir: string }>()

function posixBasename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

function pendingLabel(kind: TransferKind, label: string): string {
  return kind === 'download'
    ? translate(
        'auto.components.right-sidebar.ServerExplorer.downloading',
        'Downloading {{value0}}…',
        {
          value0: label
        }
      )
    : translate(
        'auto.components.right-sidebar.ServerExplorer.uploading',
        'Uploading to {{value0}}…',
        {
          value0: label
        }
      )
}

function successLabel(kind: TransferKind, label: string): string {
  return kind === 'download'
    ? translate(
        'auto.components.right-sidebar.ServerExplorer.downloaded',
        'Downloaded {{value0}}',
        {
          value0: label
        }
      )
    : translate('auto.components.right-sidebar.ServerExplorer.uploaded', 'Uploaded to {{value0}}', {
        value0: label
      })
}

function showPending(transferId: string, kind: TransferKind, label: string, suffix = ''): void {
  toast.loading(`${pendingLabel(kind, label)}${suffix}`, {
    id: transferId,
    action: {
      label: translate('auto.components.right-sidebar.ServerExplorer.cancelTransfer', 'Cancel'),
      onClick: () => void window.api.sftp.cancelTransfer({ transferId })
    }
  })
}

/**
 * Dispatch one progress event to its tracked toast; resolves + forgets on a terminal phase. On any
 * terminal phase of an upload, `onUploadSettled(remoteDir)` fires so the tree can refresh the
 * destination (uploaded files/dirs would otherwise not appear until a manual refresh).
 */
export function handleTransferProgress(
  event: SftpTransferProgress,
  onUploadSettled?: (remoteDir: string) => void
): void {
  const entry = tracked.get(event.transferId)
  if (!entry) {
    return
  }
  if (event.phase === 'start' || event.phase === 'progress') {
    const suffix = event.totalBytes
      ? ` ${Math.min(100, Math.round((event.bytesTransferred / event.totalBytes) * 100))}%`
      : ''
    showPending(event.transferId, entry.kind, entry.label, suffix)
    return
  }
  tracked.delete(event.transferId)
  if (entry.kind === 'upload') {
    onUploadSettled?.(entry.remoteDir)
  }
  if (event.phase === 'done') {
    toast.success(successLabel(entry.kind, entry.label), { id: event.transferId })
  } else if (event.phase === 'canceled') {
    toast.dismiss(event.transferId)
  } else {
    toast.error(
      event.error ??
        translate('auto.components.right-sidebar.ServerExplorer.transferFailed', 'Transfer failed'),
      { id: event.transferId }
    )
  }
}

export async function downloadServerFile(
  targetId: string,
  remotePath: string,
  fileName: string
): Promise<void> {
  const result = await window.api.sftp.startDownload({ targetId, remotePath })
  if ('canceled' in result) {
    return
  }
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  tracked.set(result.transferId, { kind: 'download', label: fileName, remoteDir: '' })
  showPending(result.transferId, 'download', fileName)
}

/**
 * Download one or more remote paths as a single .tar.gz archive (streamed via `tar` over exec).
 * `name` labels the toast: a single item's basename, or "N items" for a multi-selection.
 */
export async function downloadServerArchive(
  targetId: string,
  remotePaths: string[],
  name: string
): Promise<void> {
  const result = await window.api.sftp.downloadArchive({ targetId, remotePaths })
  if ('canceled' in result) {
    return
  }
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  const label = `${name}.tar.gz`
  tracked.set(result.transferId, { kind: 'download', label, remoteDir: '' })
  showPending(result.transferId, 'download', label)
}

export type UploadConflictResolution =
  | { action: 'overwrite' }
  | { action: 'skip' }
  | { action: 'rename'; newName: string }
  | { action: 'cancel' }

/**
 * Upload local files, resolving remote name collisions via `resolveConflict` (overwrite / rename /
 * skip / cancel). Two-phase: plan (pick + detect conflicts) → prompt per conflict → perform.
 */
export async function uploadFilesToServerDir(
  targetId: string,
  remoteDir: string,
  resolveConflict: (name: string) => Promise<UploadConflictResolution>
): Promise<void> {
  const plan = await window.api.sftp.planUpload({ targetId, remoteDir })
  if ('canceled' in plan) {
    return
  }
  if ('error' in plan) {
    toast.error(plan.error)
    return
  }
  const uploads: Array<{ localPath: string; remoteName: string; overwrite: boolean }> = []
  for (const item of plan.items) {
    if (!item.conflict) {
      uploads.push({ localPath: item.localPath, remoteName: item.name, overwrite: false })
      continue
    }
    const resolution = await resolveConflict(item.name)
    if (resolution.action === 'cancel') {
      return
    }
    if (resolution.action === 'skip') {
      continue
    }
    if (resolution.action === 'overwrite') {
      uploads.push({ localPath: item.localPath, remoteName: item.name, overwrite: true })
    } else {
      uploads.push({ localPath: item.localPath, remoteName: resolution.newName, overwrite: false })
    }
  }
  if (uploads.length === 0) {
    return
  }
  const result = await window.api.sftp.performUpload({ targetId, remoteDir, uploads })
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  const label = posixBasename(remoteDir) || remoteDir
  tracked.set(result.transferId, { kind: 'upload', label, remoteDir })
  showPending(result.transferId, 'upload', label)
}

/** Upload whole local folders (recursively) into the remote directory (exclusive, no conflict prompt). */
export async function uploadFolderToServerDir(targetId: string, remoteDir: string): Promise<void> {
  const result = await window.api.sftp.startUpload({ targetId, remoteDir, directories: true })
  if ('canceled' in result) {
    return
  }
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  const label = posixBasename(remoteDir) || remoteDir
  tracked.set(result.transferId, { kind: 'upload', label, remoteDir })
  showPending(result.transferId, 'upload', label)
}
