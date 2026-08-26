import { useCallback, useRef, useState } from 'react'
import { uploadFilesToServerDir, type UploadConflictResolution } from './server-explorer-transfers'

export type ServerExplorerUpload = {
  conflictName: string | null
  resolveConflict: (resolution: UploadConflictResolution) => void
  uploadFiles: (remoteDir: string) => void
}

// File upload with a per-conflict overwrite/rename/skip prompt. Conflicts are resolved one at a time:
// the orchestration awaits askConflict, which parks the promise until the dialog calls resolveConflict.
export function useServerExplorerUpload(selectedHostId: string | null): ServerExplorerUpload {
  const [conflictName, setConflictName] = useState<string | null>(null)
  const resolverRef = useRef<((resolution: UploadConflictResolution) => void) | null>(null)

  const askConflict = useCallback(
    (name: string) =>
      new Promise<UploadConflictResolution>((resolve) => {
        resolverRef.current = resolve
        setConflictName(name)
      }),
    []
  )

  const resolveConflict = useCallback((resolution: UploadConflictResolution) => {
    setConflictName(null)
    const resolve = resolverRef.current
    resolverRef.current = null
    resolve?.(resolution)
  }, [])

  const uploadFiles = useCallback(
    (remoteDir: string) => {
      if (!selectedHostId) {
        return
      }
      void uploadFilesToServerDir(selectedHostId, remoteDir, askConflict)
    },
    [selectedHostId, askConflict]
  )

  return { conflictName, resolveConflict, uploadFiles }
}
