import { useCallback, useEffect, useRef, useState } from 'react'
import type { DirCache } from './file-explorer-types'
import {
  readServerExplorerDirectory,
  sftpEntriesToTreeNodes
} from './server-explorer-directory-listing'

type UseServerExplorerTreeResult = {
  dirCache: Record<string, DirCache>
  rootCache: DirCache | undefined
  rootError: string | null
  expanded: Set<string>
  loadDir: (dirPath: string, depth: number, options?: { force?: boolean }) => Promise<boolean>
  toggleDir: (dirPath: string) => void
  refreshDir: (dirPath: string) => void
  reset: () => void
}

/**
 * Read-only SFTP tree data source that mirrors useFileExplorerTree's shape so the shared
 * presentation layer (FileExplorerVirtualRows/projection) can consume it unchanged.
 *
 * Owns its own `expanded` Set instead of the worktree-keyed store: SFTP host selection is
 * workspace-independent, so keying by worktreeId would leak one host's tree into another.
 */
export function useServerExplorerTree(
  targetId: string | null,
  rootPath: string | null
): UseServerExplorerTreeResult {
  const [dirCache, setDirCache] = useState<Record<string, DirCache>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [rootError, setRootError] = useState<string | null>(null)
  // Why: a host/root switch must invalidate in-flight reads so a slow prior host can't
  // commit its listing into the new host's cache.
  const generationRef = useRef(0)
  // Why: toggle/refresh look up a dir's depth from the current cache without re-creating the
  // callbacks on every commit (which would churn memoized child props).
  const dirCacheRef = useRef(dirCache)
  dirCacheRef.current = dirCache

  const loadDir = useCallback(
    async (dirPath: string, depth: number, options?: { force?: boolean }): Promise<boolean> => {
      if (!targetId || !rootPath) {
        return false
      }
      const cached = dirCacheRef.current[dirPath]
      if (!options?.force && cached?.children.length && !cached.loading) {
        return true
      }
      const generation = generationRef.current
      const isRoot = dirPath === rootPath
      setDirCache((prev) => ({
        ...prev,
        [dirPath]: { children: prev[dirPath]?.children ?? [], loading: true }
      }))
      try {
        const { entries } = await readServerExplorerDirectory(targetId, dirPath)
        if (generation !== generationRef.current) {
          return false
        }
        const children = sftpEntriesToTreeNodes(entries, dirPath, depth, rootPath)
        setDirCache((prev) => ({ ...prev, [dirPath]: { children, loading: false } }))
        if (isRoot) {
          setRootError(null)
        }
        return true
      } catch (error) {
        if (generation !== generationRef.current) {
          return false
        }
        setDirCache((prev) => ({
          ...prev,
          [dirPath]: { children: prev[dirPath]?.children ?? [], loading: false }
        }))
        if (isRoot) {
          setRootError(error instanceof Error ? error.message : String(error))
        }
        return false
      }
    },
    [rootPath, targetId]
  )

  const toggleDir = useCallback(
    (dirPath: string) => {
      const willExpand = !expanded.has(dirPath)
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(dirPath)) {
          next.delete(dirPath)
        } else {
          next.add(dirPath)
        }
        return next
      })
      if (willExpand && !dirCacheRef.current[dirPath]?.children.length) {
        void loadDir(dirPath, depthOf(dirCacheRef.current, dirPath))
      }
    },
    [expanded, loadDir]
  )

  const refreshDir = useCallback(
    (dirPath: string) => {
      void loadDir(dirPath, depthOf(dirCacheRef.current, dirPath), { force: true })
    },
    [loadDir]
  )

  const reset = useCallback(() => {
    generationRef.current += 1
    setDirCache({})
    setExpanded(new Set())
    setRootError(null)
  }, [])

  // Why: on host/root change, drop the previous host's tree and load the new root fresh.
  useEffect(() => {
    generationRef.current += 1
    setDirCache({})
    setExpanded(new Set())
    setRootError(null)
    if (targetId && rootPath) {
      void loadDir(rootPath, -1, { force: true })
    }
  }, [targetId, rootPath, loadDir])

  return {
    dirCache,
    rootCache: rootPath ? dirCache[rootPath] : undefined,
    rootError,
    expanded,
    loadDir,
    toggleDir,
    refreshDir,
    reset
  }
}

/** A directory's own depth is the child depth of the listing that contains it (root = -1). */
function depthOf(dirCache: Record<string, DirCache>, dirPath: string): number {
  for (const cache of Object.values(dirCache)) {
    const match = cache.children.find((child) => child.path === dirPath)
    if (match) {
      return match.depth
    }
  }
  return -1
}
