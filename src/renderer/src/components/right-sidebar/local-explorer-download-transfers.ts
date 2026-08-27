import { toast } from 'sonner'
import type { SftpTransferProgress } from '../../../../preload/api/sftp-api'
import { translate } from '@/i18n/i18n'

// Toast + tracking for a remote -> local download started by dropping SFTP items onto the LOCAL File
// Explorer (dungeon 11-3). Mirrors server-explorer-transfers, but keyed to a LOCAL destination dir so
// the local tree can refresh when the transfer settles.
const tracked = new Map<string, { label: string; localDir: string }>()

function baseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return index === -1 ? trimmed : trimmed.slice(index + 1)
}

function showPending(transferId: string, label: string, suffix = ''): void {
  toast.loading(
    `${translate(
      'auto.components.right-sidebar.localDownload.downloading',
      'Downloading {{value0}}…',
      { value0: label }
    )}${suffix}`,
    {
      id: transferId,
      action: {
        label: translate('auto.components.right-sidebar.localDownload.cancel', 'Cancel'),
        onClick: () => void window.api.sftp.cancelTransfer({ transferId })
      }
    }
  )
}

/** Download remote paths (from an SFTP drag payload) into a local directory via the dialog-less IPC. */
export async function downloadRemotePathsToLocalDir(
  targetId: string,
  remotePaths: string[],
  localDir: string
): Promise<void> {
  if (remotePaths.length === 0) {
    return
  }
  const result = await window.api.sftp.downloadToDir({ targetId, remotePaths, localDir })
  if ('error' in result) {
    toast.error(result.error)
    return
  }
  const label =
    remotePaths.length === 1
      ? baseName(remotePaths[0]!)
      : translate('auto.components.right-sidebar.localDownload.items', '{{value0}} items', {
          value0: remotePaths.length
        })
  tracked.set(result.transferId, { label, localDir })
  showPending(result.transferId, label)
}

/**
 * Dispatch one progress frame to its download toast; on a terminal phase, `onSettled(localDir)` fires
 * so the local tree can refresh (downloaded items would otherwise not appear until a manual refresh).
 */
export function handleLocalDownloadProgress(
  event: SftpTransferProgress,
  onSettled?: (localDir: string) => void
): void {
  const entry = tracked.get(event.transferId)
  if (!entry) {
    return
  }
  if (event.phase === 'start' || event.phase === 'progress') {
    // Download totals are indeterminate (no pre-walk), so show transferred bytes instead of a percent.
    const suffix = event.bytesTransferred
      ? ` ${(event.bytesTransferred / 1024 / 1024).toFixed(1)} MB`
      : ''
    showPending(event.transferId, entry.label, suffix)
    return
  }
  tracked.delete(event.transferId)
  onSettled?.(entry.localDir)
  if (event.phase === 'done') {
    toast.success(
      translate('auto.components.right-sidebar.localDownload.downloaded', 'Downloaded {{value0}}', {
        value0: entry.label
      }),
      { id: event.transferId }
    )
  } else if (event.phase === 'canceled') {
    toast.dismiss(event.transferId)
  } else {
    toast.error(
      event.error ??
        translate('auto.components.right-sidebar.localDownload.failed', 'Download failed'),
      { id: event.transferId }
    )
  }
}
