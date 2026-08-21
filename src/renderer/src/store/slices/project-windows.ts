import type { StateCreator } from 'zustand'
import type { AppState } from '../types'

// Why a slice: menu gating, sidebar markers, and the activation raise guard all read the same
// per-window registry snapshot pushed over 'projectWindow:openProjectsChanged'.
export type ProjectWindowsSlice = {
  /** Project keys (repoIds / `folder:` keys) open in OTHER app windows. Main tailors the payload per recipient. */
  projectKeysInOtherWindows: ReadonlySet<string>
  setProjectKeysInOtherWindows: (projectKeys: readonly string[]) => void
}

export const createProjectWindowsSlice: StateCreator<AppState, [], [], ProjectWindowsSlice> = (
  set
) => ({
  projectKeysInOtherWindows: new Set<string>(),

  setProjectKeysInOtherWindows: (projectKeys) => {
    set({ projectKeysInOtherWindows: new Set(projectKeys) })
  }
})
