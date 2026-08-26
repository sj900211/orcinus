import React, { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { UploadConflictResolution } from './server-explorer-transfers'

// One remote name collision at a time: overwrite, rename (type a new name), or skip. Closing the
// dialog cancels the whole upload. Parent keys this on the conflicting name for fresh input state.
type ServerExplorerUploadConflictDialogProps = {
  name: string | null
  onResolve: (resolution: UploadConflictResolution) => void
}

export function ServerExplorerUploadConflictDialog({
  name,
  onResolve
}: ServerExplorerUploadConflictDialogProps): React.JSX.Element {
  const [renameValue, setRenameValue] = useState(name ?? '')
  const trimmed = renameValue.trim()
  const renameValid = trimmed.length > 0 && !trimmed.includes('/') && trimmed !== name
  return (
    <Dialog
      open={name != null}
      onOpenChange={(open) => {
        if (!open) {
          onResolve({ action: 'cancel' })
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>
            {translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.title',
              'File already exists'
            )}
          </DialogTitle>
          <DialogDescription className="break-all">
            {translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.body',
              '"{{value0}}" already exists in this folder. Replace it, upload under a new name, or skip it.',
              { value0: name ?? '' }
            )}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex gap-2 py-1"
          onSubmit={(event) => {
            event.preventDefault()
            if (renameValid) {
              onResolve({ action: 'rename', newName: trimmed })
            }
          }}
        >
          <Input
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            placeholder={translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.namePlaceholder',
              'New name'
            )}
          />
          <Button type="submit" size="sm" variant="outline" disabled={!renameValid}>
            {translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.rename',
              'Rename'
            )}
          </Button>
        </form>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onResolve({ action: 'skip' })}
          >
            {translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.skip',
              'Skip'
            )}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={() => onResolve({ action: 'overwrite' })}
          >
            {translate(
              'auto.components.right-sidebar.ServerExplorerUploadConflictDialog.overwrite',
              'Overwrite'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
