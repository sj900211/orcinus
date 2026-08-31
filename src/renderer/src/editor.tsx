import './assets/main.css'

import { lazy, StrictMode, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RecoverableRenderErrorBoundary } from './components/error-boundaries/RecoverableRenderErrorBoundary'
import EditorAutosaveController from './components/editor/EditorAutosaveController'
import { Toaster } from './components/ui/sonner'
import { TooltipProvider } from './components/ui/tooltip'
import { useEditorExternalWatch } from './hooks/useEditorExternalWatch'
import {
  installRendererCrashDiagnostics,
  recordRendererCrashBreadcrumb
} from './lib/crash-diagnostics'
import { applyDocumentTheme } from './lib/document-theme'
import { buildAppFontFamily } from './lib/app-font-family'
import { I18nProvider } from './i18n/I18nProvider'
import { translate } from './i18n/i18n'
import { useAppStore } from './store'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { getRepoExecutionHostId } from '../../shared/execution-host'
import { getOrCreateRendererRoot } from './lib/react-renderer-root'

const EditorPanel = lazy(() => import('./components/editor/EditorPanel'))

// Editor child window entry (Expedition 5 spike): a separate BrowserWindow with
// its own React root and its own store instance that hosts ONE editor tab.
// Like popout.tsx it runs the full renderer bootstrap (crash diagnostics,
// theme, i18n, error boundary) and shares the preload/window.api, but instead
// of the app shell it performs a mini-hydration: local repo catalog + the boot
// file's worktree rows — the floor the editor's owner-routing needs
// (useEditorPanelFileContentLoader / getEditorFileOperationContext).
recordRendererCrashBreadcrumb('editor_child_bootstrap_started', { dev: import.meta.env.DEV })
installRendererCrashDiagnostics('editor-child')

type EditorChildBootParams = {
  satelliteId: string
  filePath: string
  relativePath: string
  worktreeId: string
  language: string
}

function getEditorChildBootParams(): EditorChildBootParams | null {
  const params = new URLSearchParams(window.location.search)
  const satelliteId = params.get('orca-satellite-id')
  const filePath = params.get('orca-editor-file')
  const relativePath = params.get('orca-editor-relative')
  const worktreeId = params.get('orca-worktree')
  const language = params.get('orca-editor-language')
  if (!satelliteId || !filePath || !relativePath || !worktreeId || !language) {
    return null
  }
  return { satelliteId, filePath, relativePath, worktreeId, language }
}

function applyEditorChildAppearance(settings: GlobalSettings | null): void {
  applyDocumentTheme(settings?.theme ?? 'system', { disableTransitions: false })
  document.documentElement.style.setProperty(
    '--app-font-family',
    buildAppFontFamily(settings?.appFontFamily)
  )
}

// Why: this window owns a separate renderer store; seed appearance synchronously
// so a forced light/dark theme does not flash the OS theme before first paint.
let startupSettings: GlobalSettings | null = null
try {
  startupSettings = window.api.settings.getSync()
} catch {
  // Async hydration below remains available if the startup read fails.
}
if (startupSettings) {
  useAppStore.setState({ settings: startupSettings })
}
applyEditorChildAppearance(startupSettings)

const rootElement = document.getElementById('root')
if (!rootElement) {
  recordRendererCrashBreadcrumb('editor_child_root_missing')
  throw new Error('Editor child root element not found.')
}

function EditorChildSettingsSync(): null {
  const settings = useAppStore((state) => state.settings)

  useEffect(() => {
    let disposed = false
    // Why: Monaco's copy/paste chords honor user keybinding overrides, which
    // live in a separate file from settings.
    void useAppStore.getState().fetchKeybindings()
    const setSettings = (next: GlobalSettings): void => {
      if (!disposed) {
        useAppStore.setState({ settings: next })
      }
    }
    const offChanged = window.api.settings.onChanged((updates) => {
      const current = useAppStore.getState().settings
      if (current) {
        setSettings({ ...current, ...updates })
      }
    })
    void window.api.settings
      .get()
      .then(setSettings)
      .catch(() => undefined)
    return () => {
      disposed = true
      offChanged()
    }
  }, [])

  useEffect(() => {
    applyEditorChildAppearance(settings)
    if (settings?.theme !== 'system') {
      return
    }
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (): void => applyDocumentTheme('system')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [settings])

  return null
}

// Why a separate mount: the external-change watch is a hook, and it must stay
// mounted app-level in this window so the editor hears FS changes (main.tsx
// mounts it via useAppShellServices, which this slim shell does not run).
function EditorChildExternalWatch(): null {
  useEditorExternalWatch()
  return null
}

type BootPhase =
  | { phase: 'loading' }
  | { phase: 'ready'; fileId: string; worktreeId: string }
  | { phase: 'error'; message: string }

function useEditorChildBoot(): BootPhase {
  const [state, setState] = useState<BootPhase>({ phase: 'loading' })

  useEffect(() => {
    let disposed = false
    const boot = getEditorChildBootParams()
    if (!boot) {
      setState({
        phase: 'error',
        message: translate(
          'editorChild.missingBootParams',
          'This window was opened without a file to edit.'
        )
      })
      return
    }
    document.title = `${boot.relativePath} — Orcinus`
    void (async (): Promise<void> => {
      try {
        const actions = useAppStore.getState()
        // Mini-hydration floor (recon dungeon 1): the owning repo row unlocks
        // the content loader's owner gate; the worktree row (hostId) unlocks
        // the save queue's operation route.
        await actions.fetchReposForAllHosts({ remoteHosts: 'skip' })
        await actions.awaitLocalRepoCatalogSettlement()
        // Why: worktree refresh can spawn host Git; wait for main's shell-PATH fence first.
        await window.api.app.awaitFirstWindowStartupServices()
        const repoId = getRepoIdFromWorktreeId(boot.worktreeId)
        const repo = useAppStore.getState().repos.find((candidate) => candidate.id === repoId)
        if (!repo) {
          throw new Error(
            translate(
              'editorChild.workspaceNotFound',
              'The workspace that owns this file is not in the local catalog.'
            )
          )
        }
        await actions.fetchWorktrees(repo.id, { executionHostId: getRepoExecutionHostId(repo) })
        if (disposed) {
          return
        }
        // Why: an empty runtimeEnvironments list with the hydrated flag still
        // false makes the save route resolve to 'missing' and fail closed.
        // Spike scope is local files, so mark the (empty) catalog hydrated;
        // real runtime-env hydration is dungeon-2 design work.
        useAppStore.setState({
          runtimeEnvironmentCatalogHydrated: true,
          runtimeEnvironmentCatalogSettled: true
        })
        const fileId = useAppStore.getState().openFile(
          {
            filePath: boot.filePath,
            relativePath: boot.relativePath,
            worktreeId: boot.worktreeId,
            language: boot.language,
            mode: 'edit'
          },
          { focusEditor: true }
        )
        if (!disposed) {
          setState({ phase: 'ready', fileId, worktreeId: boot.worktreeId })
        }
      } catch (error) {
        recordRendererCrashBreadcrumb('editor_child_boot_failed')
        if (!disposed) {
          setState({
            phase: 'error',
            message:
              error instanceof Error
                ? error.message
                : translate('editorChild.bootFailed', 'The editor window could not start.')
          })
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [])

  return state
}

// Registry sync (dungeon 3): report this satellite's open files to main after
// every change (feeds the parent's interception mirror), signal boot-ready so
// queued moveFile pushes flush, and apply pushed files into this store.
function SatelliteWindowSync({ worktreeId }: { worktreeId: string }): null {
  useEffect(() => {
    void window.api.satelliteWindow.notifyReady()
    const reportFiles = (): void => {
      // Why edit-mode only: transient surfaces (markdown preview, diffs) must
      // not enter the mirror — dungeon-5 interception treats mirror entries as
      // "this file LIVES here", which only edit tabs satisfy.
      window.api.satelliteWindow.reportOpenFiles(
        useAppStore
          .getState()
          .openFiles.filter((file) => file.mode === 'edit')
          .map((file) => ({ fileId: file.id, filePath: file.filePath }))
      )
    }
    reportFiles()
    const unsubscribe = useAppStore.subscribe((state, prevState) => {
      if (state.openFiles !== prevState.openFiles) {
        reportFiles()
      }
    })
    const offOpenFile = window.api.satelliteWindow.onOpenFile((file) => {
      useAppStore.getState().openFile({ ...file, worktreeId, mode: 'edit' }, { focusEditor: true })
    })
    return () => {
      unsubscribe()
      offOpenFile()
    }
  }, [worktreeId])
  return null
}

function EditorChildStatus({ message }: { message: string }): React.JSX.Element {
  return (
    <div className="flex h-screen items-center justify-center px-8 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function EditorChildRoot(): React.JSX.Element {
  const boot = useEditorChildBoot()

  if (boot.phase === 'error') {
    return <EditorChildStatus message={boot.message} />
  }
  if (boot.phase === 'loading') {
    return <EditorChildStatus message={translate('editorChild.loading', 'Opening the editor…')} />
  }
  return (
    // Why this exact wrapper: EditorPanel sizes itself against the split-pane
    // host contract (TabGroupPanel) — an absolutely-positioned flex pane inside
    // a sized ancestor. A plain block wrapper collapses it to ~2px.
    <div className="relative h-screen w-screen overflow-hidden">
      <SatelliteWindowSync worktreeId={boot.worktreeId} />
      <div className="absolute inset-0 flex min-h-0 min-w-0">
        <Suspense
          fallback={
            <EditorChildStatus message={translate('editorChild.loading', 'Opening the editor…')} />
          }
        >
          {/* Why no activeFileId pin: the prop would override the store forever,
            making every later file (moveFile push) invisible — boot's openFile
            already set the store's activeFileId, and the panel must follow it. */}
          <EditorPanel isVisible isCmdSaveOwner />
        </Suspense>
      </div>
    </div>
  )
}

function EditorChildApp(): React.JSX.Element {
  useTranslation()
  return (
    <RecoverableRenderErrorBoundary
      boundaryId="editor-child.root"
      surface="editor-child"
      title={translate('editorChild.recoverableError.title', 'The editor window hit an error.')}
      description={translate(
        'editorChild.recoverableError.description',
        'The editor could not finish rendering. Retry to remount it, or reopen it from the tab menu.'
      )}
    >
      <EditorChildRoot />
      <Toaster closeButton toastOptions={{ className: 'font-sans text-sm' }} />
    </RecoverableRenderErrorBoundary>
  )
}

getOrCreateRendererRoot(rootElement, import.meta.hot?.data).render(
  <StrictMode>
    <I18nProvider>
      <EditorChildSettingsSync />
      <EditorAutosaveController />
      <EditorChildExternalWatch />
      {/* Why window-wide (mirrors App.tsx): Radix Tooltip.Root throws without a
          provider, and the editor tree has bare consumers — the markdown
          header's ArtifactPublishButton crashed the whole child without this. */}
      <TooltipProvider delayDuration={400}>
        <EditorChildApp />
      </TooltipProvider>
    </I18nProvider>
  </StrictMode>
)
recordRendererCrashBreadcrumb('editor_child_bootstrap_rendered')
