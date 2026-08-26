import { toast } from 'sonner'
import type { SftpTransferProgress } from '../../../../preload/api/sftp-api'
import { translate } from '@/i18n/i18n'

// SFTP transfer orchestration for the Server Explorer: fire a download/upload, then track it as one
// sonner toast keyed by transferId (loading → percentage → done/error), with a cancel action. Kept
// self-contained so the panel only has to subscribe onTransferProgress once and call these.

type TransferKind = 'download' | 'upload'
const tracked = new Map<string, { kind: TransferKind; label: string }>()

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

/** Dispatch one progress event to its tracked toast; resolves + forgets on a terminal phase. */
export function handleTransferProgress(event: SftpTransferProgress): void {
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
  tracked.set(result.transferId, { kind: 'download', label: fileName })
  showPending(result.transferId, 'download', fileName)
}

export async function uploadToServerDir(targetId: string, remoteDir: string): Promise<void> {
  // Interim (dungeon 7-A): exclusive upload — never clobber an existing remote file, so a canceled
  // upload can't corrupt one. Dungeon 8 adds the overwrite/rename conflict prompt + atomic temp-rename.
  const result = await window.api.sftp.startUpload({ targetId, remoteDir })
  if ('canceled' in result) {
    return
  }
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  const label = posixBasename(remoteDir) || remoteDir
  tracked.set(result.transferId, { kind: 'upload', label })
  showPending(result.transferId, 'upload', label)
}
