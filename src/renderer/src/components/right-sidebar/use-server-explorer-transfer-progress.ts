import { useEffect, useRef } from 'react'
import { handleTransferProgress } from './server-explorer-transfers'

/**
 * Subscribe the panel to SFTP transfer progress once; the returned unsubscribe runs on unmount.
 * `onUploadSettled(remoteDir)` fires when an upload finishes so the tree can refresh the destination.
 */
export function useServerExplorerTransferProgress(
  onUploadSettled: (remoteDir: string) => void
): void {
  const settledRef = useRef(onUploadSettled)
  settledRef.current = onUploadSettled
  useEffect(
    () =>
      window.api.sftp.onTransferProgress((event) =>
        handleTransferProgress(event, (remoteDir) => settledRef.current(remoteDir))
      ),
    []
  )
}
