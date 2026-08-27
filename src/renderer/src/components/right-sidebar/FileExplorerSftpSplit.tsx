import React, { Suspense, useCallback, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Server } from 'lucide-react'
import { lazyWithRetry } from '@/lib/lazy-with-retry'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import FileExplorer from './FileExplorer'

// SFTP loads only when the split is opened, so the local explorer's initial cost is unchanged.
const ServerExplorer = lazyWithRetry(() => import('./ServerExplorer'), {
  reloadKey: 'explorer-sftp-split'
})

const OPEN_KEY = 'orcinus.explorer.sftpSplitOpen'
const HEIGHT_KEY = 'orcinus.explorer.sftpSplitHeight'
const MIN_PANE = 120
const DEFAULT_HEIGHT = 260

function readStoredHeight(): number {
  const value = Number(localStorage.getItem(HEIGHT_KEY))
  return Number.isFinite(value) && value >= MIN_PANE ? value : DEFAULT_HEIGHT
}

// Stacks the local File Explorer over the SFTP Server Explorer with a draggable divider, so files can
// be dragged between them (transfers land in a later step). Toggled from a bottom bar; both the
// open state and the SFTP pane height persist in localStorage.
export function FileExplorerSftpSplit(): React.JSX.Element {
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const [height, setHeight] = useState(readStoredHeight)
  const containerRef = useRef<HTMLDivElement>(null)

  const toggle = useCallback(() => {
    setOpen((prev) => {
      const next = !prev
      localStorage.setItem(OPEN_KEY, next ? '1' : '0')
      return next
    })
  }, [])

  const onResizeStart = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault()
      const startY = event.clientY
      const startHeight = height
      const container = containerRef.current
      // Leave at least MIN_PANE for the local tree on top.
      const maxHeight = container ? Math.max(MIN_PANE, container.clientHeight - MIN_PANE) : 9999
      const onMove = (moveEvent: MouseEvent): void => {
        // Dragging up grows the bottom (SFTP) pane.
        const next = Math.max(
          MIN_PANE,
          Math.min(maxHeight, startHeight + (startY - moveEvent.clientY))
        )
        setHeight(next)
      }
      const onUp = (): void => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        setHeight((current) => {
          localStorage.setItem(HEIGHT_KEY, String(Math.round(current)))
          return current
        })
      }
      document.body.style.cursor = 'row-resize'
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [height]
  )

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileExplorer />
      </div>
      {open ? (
        <>
          <div
            role="separator"
            aria-orientation="horizontal"
            onMouseDown={onResizeStart}
            className="group flex h-1.5 w-full shrink-0 cursor-row-resize items-center"
          >
            <div className="h-px w-full bg-border transition-colors group-hover:bg-ring" />
          </div>
          <div className="flex min-h-0 shrink-0 flex-col" style={{ height }}>
            <Suspense fallback={null}>
              <ServerExplorer />
            </Suspense>
          </div>
        </>
      ) : null}
      <button
        type="button"
        onClick={toggle}
        aria-pressed={open}
        className={cn(
          'flex shrink-0 items-center justify-center gap-1.5 border-t border-border py-1',
          'text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground'
        )}
      >
        <Server className="size-3" />
        {open
          ? translate('auto.components.right-sidebar.FileExplorerSftpSplit.hide', 'Hide SFTP')
          : translate('auto.components.right-sidebar.FileExplorerSftpSplit.show', 'Show SFTP')}
        {open ? <ChevronDown className="size-3" /> : <ChevronUp className="size-3" />}
      </button>
    </div>
  )
}
