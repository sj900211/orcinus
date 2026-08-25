import type { RefObject } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { FileExplorerRowProjection } from './file-explorer-row-projection'

/** Row virtualizer for the SFTP tree — mirrors the local explorer's sizing (26px, overscan 20). */
export function useServerExplorerVirtualizer(
  scrollRef: RefObject<HTMLDivElement | null>,
  rowProjection: FileExplorerRowProjection
): Virtualizer<HTMLDivElement, Element> {
  return useVirtualizer({
    count: rowProjection.getVisibleCount(),
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 26,
    overscan: 20,
    getItemKey: (index) => rowProjection.getRowAtIndex(index)?.path ?? `__fallback_${index}`
  })
}
