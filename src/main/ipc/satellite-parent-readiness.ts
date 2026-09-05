// Parent-renderer mirror readiness (dungeon 5): a parent that has fetched the
// mirror since its last main-frame navigation is the only one a
// satellite:filesMovedBack push can land in — a reloading/booting renderer has
// live webContents but no subscription, and send() into it silently drops.
// Consumed by satelliteWindow:moveFileBack; marked by satelliteWindow:getMirror;
// cleared via the registry's parent navigation/crash hooks.
const readyParentMirrorWebContentsIds = new Set<number>()

export function markParentMirrorReady(webContentsId: number): void {
  readyParentMirrorWebContentsIds.add(webContentsId)
}

export function clearParentMirrorReady(webContentsId: number): void {
  readyParentMirrorWebContentsIds.delete(webContentsId)
}

export function isParentMirrorReady(webContentsId: number): boolean {
  return readyParentMirrorWebContentsIds.has(webContentsId)
}

/** Handler re-registration (tests) must not inherit stale readiness. */
export function clearAllParentMirrorReadiness(): void {
  readyParentMirrorWebContentsIds.clear()
}
