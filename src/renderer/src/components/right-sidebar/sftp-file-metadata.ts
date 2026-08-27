// Format a POSIX permission mode's low 9 bits as an `rwxr-xr-x` string (owner/group/other).
export function formatPosixMode(mode: number): string {
  const triad = (bits: number): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`
  return triad((mode >> 6) & 7) + triad((mode >> 3) & 7) + triad(mode & 7)
}
