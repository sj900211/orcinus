import { screen, type BrowserWindow } from 'electron'
import type { SatelliteCursorHit } from '../../shared/satellite-window-payloads'
import { listSatellitesForParent } from './satellite-window-registry'

// Dungeon 6 (tab drag-out, D9/D20/D21): the renderer cannot reliably map its
// client coordinates to screen space (mixed-DPI monitors scale differently),
// so main answers "which satellite is under the cursor?" itself —
// getCursorScreenPoint() and getBounds() share one DIP coordinate space.

type Point = { x: number; y: number }
type Rect = { x: number; y: number; width: number; height: number }

function rectContainsPoint(rect: Rect, point: Point): boolean {
  return (
    point.x >= rect.x &&
    point.x < rect.x + rect.width &&
    point.y >= rect.y &&
    point.y < rect.y + rect.height
  )
}

/** Which of the parent's satellites sits under the cursor right now.
 *  D21 rules: the parent always wins inside its own bounds (z-order at a
 *  point is unqueryable in Electron, and the parent holds focus during a tab
 *  drag — a satellite floating over it is not a drop target); subordination-
 *  hidden, minimized and never-shown satellites are excluded (win32 reports
 *  iconic bounds near -32000 for minimized windows, so their rectangles are
 *  phantoms); overlapping satellites resolve by registration order (stable
 *  Map iteration) — deterministic first-match. Accepted cost (review C1):
 *  a satellite occluded at the point by a FOREIGN window (another app, or
 *  another Orcinus project window) still wins — the parent-bounds rule only
 *  covers the sender's own window; point z-order is unqueryable. */
export function hitTestSatelliteAtCursor(parent: BrowserWindow): SatelliteCursorHit | null {
  let point: Point
  try {
    // The screen module can throw before app ready — no drag exists then.
    point = screen.getCursorScreenPoint()
  } catch {
    return null
  }
  if (
    !parent.isDestroyed() &&
    !parent.isMinimized() &&
    rectContainsPoint(parent.getBounds(), point)
  ) {
    return null
  }
  // listSatellitesForParent already drops destroyed windows.
  for (const record of listSatellitesForParent(parent)) {
    if (record.hiddenByWorkspaceSwitch || record.hiddenWithParent) {
      continue
    }
    if (record.window.isMinimized() || !record.window.isVisible()) {
      continue
    }
    if (rectContainsPoint(record.window.getBounds(), point)) {
      return { satelliteId: record.satelliteId, worktreeId: record.worktreeId }
    }
  }
  return null
}
