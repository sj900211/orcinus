import type { BrowserWindow } from 'electron'
import type { SatelliteFileEntry } from '../../shared/satellite-window-payloads'

// Satellite editor windows (Expedition 5): keyed by satelliteId because neither
// projectKey (windows re-key in place) nor (parent, worktreeId) (spec allows
// several satellites per parent, even on one worktree) is a stable unique key.
// The parent is tracked by BrowserWindow INSTANCE — the same decision the
// project-window 'closed' cleanup makes — so parent project switches never
// orphan or re-home satellites (owner decision D4: no adoption).
//
// Deliberately separate from project-window-registry: satellites must never
// participate in worktree owner routing (PTY/notifications) or the
// "windows <= projects" invariant.

export type SatelliteRecord = {
  satelliteId: string
  window: BrowserWindow
  parentWindow: BrowserWindow
  worktreeId: string
  files: SatelliteFileEntry[]
  /** Subordination-hide (spec 5): parent switched to another worktree. Also
   *  set on a still-invisible (booting) satellite so ready-to-show knows not
   *  to reveal it over the wrong workspace. */
  hiddenByWorkspaceSwitch: boolean
  /** Parent hid itself (win32 tray-hide converts close into hide, so 'closed'
   *  never fires) — satellites follow the parent down and back up. */
  hiddenWithParent: boolean
  /** Whether the window was minimized when subordination first hid it — the
   *  reveal restores that exact state (owner verification, dungeon 3: a
   *  minimized satellite must also leave the taskbar on a workspace switch
   *  and come back minimized, never restored or lost). */
  minimizedBeforeHide: boolean
  /** Captured at creation — reading window.webContents.id in 'closed' throws. */
  trustedWebContentsId: number
}

const satellitesById = new Map<string, SatelliteRecord>()

const registryChangeListeners = new Set<() => void>()

// Why per parent: the parent's active worktree must be known at satellite
// CREATION time — a satellite opened (or finishing boot) after the parent
// already switched away must start hidden, and no correcting report arrives
// until the parent switches again (review finding, lifecycle HIGH).
const lastActiveWorktreeByParent = new Map<BrowserWindow, string>()

// Why bundled + refcounted: ONE listener set per parent window, installed with
// its first satellite and removed with its last, so a parent that outlives
// many sequential satellites never accumulates listeners.
type ParentHooks = { closed: () => void; hide: () => void; show: () => void; loaded: () => void }
const parentHooksByWindow = new Map<BrowserWindow, ParentHooks>()

function notifyRegistryChanged(): void {
  for (const listener of registryChangeListeners) {
    listener()
  }
}

export function onSatelliteRegistryChanged(listener: () => void): () => void {
  registryChangeListeners.add(listener)
  return () => {
    registryChangeListeners.delete(listener)
  }
}

export function getSatellite(satelliteId: string): SatelliteRecord | null {
  const record = satellitesById.get(satelliteId)
  return record && !record.window.isDestroyed() ? record : null
}

export function getSatelliteByWebContents(sender: Electron.WebContents): SatelliteRecord | null {
  for (const record of satellitesById.values()) {
    if (!record.window.isDestroyed() && record.window.webContents === sender) {
      return record
    }
  }
  return null
}

export function listSatellitesForParent(parent: BrowserWindow): SatelliteRecord[] {
  return [...satellitesById.values()].filter(
    (record) => record.parentWindow === parent && !record.window.isDestroyed()
  )
}

export function listSatellites(): SatelliteRecord[] {
  return [...satellitesById.values()].filter((record) => !record.window.isDestroyed())
}

/** Whether ready-to-show may reveal this satellite (not subordination-hidden). */
export function shouldRevealSatelliteOnReady(satelliteId: string): boolean {
  const record = getSatellite(satelliteId)
  return record ? !record.hiddenByWorkspaceSwitch && !record.hiddenWithParent : false
}

function isSubordinationHidden(record: SatelliteRecord): boolean {
  return record.hiddenByWorkspaceSwitch || record.hiddenWithParent
}

/** First hide by either subordination flag: capture the minimized state, then
 *  take the window off screen AND off the taskbar (win32 reports minimized
 *  windows as visible, so check both). */
function hideForSubordination(record: SatelliteRecord): void {
  record.minimizedBeforeHide = record.window.isMinimized()
  if (record.window.isVisible() || record.window.isMinimized()) {
    record.window.hide()
  }
}

/** Last flag cleared: restore exactly the state the user left — minimized
 *  windows return to the taskbar minimized (minimize() re-creates the taskbar
 *  entry without raising anything); others reappear without stealing focus. */
function revealFromSubordination(record: SatelliteRecord): void {
  if (record.minimizedBeforeHide) {
    record.window.minimize()
  } else {
    record.window.showInactive()
  }
  record.minimizedBeforeHide = false
}

function hideSatellitesWithParent(parent: BrowserWindow): void {
  let changed = false
  for (const record of listSatellitesForParent(parent)) {
    if (record.hiddenWithParent) {
      continue
    }
    if (!record.hiddenByWorkspaceSwitch) {
      hideForSubordination(record)
    }
    record.hiddenWithParent = true
    changed = true
  }
  if (changed) {
    notifyRegistryChanged()
  }
}

function showSatellitesWithParent(parent: BrowserWindow): void {
  let changed = false
  for (const record of listSatellitesForParent(parent)) {
    if (!record.hiddenWithParent) {
      continue
    }
    record.hiddenWithParent = false
    // Why the workspace check: the parent may come back from the tray on a
    // different worktree than the satellite's — subordination still applies.
    if (!record.hiddenByWorkspaceSwitch) {
      revealFromSubordination(record)
    }
    changed = true
  }
  if (changed) {
    notifyRegistryChanged()
  }
}

function attachParentHooks(parent: BrowserWindow): void {
  if (parentHooksByWindow.has(parent)) {
    return
  }
  const hooks: ParentHooks = {
    closed: () => closeSatellitesForParent(parent),
    hide: () => hideSatellitesWithParent(parent),
    show: () => showSatellitesWithParent(parent),
    // Why: a parent renderer reload (View→Reload, crash recovery) resubscribes
    // AFTER the last mirror broadcast; nudging the registry re-broadcasts the
    // mirror so the fresh renderer is not blind to its satellites.
    loaded: () => notifyRegistryChanged()
  }
  parentHooksByWindow.set(parent, hooks)
  parent.on('closed', hooks.closed)
  parent.on('hide', hooks.hide)
  parent.on('show', hooks.show)
  parent.webContents.on('did-finish-load', hooks.loaded)
}

function detachParentHooksIfUnused(parent: BrowserWindow): void {
  if (listSatellitesForParent(parent).length > 0) {
    return
  }
  const hooks = parentHooksByWindow.get(parent)
  if (hooks) {
    parentHooksByWindow.delete(parent)
    lastActiveWorktreeByParent.delete(parent)
    // Safe on a destroyed parent — pure EventEmitter calls; the webContents
    // listener needs a destroyed guard.
    parent.removeListener('closed', hooks.closed)
    parent.removeListener('hide', hooks.hide)
    parent.removeListener('show', hooks.show)
    if (!parent.isDestroyed() && !parent.webContents.isDestroyed()) {
      parent.webContents.removeListener('did-finish-load', hooks.loaded)
    }
  }
}

export function registerSatellite(record: SatelliteRecord): void {
  if (satellitesById.has(record.satelliteId)) {
    // UUID collision or caller bug — surface it, never silently replace.
    throw new Error(`duplicate satellite registration: ${record.satelliteId}`)
  }
  // Why reconciled at registration: the parent may already sit on another
  // worktree (stale click, IPC race) — the satellite must start subordinated.
  const parentWorktree = lastActiveWorktreeByParent.get(record.parentWindow)
  if (parentWorktree !== undefined && parentWorktree !== record.worktreeId) {
    record.hiddenByWorkspaceSwitch = true
  }
  satellitesById.set(record.satelliteId, record)
  attachParentHooks(record.parentWindow)
  notifyRegistryChanged()
}

export function unregisterSatellite(satelliteId: string, window: BrowserWindow): void {
  // Why identity-guarded: a late 'closed' must not evict a replacement record.
  const record = satellitesById.get(satelliteId)
  if (record && record.window === window) {
    satellitesById.delete(satelliteId)
    detachParentHooksIfUnused(record.parentWindow)
    notifyRegistryChanged()
  }
}

export function setSatelliteFiles(satelliteId: string, files: SatelliteFileEntry[]): void {
  const record = getSatellite(satelliteId)
  if (!record) {
    return
  }
  // Why the equality skip: renderers report on every openFiles identity change
  // (dirty transitions included); identical lists must not fan broadcasts out.
  const unchanged =
    record.files.length === files.length &&
    record.files.every(
      (entry, index) =>
        entry.fileId === files[index]?.fileId && entry.filePath === files[index]?.filePath
    )
  if (unchanged) {
    return
  }
  record.files = files
  notifyRegistryChanged()
}

/**
 * Spec 5 (workspace subordination): hide a parent's satellites — minimized
 * ones included, taskbar entry and all (owner verification) — when their
 * worktree no longer matches the parent's active worktree, and restore each
 * to its remembered state (minimized stays minimized, visible reappears
 * without stealing focus) when it matches again.
 */
export function applyParentActiveWorktree(parent: BrowserWindow, worktreeId: string): void {
  lastActiveWorktreeByParent.set(parent, worktreeId)
  let changed = false
  for (const record of listSatellitesForParent(parent)) {
    if (record.worktreeId !== worktreeId) {
      if (!record.hiddenByWorkspaceSwitch) {
        if (!record.hiddenWithParent) {
          hideForSubordination(record)
        }
        record.hiddenByWorkspaceSwitch = true
        changed = true
      }
    } else if (record.hiddenByWorkspaceSwitch) {
      record.hiddenByWorkspaceSwitch = false
      if (!record.hiddenWithParent) {
        revealFromSubordination(record)
      }
      changed = true
    }
  }
  if (changed) {
    notifyRegistryChanged()
  }
}

/** Cascade: satellites are subordinate — parent close closes them, hidden or not. */
export function closeSatellitesForParent(parent: BrowserWindow): void {
  for (const record of listSatellitesForParent(parent)) {
    record.window.close()
  }
}

/** Deliberate raise (interception/menu): clears subordination flags before reveal. */
export function markSatelliteRaised(satelliteId: string): void {
  const record = getSatellite(satelliteId)
  if (record && isSubordinationHidden(record)) {
    record.hiddenByWorkspaceSwitch = false
    record.hiddenWithParent = false
    // A raise means the user wants the window in front — forget the minimized state.
    record.minimizedBeforeHide = false
    notifyRegistryChanged()
  }
}

/** Test seam: reset module state between tests. */
export function resetSatelliteRegistryForTests(): void {
  satellitesById.clear()
  lastActiveWorktreeByParent.clear()
  for (const [parent, hooks] of parentHooksByWindow) {
    parent.removeListener('closed', hooks.closed)
    parent.removeListener('hide', hooks.hide)
    parent.removeListener('show', hooks.show)
    if (!parent.isDestroyed() && !parent.webContents.isDestroyed()) {
      parent.webContents.removeListener('did-finish-load', hooks.loaded)
    }
  }
  parentHooksByWindow.clear()
}
