import { captureEditorFileOperationProvenance } from '@/lib/editor-file-operation-owner'
import { areLocalWindowsWslPathAliases } from '../../../shared/cross-platform-path'
import { getRendererWindowSurface } from '@/lib/renderer-window-surface'
import type { OpenFile } from '@/store/slices/editor'
import type { AppState } from '@/store/types'

// Open-interception gate (dungeon 5, spec 2 / decisions D8+D17): consulted as
// the FIRST statement of the openFile store action — the single convergence
// point of every open path. Returns the intercepted file id (the satellite's
// path spelling) to the caller, or null to open normally.
//
// Why these preconditions: mode 'edit' alone over-matches — SFTP previews and
// read-only logs are mode 'edit' too, and an open that would resolve to a
// runtime/SSH owner is a DIFFERENT file identity than the strictly-local files
// a satellite can host (the move menu enforces the same eligibility).
export function interceptSatelliteResidentOpen(
  state: AppState,
  file: Omit<OpenFile, 'id' | 'isDirty'>,
  options:
    | { suppressActiveRuntimeFallback?: boolean; suppressSatelliteInterception?: boolean }
    | undefined,
  helpers: {
    /** Re-dispatch the original open with interception suppressed (stale-mirror fallback). */
    retryLocalOpen: () => void
    /** Drop a mirror entry main refused (the two-hop-stale window). */
    pruneMirrorFile: (satelliteId: string, filePath: string) => void
  }
): string | null {
  if (options?.suppressSatelliteInterception) {
    return null
  }
  const mirror = state.satelliteMirror
  if (!mirror || mirror.length === 0) {
    return null
  }
  // Belt-and-braces: satellites never receive a mirror, but a future
  // "mirror all windows" change must not create a self-raising loop.
  if (getRendererWindowSurface() === 'satellite') {
    return null
  }
  if (
    file.mode !== 'edit' ||
    file.readOnly === true ||
    file.sftpTargetId !== undefined ||
    file.externalSshTargetId !== undefined ||
    file.mirroredFromRuntimeSession === true
  ) {
    return null
  }
  // Mirror applyOpenFileToState's REAL owner resolution (post-review C9): the
  // provenance route returns a null runtime for catalog worktrees on a local
  // host regardless of activeRuntimeEnvironmentId — the legacy settings
  // fallback alone would disable interception whenever a runtime env is
  // selected and re-create local duplicates.
  let resolvedRuntimeEnvironmentId: string | null | undefined
  try {
    const provenance = captureEditorFileOperationProvenance(
      state,
      file.worktreeId,
      options?.suppressActiveRuntimeFallback ? null : file.runtimeEnvironmentId,
      options?.suppressActiveRuntimeFallback === true || file.runtimeEnvironmentId !== undefined
    )
    resolvedRuntimeEnvironmentId = provenance
      ? provenance.generation.route.runtimeEnvironmentId
      : undefined
  } catch {
    resolvedRuntimeEnvironmentId = undefined
  }
  if (resolvedRuntimeEnvironmentId === undefined) {
    resolvedRuntimeEnvironmentId =
      file.runtimeEnvironmentId === null
        ? null
        : (file.runtimeEnvironmentId ??
          (options?.suppressActiveRuntimeFallback
            ? null
            : (state.settings?.activeRuntimeEnvironmentId?.trim() ?? null)))
  }
  if (resolvedRuntimeEnvironmentId) {
    return null
  }
  for (const entry of mirror) {
    if (entry.worktreeId !== file.worktreeId) {
      continue
    }
    const match = entry.files.find(
      (candidate) =>
        candidate.filePath === file.filePath ||
        areLocalWindowsWslPathAliases(candidate.filePath, file.filePath)
    )
    if (!match) {
      continue
    }
    // Raise + activate. Push the SATELLITE's own spelling so an alias hit
    // cannot grow a duplicate tab there; main re-checks membership against
    // the live registry (the renderer mirror is two async hops stale).
    // D17: hidden-by-subordination satellites are raised too (raise overrides
    // subordination by design — the user asked for the file).
    const activation = window.api.satelliteWindow.activateFile?.(entry.satelliteId, {
      filePath: match.filePath,
      relativePath: match.relativePath,
      language: match.language
    })
    // Post-review C8: main re-checks membership against the live registry and
    // refuses stale activations — the click must then degrade to a normal
    // local open instead of being swallowed.
    void activation
      ?.then((result) => {
        if (!result?.ok) {
          helpers.pruneMirrorFile(entry.satelliteId, match.filePath)
          helpers.retryLocalOpen()
        }
      })
      .catch(() => {
        helpers.retryLocalOpen()
      })
    return match.filePath
  }
  return null
}
