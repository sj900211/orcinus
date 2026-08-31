import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import {
  ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT,
  ORCA_EDITOR_SAVE_AND_CLOSE_EVENT,
  requestEditorSaveQuiesce,
  type EditorRequestFileCloseDetail
} from '@/components/editor/editor-autosave'

// Why 350ms (Terminal precedent): long enough to swallow a double-click's
// second press, short enough that a deliberate next click still lands.
const CLOSE_DIALOG_DEBOUNCE_MS = 350
const SAVE_AND_CLOSE_TIMEOUT_MS = 10_000

function waitForFileClosed(fileId: string, timeoutMs: number): Promise<boolean> {
  if (!useAppStore.getState().openFiles.some((f) => f.id === fileId)) {
    return Promise.resolve(true)
  }
  return new Promise((resolve) => {
    let unsub: (() => void) | null = null
    const timeoutId = window.setTimeout(() => {
      unsub?.()
      resolve(false)
    }, timeoutMs)
    unsub = useAppStore.subscribe((state) => {
      if (!state.openFiles.some((f) => f.id === fileId)) {
        window.clearTimeout(timeoutId)
        unsub?.()
        resolve(true)
      }
    })
    // Why: zustand only fires subscribers on later changes; re-check in case
    // the file closed between the guard and subscribe.
    if (!useAppStore.getState().openFiles.some((f) => f.id === fileId)) {
      window.clearTimeout(timeoutId)
      unsub?.()
      resolve(true)
    }
  })
}

// Satellite dirty-close coordinator (dungeon 4): the tab close commands emit
// ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT for dirty files instead of closing them,
// and in the main window Terminal.tsx owns the listener, queue, and save
// dialog. A satellite mounts no Terminal, so this stand-in replays that whole
// contract: queue requests, one dialog at a time, await the save-and-close
// round-trip (with the timeout toast) before advancing, and veto the native
// window close while dirty tabs remain — draining them through the same
// dialog, then closing for real.
export function EditorChildCloseCoordinator(): React.JSX.Element {
  const [saveDialogFileId, setSaveDialogFileId] = useState<string | null>(null)
  const saveDialogFile = useAppStore((state) =>
    saveDialogFileId ? (state.openFiles.find((file) => file.id === saveDialogFileId) ?? null) : null
  )

  const saveDialogFileIdRef = useRef<string | null>(null)
  const pendingCloseQueueRef = useRef<string[]>([])
  const closeWindowAfterQueueRef = useRef(false)
  // Why (Terminal precedent): a double-click's second press must not act on the
  // NEXT queued file's dialog that replaced this one under the pointer.
  const isClosingRef = useRef(false)
  // Why (Terminal precedent): while a save-and-close is in flight its file
  // stays at the queue head; advanceQueue must not re-open a dialog for it.
  const inFlightSaveFileIdRef = useRef<string | null>(null)
  const guardTimersRef = useRef<Set<number>>(new Set())

  const releaseGuardAfterDebounce = useCallback(() => {
    const timer = window.setTimeout(() => {
      guardTimersRef.current.delete(timer)
      isClosingRef.current = false
    }, CLOSE_DIALOG_DEBOUNCE_MS)
    guardTimersRef.current.add(timer)
  }, [])
  useEffect(() => {
    const timers = guardTimersRef.current
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer)
      }
    }
  }, [])

  const openDialogFor = useCallback((fileId: string | null): void => {
    saveDialogFileIdRef.current = fileId
    setSaveDialogFileId(fileId)
  }, [])

  // The dialog's file stays at the queue head until resolved (Terminal
  // precedent) — removal happens in the save/discard handlers.
  const advanceQueue = useCallback((): void => {
    if (saveDialogFileIdRef.current !== null) {
      return
    }
    while (pendingCloseQueueRef.current.length > 0) {
      const fileId = pendingCloseQueueRef.current[0]
      if (fileId === inFlightSaveFileIdRef.current) {
        // handleSave's waitForFileClosed re-advances once the save lands or
        // times out — opening a dialog for it now would strand a phantom.
        return
      }
      const store = useAppStore.getState()
      const file = store.openFiles.find((candidate) => candidate.id === fileId)
      if (!file) {
        pendingCloseQueueRef.current.shift()
        continue
      }
      if (!file.isDirty) {
        // Queued as dirty but settled clean meanwhile (e.g. autosave) — close
        // inline and keep draining.
        store.closeFile(fileId)
        pendingCloseQueueRef.current.shift()
        continue
      }
      // Why activate: the editor behind the dialog should show the file the
      // dialog names.
      store.setActiveFile(fileId)
      openDialogFor(fileId)
      return
    }
    if (closeWindowAfterQueueRef.current) {
      closeWindowAfterQueueRef.current = false
      // Every dirty tab is resolved — let main finish the intercepted close
      // (destroy). Never window.close() from here: that path also fired after
      // a vetoed reload and destroyed the window the user asked to refresh.
      window.api.satelliteWindow.confirmClose()
    }
  }, [openDialogFor])

  const handleSave = useCallback(async (): Promise<void> => {
    if (isClosingRef.current) {
      return
    }
    const fileId = saveDialogFileIdRef.current
    if (!fileId) {
      return
    }
    isClosingRef.current = true
    if (!useAppStore.getState().openFiles.some((file) => file.id === fileId)) {
      pendingCloseQueueRef.current = pendingCloseQueueRef.current.filter((id) => id !== fileId)
      openDialogFor(null)
      advanceQueue()
      releaseGuardAfterDebounce()
      return
    }
    openDialogFor(null)
    // Why an event (not editor refs): the headless autosave controller flushes
    // and saves even when the editor panel has unmounted.
    window.dispatchEvent(new CustomEvent(ORCA_EDITOR_SAVE_AND_CLOSE_EVENT, { detail: { fileId } }))
    inFlightSaveFileIdRef.current = fileId
    let closed = false
    try {
      closed = await waitForFileClosed(fileId, SAVE_AND_CLOSE_TIMEOUT_MS)
    } finally {
      if (inFlightSaveFileIdRef.current === fileId) {
        inFlightSaveFileIdRef.current = null
      }
    }
    if (!closed && useAppStore.getState().openFiles.some((file) => file.id === fileId)) {
      // The controller swallows queueSave failures and leaves the file open —
      // without this the file silently stays dirty behind the next dialog.
      toast.error(
        translate(
          'editorChild.unsavedChanges.saveFailed',
          'Save timed out or failed. Fix errors before closing.'
        )
      )
      openDialogFor(fileId)
      // A new click on the reopened dialog is a deliberate retry.
      isClosingRef.current = false
      return
    }
    pendingCloseQueueRef.current = pendingCloseQueueRef.current.filter((id) => id !== fileId)
    advanceQueue()
    releaseGuardAfterDebounce()
  }, [advanceQueue, openDialogFor, releaseGuardAfterDebounce])

  const handleDiscard = useCallback(async (): Promise<void> => {
    if (isClosingRef.current) {
      return
    }
    const fileId = saveDialogFileIdRef.current
    if (!fileId) {
      return
    }
    isClosingRef.current = true
    openDialogFor(null)
    // Why: "Don't Save" must win over any pending autosave debounce for this tab.
    await requestEditorSaveQuiesce({ fileId })
    const store = useAppStore.getState()
    store.markFileDirty(fileId, false)
    store.closeFile(fileId)
    pendingCloseQueueRef.current = pendingCloseQueueRef.current.filter((id) => id !== fileId)
    advanceQueue()
    releaseGuardAfterDebounce()
  }, [advanceQueue, openDialogFor, releaseGuardAfterDebounce])

  const handleCancel = useCallback((): void => {
    if (isClosingRef.current) {
      return
    }
    // Why flush + drop the close flag: Cancel means "stop closing" — both the
    // rest of a bulk close and a pending window close.
    pendingCloseQueueRef.current = []
    closeWindowAfterQueueRef.current = false
    openDialogFor(null)
  }, [openDialogFor])

  useEffect(() => {
    const onRequestEditorClose = (event: Event): void => {
      const fileId = (event as CustomEvent<EditorRequestFileCloseDetail>).detail?.fileId
      if (!fileId || pendingCloseQueueRef.current.includes(fileId)) {
        return
      }
      pendingCloseQueueRef.current.push(fileId)
      advanceQueue()
    }
    // PURE veto (post-review fix): beforeunload also fires for View→Reload, so
    // it must never convert an unload into a window close. It only blocks the
    // unload and surfaces the dialogs; the genuine close flow arrives via
    // main's dirty-gated close intercept (onCloseRequested above).
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      const dirtyIds = useAppStore
        .getState()
        .openFiles.filter((file) => file.isDirty)
        .map((file) => file.id)
      if (dirtyIds.length === 0) {
        return
      }
      event.preventDefault()
      // Why also returnValue: Chromium only honors the cancellation when one of
      // the two signals is set; keep both for belt-and-suspenders.
      event.returnValue = true
      for (const fileId of dirtyIds) {
        if (!pendingCloseQueueRef.current.includes(fileId)) {
          pendingCloseQueueRef.current.push(fileId)
        }
      }
      advanceQueue()
    }
    // Main intercepted a native close (X, parent cascade, quit) because this
    // window reported dirty files: drain them through the dialog, then confirm.
    const offCloseRequested = window.api.satelliteWindow.onCloseRequested(() => {
      const dirtyIds = useAppStore
        .getState()
        .openFiles.filter((file) => file.isDirty)
        .map((file) => file.id)
      if (dirtyIds.length === 0) {
        // Cleaned up between the report and the intercept — nothing to drain.
        window.api.satelliteWindow.confirmClose()
        return
      }
      closeWindowAfterQueueRef.current = true
      for (const fileId of dirtyIds) {
        if (!pendingCloseQueueRef.current.includes(fileId)) {
          pendingCloseQueueRef.current.push(fileId)
        }
      }
      advanceQueue()
    })
    window.addEventListener(ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT, onRequestEditorClose)
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => {
      offCloseRequested()
      window.removeEventListener(ORCA_EDITOR_REQUEST_FILE_CLOSE_EVENT, onRequestEditorClose)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [advanceQueue])

  return (
    <Dialog
      open={saveDialogFileId !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          handleCancel()
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-sm">
            {translate('editorChild.unsavedChanges.title', 'Unsaved Changes')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {saveDialogFile
              ? translate(
                  'editorChild.unsavedChanges.named',
                  '"{{value0}}" has unsaved changes. Do you want to save before closing?',
                  { value0: saveDialogFile.relativePath.split('/').pop() }
                )
              : translate('editorChild.unsavedChanges.unnamed', 'This file has unsaved changes.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" size="sm" onClick={handleCancel}>
            {translate('editorChild.unsavedChanges.cancel', 'Cancel')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => void handleDiscard()}>
            {translate('editorChild.unsavedChanges.discard', "Don't Save")}
          </Button>
          <Button type="button" size="sm" onClick={() => void handleSave()}>
            {translate('editorChild.unsavedChanges.save', 'Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
