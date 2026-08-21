import type { BrowserWindow } from 'electron'
import { parseWorkspaceKey } from '../../shared/workspace-scope'
import { getRepoIdFromWorktreeId } from '../../shared/worktree/id'
import { getProjectWindow, listProjectWindowProjectKeys } from './project-window-registry'

// Why: a PTY stream and its worktree's notifications go to exactly ONE window —
// the owning PROJECT window when open, else the main window. This module
// resolves that owner with plain Map lookups so pty.ts's hot path stays cheap.

type PtyWorktreeResolver = (ptyId: string) => string | undefined
type ProjectKeyResolver = (worktreeId: string) => string | undefined

let mainWindowForRouting: BrowserWindow | null = null
let ptyWorktreeResolver: PtyWorktreeResolver | null = null
let projectKeyResolver: ProjectKeyResolver | null = null

function liveWindow(window: BrowserWindow | null): BrowserWindow | null {
  return window && !window.isDestroyed() ? window : null
}

export function setMainWindowForRouting(window: BrowserWindow): void {
  mainWindowForRouting = window
}

/** Identity-guarded so a late 'closed' can't evict a replacement main window. */
export function clearMainWindowForRouting(window: BrowserWindow): void {
  if (mainWindowForRouting === window) {
    mainWindowForRouting = null
  }
}

export function getRoutedMainWindow(): BrowserWindow | null {
  return liveWindow(mainWindowForRouting)
}

/** Injected once at PTY handler registration; kept as a resolver so the router stays runtime-agnostic. */
export function setPtyWorktreeResolverForRouting(resolver: PtyWorktreeResolver | null): void {
  ptyWorktreeResolver = resolver
}

/** Injected alongside the PTY resolver (runtime getWorktreeRepoId); maps a git worktree id to its repoId. */
export function setProjectKeyResolverForRouting(resolver: ProjectKeyResolver | null): void {
  projectKeyResolver = resolver
}

/** Project key owning a workspace key: folder keys map to themselves, worktree ids to their repo. */
export function resolveProjectKeyForWorkspaceKey(workspaceKey: string): string {
  if (parseWorkspaceKey(workspaceKey)?.type === 'folder') {
    return workspaceKey
  }
  // Why a parse fallback: worktree ids are `repoId::path`, so routing stays correct before injection.
  return projectKeyResolver?.(workspaceKey) ?? getRepoIdFromWorktreeId(workspaceKey)
}

export function resolveWorktreeOwnerWindow(worktreeId: string | undefined): BrowserWindow | null {
  const projectWindow = worktreeId
    ? getProjectWindow(resolveProjectKeyForWorkspaceKey(worktreeId))
    : null
  return projectWindow ?? getRoutedMainWindow()
}

export function resolvePtyOwnerWindow(ptyId: string): BrowserWindow | null {
  return resolveWorktreeOwnerWindow(ptyWorktreeResolver?.(ptyId))
}

function sendToWindow(window: BrowserWindow | null, channel: string, args: unknown[]): boolean {
  if (
    !window ||
    window.isDestroyed() ||
    (typeof window.webContents.isDestroyed === 'function' && window.webContents.isDestroyed())
  ) {
    return false
  }
  try {
    window.webContents.send(channel, ...args)
    return true
  } catch {
    // Why: a frame disposed mid-send must not fail the PTY/runtime operation that produced the event.
    return false
  }
}

export function sendToPtyOwner(ptyId: string, channel: string, payload: unknown): boolean {
  return sendToWindow(resolvePtyOwnerWindow(ptyId), channel, [payload])
}

export function sendToWorktreeOwner(
  worktreeId: string | undefined,
  channel: string,
  ...args: unknown[]
): boolean {
  return sendToWindow(resolveWorktreeOwnerWindow(worktreeId), channel, args)
}

/** Main + project windows, deduped and destroyed-guarded. */
export function listAppWindows(): BrowserWindow[] {
  const windows: BrowserWindow[] = []
  const main = getRoutedMainWindow()
  if (main) {
    windows.push(main)
  }
  for (const projectKey of listProjectWindowProjectKeys()) {
    const window = getProjectWindow(projectKey)
    if (window && !windows.includes(window)) {
      windows.push(window)
    }
  }
  return windows
}

export function broadcastToAppWindows(channel: string, ...args: unknown[]): boolean {
  let sent = false
  for (const window of listAppWindows()) {
    sent = sendToWindow(window, channel, args) || sent
  }
  return sent
}

/** Test seam: reset module state between tests. */
export function _resetWindowAffinityRouterForTest(): void {
  mainWindowForRouting = null
  ptyWorktreeResolver = null
  projectKeyResolver = null
}
