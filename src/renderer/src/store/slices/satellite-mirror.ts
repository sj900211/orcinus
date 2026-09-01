import type { StateCreator } from 'zustand'
import type { SatelliteMirrorEntry } from '../../../../shared/satellite-window-payloads'
import type { AppState } from '../types'

// Why a slice (projectWindows precedent): the openFile interception gate reads
// it synchronously via get(), and menu gating / future DnD targeting render
// from it. Main tailors the payload per recipient window; satellites never
// receive a mirror, so their gate is naturally inert on the empty default.
export type SatelliteMirrorSlice = {
  /** THIS window's satellites, pushed over 'satelliteWindow:mirrorChanged'. */
  satelliteMirror: readonly SatelliteMirrorEntry[]
  setSatelliteMirror: (entries: readonly SatelliteMirrorEntry[]) => void
}

export const createSatelliteMirrorSlice: StateCreator<AppState, [], [], SatelliteMirrorSlice> = (
  set
) => ({
  satelliteMirror: [],

  setSatelliteMirror: (entries) => {
    set({ satelliteMirror: entries })
  }
})
