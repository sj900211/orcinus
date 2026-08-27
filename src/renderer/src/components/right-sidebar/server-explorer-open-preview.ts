import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { detectLanguage } from '@/lib/language-detect'
import { translate } from '@/i18n/i18n'

// Open a remote SFTP file as a READ-ONLY tab in the main workspace editor — the same native Monaco
// local files use, owned by the active worktree (mirrors AI Vault "View Log"). `sftpTargetId` routes
// the content read over the SFTP host connection (see useEditorPanelFileContentLoader). Requires an
// open workspace to own the tab; the tab is not persisted across restarts (Phase 1).
export function openServerFilePreview(targetId: string, remotePath: string, name: string): void {
  const state = useAppStore.getState()
  const worktreeId = state.activeWorktreeId
  if (!worktreeId) {
    toast.error(
      translate(
        'auto.components.right-sidebar.ServerExplorer.previewNeedsWorkspace',
        'Open a workspace to preview remote files.'
      )
    )
    return
  }
  state.openFile(
    {
      filePath: remotePath,
      // Keep relativePath === filePath so the loader reads the exact remote path.
      relativePath: remotePath,
      worktreeId,
      // Pin: never let an active runtime reinterpret this remote path.
      runtimeEnvironmentId: null,
      language: detectLanguage(name),
      mode: 'edit',
      readOnly: true,
      isPreview: true,
      sftpTargetId: targetId
    },
    {
      preview: true,
      suppressActiveRuntimeFallback: true,
      targetGroupId: state.activeGroupIdByWorktree?.[worktreeId] ?? undefined
    }
  )
}
