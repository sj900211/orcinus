import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { getShortcutPlatform } from '@/hooks/useShortcutLabel'
import {
  handleSwitchRecentTab,
  handleSwitchTab,
  handleSwitchTabAcrossAllTypes
} from '@/hooks/ipc-tab-switch'
import { keybindingMatchesAction, type KeybindingActionId } from '../../../../shared/keybindings'
import { matchesRecentTabSwitcherChord } from '../../../../shared/window-shortcut-policy'

// Satellite keyboard floor (dungeon 4, owner decision D12): in the main window
// Terminal.tsx owns these chords; a satellite mounts no Terminal, so this hook
// replays the editor-relevant subset against this window's own store. The
// cycle helpers (ipc-tab-switch) read activeWorktreeId + the active group's
// visible order — both seeded by the satellite boot.
export function useEditorChildTabShortcuts({
  onCloseActiveTab,
  onCloseAllTabs
}: {
  onCloseActiveTab: () => void
  onCloseAllTabs: () => void
}): void {
  // Why refs: the close commands re-bind on tab churn; the window listener
  // must not tear down and re-attach on every tab switch.
  const onCloseActiveTabRef = useRef(onCloseActiveTab)
  onCloseActiveTabRef.current = onCloseActiveTab
  const onCloseAllTabsRef = useRef(onCloseAllTabs)
  onCloseAllTabsRef.current = onCloseAllTabs

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // A child handler that already claimed the chord wins (e.g. the save
      // dialog's own keys).
      if (e.defaultPrevented) {
        return
      }
      const keybindings = useAppStore.getState().keybindings
      const platform = getShortcutPlatform()
      // Why context 'app': there are no terminal panes here, so the
      // terminal-vs-app chord policy never applies (floating-workspace
      // precedent for terminal-free matching).
      const match = (actionId: KeybindingActionId): boolean =>
        keybindingMatchesAction(actionId, e, platform, keybindings, { context: 'app' })

      // Cmd/Ctrl+W — close the active editor tab (dirty files route through
      // the close coordinator's dialog). preventDefault also stops Electron's
      // default window-close.
      if (!e.repeat && match('tab.close')) {
        e.preventDefault()
        onCloseActiveTabRef.current()
        return
      }
      if (!e.repeat && match('tab.closeAll')) {
        e.preventDefault()
        onCloseAllTabsRef.current()
        return
      }
      // Ctrl+Tab is owned by RecentTabSwitcher's own capture listener; bail so
      // both surfaces don't act on one chord.
      if (matchesRecentTabSwitcherChord(e, platform, keybindings)) {
        return
      }
      if (!e.repeat && match('tab.previousRecent')) {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        handleSwitchRecentTab()
        return
      }
      const sameTypeDirection = match('tab.nextSameType')
        ? 1
        : match('tab.previousSameType')
          ? -1
          : null
      const allTypesDirection = match('tab.nextAllTypes')
        ? 1
        : match('tab.previousAllTypes')
          ? -1
          : null
      if (!e.repeat && (sameTypeDirection !== null || allTypesDirection !== null)) {
        // Why always consume (even single-tab no-op): the chord must never
        // fall through to Monaco or the browser default.
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        if (allTypesDirection !== null) {
          handleSwitchTabAcrossAllTypes(allTypesDirection)
        } else {
          handleSwitchTab(sameTypeDirection ?? 1)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])
}
