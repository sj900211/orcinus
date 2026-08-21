import type { BrowserWindow } from 'electron'

// Why: a project (git repo / folder workspace) may be open in at most one project
// window — reopen focuses, never duplicates. Worktree switches inside the project
// stay registry-invisible.
const projectWindowsByProjectKey = new Map<string, BrowserWindow>()

// Why: sidebar integration needs to mirror registry contents into every renderer; listeners fire on any membership change.
const registryChangeListeners = new Set<() => void>()

function notifyRegistryChanged(): void {
  // Set iteration tolerates unsubscribe-during-notify (deletes are safe mid-iteration).
  for (const listener of registryChangeListeners) {
    listener()
  }
}

export function onProjectWindowRegistryChanged(listener: () => void): () => void {
  registryChangeListeners.add(listener)
  return () => {
    registryChangeListeners.delete(listener)
  }
}

/** The live project window for a project key, or null when closed/destroyed. */
export function getProjectWindow(projectKey: string): BrowserWindow | null {
  const window = projectWindowsByProjectKey.get(projectKey)
  return window && !window.isDestroyed() ? window : null
}

export function registerProjectWindow(projectKey: string, window: BrowserWindow): void {
  // Why: the single choke point that makes ">1 window per project" impossible. A live
  // duplicate here means a caller raced past createOrFocusProjectWindow's focus-if-exists
  // check; keep the invariant (windows <= projects) and surface the caller bug.
  const existing = projectWindowsByProjectKey.get(projectKey)
  if (existing && existing !== window && !existing.isDestroyed()) {
    throw new Error(`duplicate project window registration for key: ${projectKey}`)
  }
  projectWindowsByProjectKey.set(projectKey, window)
  notifyRegistryChanged()
}

export function unregisterProjectWindow(projectKey: string, window: BrowserWindow): void {
  // Why: a late 'closed' must not evict a replacement window registered for the same project.
  if (projectWindowsByProjectKey.get(projectKey) === window) {
    projectWindowsByProjectKey.delete(projectKey)
    notifyRegistryChanged()
  }
}

/** Drop every entry owned by `window` — the 'closed' cleanup after in-window project switches re-keyed it. */
export function unregisterProjectWindowInstance(window: BrowserWindow): void {
  let removed = false
  for (const [projectKey, registered] of projectWindowsByProjectKey) {
    if (registered === window) {
      projectWindowsByProjectKey.delete(projectKey)
      removed = true
    }
  }
  if (removed) {
    notifyRegistryChanged()
  }
}

export type ProjectWindowRekeyResult = 'rekeyed' | 'noop' | 'conflict' | 'not-registered'

/**
 * Move a registered project window under a new project key (the window switched
 * projects in place). Refuses to steal a project owned by another live window —
 * the renderer-side raise guard should have prevented that switch.
 */
export function rekeyProjectWindow(
  window: BrowserWindow,
  projectKey: string
): ProjectWindowRekeyResult {
  const ownedProjectKeys = [...projectWindowsByProjectKey.entries()]
    .filter(([, registered]) => registered === window)
    .map(([registeredProjectKey]) => registeredProjectKey)
  if (ownedProjectKeys.length === 0) {
    return 'not-registered'
  }
  if (ownedProjectKeys.length === 1 && ownedProjectKeys[0] === projectKey) {
    return 'noop'
  }
  const currentOwner = projectWindowsByProjectKey.get(projectKey)
  if (currentOwner && currentOwner !== window && !currentOwner.isDestroyed()) {
    return 'conflict'
  }
  for (const ownedProjectKey of ownedProjectKeys) {
    projectWindowsByProjectKey.delete(ownedProjectKey)
  }
  projectWindowsByProjectKey.set(projectKey, window)
  notifyRegistryChanged()
  return 'rekeyed'
}

export function listProjectWindowProjectKeys(): string[] {
  return [...projectWindowsByProjectKey.entries()]
    .filter(([, window]) => !window.isDestroyed())
    .map(([projectKey]) => projectKey)
}
