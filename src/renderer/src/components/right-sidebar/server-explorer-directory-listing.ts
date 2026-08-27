import { normalizeRelativePath } from '@/lib/path'
import { compareFileNames } from '../../../../shared/file-name-sort'
import type { SftpEntry } from '../../../../preload/api/sftp-api'
import type { TreeNode } from './file-explorer-types'

// Why: SFTP paths are always POSIX; local joinPath would pick '\\' on a Windows client.
export function joinPosix(dirPath: string, name: string): string {
  return dirPath === '/' ? `/${name}` : `${dirPath}/${name}`
}

/** POSIX parent directory ('/' at the root). */
export function parentPosixDir(path: string): string {
  const index = path.lastIndexOf('/')
  return index <= 0 ? '/' : path.slice(0, index)
}

/** POSIX leaf (final path segment). */
export function posixBasename(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** Directories-first, then natural name order — mirrors the local File Explorer contract. */
export function sftpEntriesToTreeNodes(
  entries: SftpEntry[],
  dirPath: string,
  depth: number,
  rootPath: string
): TreeNode[] {
  const nodes = entries.map((entry) => {
    const path = joinPosix(dirPath, entry.name)
    const isDirectory = entry.type === 'directory'
    return {
      name: entry.name,
      path,
      // Why: containment check strips the root prefix so depth-0 rows sit at the tree root.
      relativePath: normalizeRelativePath(
        path.startsWith(`${rootPath}/`) ? path.slice(rootPath.length + 1) : entry.name
      ),
      isDirectory,
      isSymlink: entry.type === 'symlink',
      depth: depth + 1,
      size: entry.size,
      ...(typeof entry.mode === 'number' ? { mode: entry.mode } : {})
    } satisfies TreeNode
  })
  return nodes.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) {
      return a.isDirectory ? -1 : 1
    }
    return compareFileNames(a.name, b.name)
  })
}

/** Reads one remote directory; SFTP APIs return {error} instead of throwing, so re-throw it. */
export async function readServerExplorerDirectory(
  targetId: string,
  path: string
): Promise<{ entries: SftpEntry[]; resolvedPath: string }> {
  const result = await window.api.sftp.readdir({ targetId, path })
  if ('error' in result) {
    throw new Error(result.error)
  }
  return result
}
