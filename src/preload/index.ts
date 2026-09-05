import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { PreloadApi } from './api-types'
import type {
  SftpReaddirResult,
  SftpError,
  SftpTransferProgress,
  SftpHost,
  SftpHostInput,
  SftpHostView,
  SftpProbeListing,
  SftpProbeConnectionInput
} from './api/sftp-api'
import {
  installBrowserFindListener,
  installNativeFileDropHandlers
} from './preload-runtime-support'
import { appApi } from './api/app-bridge'
import { orcaProfilesApi } from './api/orca-profiles-bridge'
import { platformApi } from './api/platform-bridge'
import { wslApi } from './api/wsl-bridge'
import { pwshApi } from './api/pwsh-bridge'
import { gitBashApi } from './api/git-bash-bridge'
import { pluginsApi } from './api/plugins-bridge'
import { reposApi } from './api/repos-bridge'
import { projectsApi } from './api/projects-bridge'
import { projectGroupsApi } from './api/project-groups-bridge'
import { folderWorkspacesApi } from './api/folder-workspaces-bridge'
import { sparsePresetsApi } from './api/sparse-presets-bridge'
import { worktreesApi } from './api/worktrees-bridge'
import { workspaceCleanupApi } from './api/workspace-cleanup-bridge'
import { workspaceSpaceApi } from './api/workspace-space-bridge'
import { workspacePortsApi } from './api/workspace-ports-bridge'
import { ptyApi } from './api/pty-bridge'
import { feedbackApi } from './api/feedback-bridge'
import { crashReportsApi } from './api/crash-reports-bridge'
import { exportApi } from './api/export-bridge'
import { ghApi } from './api/gh-bridge'
import { hostedReviewApi } from './api/hosted-review-bridge'
import { glApiBridge } from './api/gl-bridge'
import { bitbucketApi } from './api/bitbucket-bridge'
import { linearApi } from './api/linear-bridge'
import { jiraApi } from './api/jira-bridge'
import { starNagApi } from './api/star-nag-bridge'
import { diagnosticsApi } from './api/diagnostics-bridge'
import { settingsApi } from './api/settings-bridge'
import { agentAwakeApi } from './api/agent-awake-bridge'
import { localhostWorktreeLabelsApi } from './api/localhost-worktree-labels-bridge'
import { keybindingsApi } from './api/keybindings-bridge'
import { codexAccountsApi } from './api/codex-accounts-bridge'
import { claudeAccountsApi } from './api/claude-accounts-bridge'
import { cliApi } from './api/cli-bridge'
import { codexConfigSyncApi } from './api/codex-config-sync-bridge'
import { agentTrustApi } from './api/agent-trust-bridge'
import { preflightApi } from './api/preflight-bridge'
import { notificationsApi } from './api/notifications-bridge'
import { onboardingApi } from './api/onboarding-bridge'
import { dashboardApi } from './api/dashboard-bridge'
import { terminalPreviewApi } from './api/terminal-preview-bridge'
import { macosTccPromptsApi } from './api/macos-tcc-prompts-bridge'
import { developerPermissionsApi } from './api/developer-permissions-bridge'
import { computerUsePermissionsApi } from './api/computer-use-permissions-bridge'
import { shellApi } from './api/shell-bridge'
import { skillsApi } from './api/skills-bridge'
import { petApi } from './api/pet-bridge'
import { browserApi } from './api/browser-bridge'
import { emulatorApi } from './api/emulator-bridge'
import { hooksApi } from './api/hooks-bridge'
import { ephemeralVmApi } from './api/ephemeral-vm-bridge'
import { cacheApi } from './api/cache-bridge'
import { sessionApi } from './api/session-bridge'
import { remoteWorkspaceApi } from './api/remote-workspace-bridge'
import { updaterApi } from './api/updater-bridge'
import { docPreviewApi } from './api/doc-preview-bridge'
import { notebookApi } from './api/notebook-bridge'
import { fsApi } from './api/fs-bridge'
import { gitApi } from './api/git-bridge'
import { uiApi } from './api/ui-bridge'
import { statsApi } from './api/stats-bridge'
import { memoryApi } from './api/memory-bridge'
import { claudeUsageApi } from './api/claude-usage-bridge'
import { codexUsageApi } from './api/codex-usage-bridge'
import { openCodeUsageApi } from './api/open-code-usage-bridge'
import { aiVaultApi } from './api/ai-vault-bridge'
import { nativeChatApi } from './api/native-chat-bridge'
import { runtimeApi } from './api/runtime-bridge'
import { runtimeEnvironmentsApi } from './api/runtime-environments-bridge'
import { rateLimitsApi } from './api/rate-limits-bridge'
import { minimaxCredentialsApi } from './api/minimax-credentials-bridge'
import { grokAccountsApi } from './api/grok-accounts-bridge'
import { sshApi } from './api/ssh-bridge'
import { automationsApi } from './api/automations-bridge'
import { e2eApi } from './api/e2e-bridge'
import { mobileApi } from './api/mobile-bridge'
import { agentStatusApi } from './api/agent-status-bridge'
import { speechApi } from './api/speech-bridge'

installNativeFileDropHandlers()
installBrowserFindListener()

// Custom APIs for renderer. Each domain bridge owns its IPC contract.
const telemetryTrackApi: PreloadApi['telemetryTrack'] = (name, props) =>
  ipcRenderer.invoke('telemetry:track', name, props)
const telemetrySetOptInApi: PreloadApi['telemetrySetOptIn'] = (optedIn) =>
  ipcRenderer.invoke('telemetry:setOptIn', optedIn)
const telemetryAcknowledgeBannerApi: PreloadApi['telemetryAcknowledgeBanner'] = () =>
  ipcRenderer.invoke('telemetry:acknowledgeBanner')
const telemetryGetConsentStateApi: PreloadApi['telemetryGetConsentState'] = () =>
  ipcRenderer.invoke('telemetry:getConsentState')

const api = {
  app: appApi,
  orcaProfiles: orcaProfilesApi,
  platform: platformApi,
  wsl: wslApi,
  pwsh: pwshApi,
  gitBash: gitBashApi,
  plugins: pluginsApi,
  repos: reposApi,
  projects: projectsApi,
  projectGroups: projectGroupsApi,
  folderWorkspaces: folderWorkspacesApi,
  sparsePresets: sparsePresetsApi,
  worktrees: worktreesApi,
  workspaceCleanup: workspaceCleanupApi,
  workspaceSpace: workspaceSpaceApi,
  workspacePorts: workspacePortsApi,
  projectWindow: {
    // Open a standalone window owning the project (repoId / `folder:` key), or focus it if already open.
    open: (projectKey: string, worktreeId?: string): Promise<void> =>
      ipcRenderer.invoke('projectWindow:open', projectKey, worktreeId),
    // Raise-only: the owner window already shows this project's rows, so no worktree is forwarded.
    raise: (projectKey: string): Promise<void> =>
      ipcRenderer.invoke('projectWindow:raise', projectKey),
    notifyActiveProjectChanged: (projectKey: string): void =>
      ipcRenderer.send('projectWindow:activeProjectChanged', projectKey),
    onOpenProjectsChanged: (callback: (projectKeys: string[]) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, projectKeys: string[]): void =>
        callback(projectKeys)
      ipcRenderer.on('projectWindow:openProjectsChanged', listener)
      return () => ipcRenderer.removeListener('projectWindow:openProjectsChanged', listener)
    }
  },

  satelliteWindow: {
    // Satellite editor windows (Expedition 5): one worktree's editor tabs in a
    // subordinate window. open creates, moveFile pushes into a live satellite.
    open: (
      worktreeId: string,
      file: { filePath: string; relativePath: string; language: string }
    ): Promise<{ satelliteId: string } | null> =>
      ipcRenderer.invoke('satelliteWindow:open', worktreeId, file),
    moveFile: (
      satelliteId: string,
      file: {
        filePath: string
        relativePath: string
        language: string
        dirtyDraftContent?: string
        lastKnownDiskSignature?: string
        cursorLine?: number
        scrollTop?: number
        selections?: {
          selectionStartLineNumber: number
          selectionStartColumn: number
          positionLineNumber: number
          positionColumn: number
        }[]
        markdownViewMode?: string
      }
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('satelliteWindow:moveFile', satelliteId, file),
    raise: (satelliteId: string): Promise<void> =>
      ipcRenderer.invoke('satelliteWindow:raise', satelliteId),
    hitTestCursor: (): Promise<{ satelliteId: string; worktreeId: string } | null> =>
      ipcRenderer.invoke('satelliteWindow:hitTestCursor'),
    getMirror: (): Promise<
      {
        satelliteId: string
        worktreeId: string
        visible: boolean
        files: { fileId: string; filePath: string; relativePath: string; language: string }[]
      }[]
    > => ipcRenderer.invoke('satelliteWindow:getMirror'),
    activateFile: (
      satelliteId: string,
      file: { filePath: string; relativePath: string; language: string }
    ): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('satelliteWindow:activateFile', satelliteId, file),
    moveFileBack: (file: {
      filePath: string
      relativePath: string
      language: string
      dirtyDraftContent?: string
      lastKnownDiskSignature?: string
      cursorLine?: number
      scrollTop?: number
      selections?: {
        selectionStartLineNumber: number
        selectionStartColumn: number
        positionLineNumber: number
        positionColumn: number
      }[]
      markdownViewMode?: string
    }): Promise<{ ok: boolean }> => ipcRenderer.invoke('satelliteWindow:moveFileBack', file),
    onFilesMovedBack: (
      callback: (data: {
        worktreeId: string
        files: {
          filePath: string
          relativePath: string
          language: string
          dirtyDraftContent?: string
          lastKnownDiskSignature?: string
          cursorLine?: number
          scrollTop?: number
          selections?: {
            selectionStartLineNumber: number
            selectionStartColumn: number
            positionLineNumber: number
            positionColumn: number
          }[]
          markdownViewMode?: string
        }[]
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        data: Parameters<typeof callback>[0]
      ): void => callback(data)
      ipcRenderer.on('satellite:filesMovedBack', listener)
      return () => ipcRenderer.removeListener('satellite:filesMovedBack', listener)
    },
    notifyReady: (): Promise<void> => ipcRenderer.invoke('satelliteWindow:ready'),
    /** Satellite renderer only: boot failed terminally (missing repo etc.) —
     *  main drops the persisted restore entry so it cannot zombie. */
    notifyBootFailed: (): void => ipcRenderer.send('satelliteWindow:bootFailed'),
    reportOpenFiles: (
      files: { fileId: string; filePath: string; relativePath: string; language: string }[],
      openSurfaceCount: number,
      dirtyOpenFileCount: number
    ): void =>
      ipcRenderer.send(
        'satelliteWindow:reportOpenFiles',
        files,
        openSurfaceCount,
        dirtyOpenFileCount
      ),
    onCloseRequested: (callback: () => void): (() => void) => {
      const listener = (): void => callback()
      ipcRenderer.on('satelliteWindow:closeRequested', listener)
      return () => {
        ipcRenderer.removeListener('satelliteWindow:closeRequested', listener)
      }
    },
    stageSession: (
      files: {
        filePath: string
        relativePath: string
        language: string
        dirtyDraftContent?: string
        lastKnownDiskSignature?: string
        cursorLine?: number
        scrollTop?: number
        selections?: {
          selectionStartLineNumber: number
          selectionStartColumn: number
          positionLineNumber: number
          positionColumn: number
        }[]
        markdownViewMode?: string
      }[]
    ): void => ipcRenderer.send('satelliteWindow:stageSession', files),
    /** Synchronous final stage from beforeunload — close/reload/quit must not
     *  lose keystrokes newer than the debounced stage. */
    stageSessionSync: (
      files: {
        filePath: string
        relativePath: string
        language: string
        dirtyDraftContent?: string
        lastKnownDiskSignature?: string
        cursorLine?: number
        scrollTop?: number
        selections?: {
          selectionStartLineNumber: number
          selectionStartColumn: number
          positionLineNumber: number
          positionColumn: number
        }[]
        markdownViewMode?: string
      }[]
    ): void => {
      ipcRenderer.sendSync('satelliteWindow:stageSessionSync', files)
    },
    notifyActiveWorktreeChanged: (worktreeId: string): void =>
      ipcRenderer.send('satelliteWindow:activeWorktreeChanged', worktreeId),
    onMirrorChanged: (
      callback: (
        entries: {
          satelliteId: string
          worktreeId: string
          visible: boolean
          files: { fileId: string; filePath: string; relativePath: string; language: string }[]
        }[]
      ) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        entries: Parameters<typeof callback>[0]
      ): void => callback(entries)
      ipcRenderer.on('satelliteWindow:mirrorChanged', listener)
      return () => ipcRenderer.removeListener('satelliteWindow:mirrorChanged', listener)
    },
    onOpenFile: (
      callback: (file: {
        filePath: string
        relativePath: string
        language: string
        dirtyDraftContent?: string
        lastKnownDiskSignature?: string
        cursorLine?: number
        scrollTop?: number
        selections?: {
          selectionStartLineNumber: number
          selectionStartColumn: number
          positionLineNumber: number
          positionColumn: number
        }[]
        markdownViewMode?: string
      }) => void
    ): (() => void) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        file: Parameters<typeof callback>[0]
      ): void => callback(file)
      ipcRenderer.on('satellite:openFile', listener)
      return () => ipcRenderer.removeListener('satellite:openFile', listener)
    }
  },
  pty: ptyApi,
  feedback: feedbackApi,
  crashReports: crashReportsApi,
  export: exportApi,
  gh: ghApi,
  hostedReview: hostedReviewApi,
  gl: glApiBridge,
  bitbucket: bitbucketApi,
  linear: linearApi,
  jira: jiraApi,
  starNag: starNagApi,
  telemetryTrack: telemetryTrackApi,
  telemetrySetOptIn: telemetrySetOptInApi,
  telemetryAcknowledgeBanner: telemetryAcknowledgeBannerApi,
  telemetryGetConsentState: telemetryGetConsentStateApi,
  diagnostics: diagnosticsApi,
  settings: settingsApi,
  agentAwake: agentAwakeApi,
  localhostWorktreeLabels: localhostWorktreeLabelsApi,
  keybindings: keybindingsApi,
  codexAccounts: codexAccountsApi,
  claudeAccounts: claudeAccountsApi,
  cli: cliApi,
  codexConfigSync: codexConfigSyncApi,
  agentTrust: agentTrustApi,
  preflight: preflightApi,
  notifications: notificationsApi,
  onboarding: onboardingApi,
  dashboard: dashboardApi,
  terminalPreview: terminalPreviewApi,
  macosTccPrompts: macosTccPromptsApi,
  developerPermissions: developerPermissionsApi,
  computerUsePermissions: computerUsePermissionsApi,
  shell: shellApi,
  skills: skillsApi,
  pet: petApi,
  browser: browserApi,
  emulator: emulatorApi,
  hooks: hooksApi,
  ephemeralVm: ephemeralVmApi,
  cache: cacheApi,
  session: sessionApi,
  remoteWorkspace: remoteWorkspaceApi,
  updater: updaterApi,
  docPreview: docPreviewApi,
  notebook: notebookApi,
  fs: fsApi,
  git: gitApi,
  ui: uiApi,
  stats: statsApi,
  memory: memoryApi,
  claudeUsage: claudeUsageApi,
  codexUsage: codexUsageApi,
  openCodeUsage: openCodeUsageApi,
  aiVault: aiVaultApi,
  nativeChat: nativeChatApi,
  runtime: runtimeApi,
  runtimeEnvironments: runtimeEnvironmentsApi,
  rateLimits: rateLimitsApi,
  minimaxCredentials: minimaxCredentialsApi,
  grokAccounts: grokAccountsApi,
  ssh: sshApi,
  sftp: {
    readdir: (args: { targetId: string; path: string }): Promise<SftpReaddirResult | SftpError> =>
      ipcRenderer.invoke('sftp:readdir', args),

    realpath: (args: { targetId: string; path: string }): Promise<string | SftpError> =>
      ipcRenderer.invoke('sftp:realpath', args),

    readFile: (args: {
      targetId: string
      path: string
    }): Promise<{ content: string; isBinary: boolean; truncated: boolean } | SftpError> =>
      ipcRenderer.invoke('sftp:readFile', args),

    mkdir: (args: { targetId: string; path: string }): Promise<{ ok: true } | SftpError> =>
      ipcRenderer.invoke('sftp:mkdir', args),

    move: (args: {
      targetId: string
      sourcePath: string
      destPath: string
      overwrite?: boolean
    }): Promise<{ ok: true } | { conflict: true } | SftpError> =>
      ipcRenderer.invoke('sftp:move', args),

    delete: (args: {
      targetId: string
      path: string
      isDirectory: boolean
    }): Promise<{ ok: true } | SftpError> => ipcRenderer.invoke('sftp:delete', args),

    startUpload: (args: {
      targetId: string
      remoteDir: string
      overwrite?: boolean
      directories?: boolean
    }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
      ipcRenderer.invoke('sftp:startUpload', args),

    planUpload: (args: {
      targetId: string
      remoteDir: string
    }): Promise<
      | { items: { name: string; localPath: string; conflict: boolean }[] }
      | { canceled: true }
      | SftpError
    > => ipcRenderer.invoke('sftp:planUpload', args),

    performUpload: (args: {
      targetId: string
      remoteDir: string
      uploads: { localPath: string; remoteName: string; overwrite: boolean }[]
    }): Promise<{ transferId: string } | SftpError> =>
      ipcRenderer.invoke('sftp:performUpload', args),

    uploadPaths: (args: {
      targetId: string
      remoteDir: string
      paths: string[]
    }): Promise<{ transferId: string } | SftpError> => ipcRenderer.invoke('sftp:uploadPaths', args),

    downloadToDir: (args: {
      targetId: string
      remotePaths: string[]
      localDir: string
    }): Promise<{ transferId: string } | SftpError> =>
      ipcRenderer.invoke('sftp:downloadToDir', args),

    startDownload: (args: {
      targetId: string
      remotePath: string
    }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
      ipcRenderer.invoke('sftp:startDownload', args),

    downloadArchive: (args: {
      targetId: string
      remotePaths: string[]
    }): Promise<{ transferId: string } | { canceled: true } | SftpError> =>
      ipcRenderer.invoke('sftp:downloadArchive', args),

    cancelTransfer: (args: { transferId: string }): Promise<{ ok: true } | SftpError> =>
      ipcRenderer.invoke('sftp:cancelTransfer', args),

    onTransferProgress: (callback: (data: SftpTransferProgress) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, data: SftpTransferProgress): void =>
        callback(data)
      ipcRenderer.on('sftp:transferProgress', listener)
      return () => ipcRenderer.removeListener('sftp:transferProgress', listener)
    },

    host: {
      list: (): Promise<SftpHostView[]> => ipcRenderer.invoke('sftp:host:list'),
      add: (input: SftpHostInput): Promise<SftpHost | SftpError> =>
        ipcRenderer.invoke('sftp:host:add', input),
      update: (args: { id: string; input: SftpHostInput }): Promise<SftpHost | SftpError> =>
        ipcRenderer.invoke('sftp:host:update', args),
      remove: (args: { id: string }): Promise<{ ok: true } | SftpError> =>
        ipcRenderer.invoke('sftp:host:remove', args),
      test: (args: { id: string }): Promise<{ ok: true } | SftpError> =>
        ipcRenderer.invoke('sftp:host:test', args)
    },

    probe: {
      list: (args: {
        connection: SftpProbeConnectionInput
        path: string
      }): Promise<SftpProbeListing | SftpError> => ipcRenderer.invoke('sftp:probe:list', args)
    }
  },
  automations: automationsApi,
  e2e: e2eApi,
  mobile: mobileApi,
  agentStatus: agentStatusApi,
  speech: speechApi
} satisfies PreloadApi

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  window.electron = electronAPI
  window.api = api
}
