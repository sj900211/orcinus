import type { BrowserWindow } from 'electron'

// Why: a worktree may be open in at most one workspace window — reopen focuses, never duplicates.
const workspaceWindowsByWorktreeId = new Map<string, BrowserWindow>()

/** The live workspace window for a worktree, or null when closed/destroyed. */
export function getWorkspaceWindow(worktreeId: string): BrowserWindow | null {
  const window = workspaceWindowsByWorktreeId.get(worktreeId)
  return window && !window.isDestroyed() ? window : null
}

export function registerWorkspaceWindow(worktreeId: string, window: BrowserWindow): void {
  workspaceWindowsByWorktreeId.set(worktreeId, window)
}

export function unregisterWorkspaceWindow(worktreeId: string, window: BrowserWindow): void {
  // Why: a late 'closed' must not evict a replacement window registered for the same worktree.
  if (workspaceWindowsByWorktreeId.get(worktreeId) === window) {
    workspaceWindowsByWorktreeId.delete(worktreeId)
  }
}

export function listWorkspaceWindowWorktreeIds(): string[] {
  return [...workspaceWindowsByWorktreeId.entries()]
    .filter(([, window]) => !window.isDestroyed())
    .map(([worktreeId]) => worktreeId)
}
