import type { BrowserWindow } from 'electron'
import { getWorkspaceWindow, listWorkspaceWindowWorktreeIds } from './workspace-window-registry'

// Why: a PTY stream and its worktree's notifications go to exactly ONE window —
// the worktree's workspace window when open, else the main window. This module
// resolves that owner with plain Map lookups so pty.ts's hot path stays cheap.

type PtyWorktreeResolver = (ptyId: string) => string | undefined

let mainWindowForRouting: BrowserWindow | null = null
let ptyWorktreeResolver: PtyWorktreeResolver | null = null

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

export function resolveWorktreeOwnerWindow(worktreeId: string | undefined): BrowserWindow | null {
  const workspaceWindow = worktreeId ? getWorkspaceWindow(worktreeId) : null
  return workspaceWindow ?? getRoutedMainWindow()
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

/** Main + workspace windows, deduped and destroyed-guarded. */
export function listAppWindows(): BrowserWindow[] {
  const windows: BrowserWindow[] = []
  const main = getRoutedMainWindow()
  if (main) {
    windows.push(main)
  }
  for (const worktreeId of listWorkspaceWindowWorktreeIds()) {
    const window = getWorkspaceWindow(worktreeId)
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
}
