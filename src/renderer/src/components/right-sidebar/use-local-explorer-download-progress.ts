import { useEffect } from 'react'
import { handleLocalDownloadProgress } from './local-explorer-download-transfers'

// Subscribe the LOCAL File Explorer to SFTP transfer progress so a drop-download's toast advances and
// the destination local dir refreshes when it settles. Filters to its own tracked transfers, so it
// never reacts to Server-panel transfers (the shared progress channel is a broadcast).
export function useLocalExplorerDownloadProgress(
  refreshDir: (dirPath: string) => Promise<void>
): void {
  useEffect(() => {
    return window.api.sftp.onTransferProgress((event) => {
      handleLocalDownloadProgress(event, (localDir) => {
        void refreshDir(localDir)
      })
    })
  }, [refreshDir])
}
