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

// Parent keys this on the target dir so each open remounts with a fresh, empty name
// (no effect resetting state on prop change).
type ServerExplorerNewFolderDialogProps = {
  open: boolean
  parentDir: string
  onSubmit: (name: string) => void
  onOpenChange: (open: boolean) => void
}

export function ServerExplorerNewFolderDialog({
  open,
  parentDir,
  onSubmit,
  onOpenChange
}: ServerExplorerNewFolderDialogProps): React.JSX.Element {
  const [name, setName] = useState('')
  const trimmed = name.trim()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (trimmed) {
              onSubmit(trimmed)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {translate(
                'auto.components.right-sidebar.ServerExplorerNewFolderDialog.title',
                'New Folder'
              )}
            </DialogTitle>
            <DialogDescription className="truncate">{parentDir}</DialogDescription>
          </DialogHeader>
          <div className="py-3">
            <Input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={translate(
                'auto.components.right-sidebar.ServerExplorerNewFolderDialog.namePlaceholder',
                'Folder name'
              )}
            />
          </div>
          <DialogFooter className="gap-2 sm:justify-end">
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {translate(
                'auto.components.right-sidebar.ServerExplorerNewFolderDialog.cancel',
                'Cancel'
              )}
            </Button>
            <Button type="submit" size="sm" disabled={!trimmed}>
              {translate(
                'auto.components.right-sidebar.ServerExplorerNewFolderDialog.create',
                'Create'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
