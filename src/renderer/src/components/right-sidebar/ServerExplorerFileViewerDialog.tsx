import React, { useEffect, useState } from 'react'
import Editor from '@monaco-editor/react'
import { AlertTriangle, FileWarning } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { detectLanguage } from '@/lib/language-detect'
import { resolveDocumentTheme } from '@/lib/document-theme'
import { computeEditorFontSize, resolveEditorFontFamily } from '@/lib/editor-font-zoom'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import '@/lib/monaco-setup'

export type ServerExplorerViewFile = { path: string; name: string }

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'binary' }
  | { status: 'ready'; content: string; truncated: boolean }

// Read-only remote file preview in a large modal (the right sidebar is too narrow for code). Content
// is fetched once via sftp:readFile (10 MB cap, binary-gated); the tree stays read-only.
export function ServerExplorerFileViewerDialog({
  targetId,
  file,
  onClose
}: {
  targetId: string | null
  file: ServerExplorerViewFile | null
  onClose: () => void
}): React.JSX.Element {
  const settings = useAppStore((state) => state.settings)
  const editorFontZoomLevel = useAppStore((state) => state.editorFontZoomLevel)
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    if (!file || !targetId) {
      return
    }
    let active = true
    setState({ status: 'loading' })
    void window.api.sftp.readFile({ targetId, path: file.path }).then((result) => {
      if (!active) {
        return
      }
      if ('error' in result) {
        setState({ status: 'error', message: result.error })
      } else if (result.isBinary) {
        setState({ status: 'binary' })
      } else {
        setState({ status: 'ready', content: result.content, truncated: result.truncated })
      }
    })
    return () => {
      active = false
    }
  }, [file, targetId])

  const isDark = resolveDocumentTheme(settings?.theme ?? 'system')
  const rawLanguage = file ? detectLanguage(file.name) : 'plaintext'
  const language = rawLanguage === 'notebook' ? 'json' : rawLanguage
  const fontSize = computeEditorFontSize(settings?.terminalFontSize ?? 13, editorFontZoomLevel)
  const fontFamily = resolveEditorFontFamily(settings)

  return (
    <Dialog
      open={file != null}
      onOpenChange={(open) => {
        if (!open) {
          onClose()
        }
      }}
    >
      <DialogContent className="flex h-[80vh] w-[80vw] max-w-[80vw] flex-col gap-2 sm:max-w-[80vw]">
        <DialogHeader>
          <DialogTitle className="truncate pr-6 text-sm">{file?.name ?? ''}</DialogTitle>
        </DialogHeader>
        {state.status === 'ready' && state.truncated ? (
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            <AlertTriangle className="size-3.5 shrink-0" />
            {translate(
              'auto.components.right-sidebar.ServerExplorerFileViewerDialog.truncated',
              'Large file — showing the first 10 MB.'
            )}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-border">
          {state.status === 'loading' ? (
            <div className="flex h-full items-center justify-center text-[11px] text-muted-foreground">
              {translate(
                'auto.components.right-sidebar.ServerExplorerFileViewerDialog.loading',
                'Loading…'
              )}
            </div>
          ) : state.status === 'error' ? (
            <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-destructive">
              {state.message}
            </div>
          ) : state.status === 'binary' ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
              <FileWarning className="size-6 opacity-50" />
              <span className="text-[11px]">
                {translate(
                  'auto.components.right-sidebar.ServerExplorerFileViewerDialog.binary',
                  "Can't preview a binary file"
                )}
              </span>
            </div>
          ) : (
            <Editor
              height="100%"
              language={language}
              value={state.content}
              theme={isDark ? 'vs-dark' : 'vs'}
              options={{
                readOnly: true,
                domReadOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize,
                fontFamily
              }}
              loading={<div className="h-full w-full" aria-hidden="true" />}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
