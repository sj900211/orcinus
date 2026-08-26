import { useEffect } from 'react'
import { handleTransferProgress } from './server-explorer-transfers'

/** Subscribe the panel to SFTP transfer progress once; the returned unsubscribe runs on unmount. */
export function useServerExplorerTransferProgress(): void {
  useEffect(() => window.api.sftp.onTransferProgress(handleTransferProgress), [])
}
