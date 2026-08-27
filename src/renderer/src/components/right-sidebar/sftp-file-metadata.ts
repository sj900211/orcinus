// Format a POSIX permission mode's low 9 bits as an `rwxr-xr-x` string (owner/group/other).
export function formatPosixMode(mode: number): string {
  const triad = (bits: number): string =>
    `${bits & 4 ? 'r' : '-'}${bits & 2 ? 'w' : '-'}${bits & 1 ? 'x' : '-'}`
  return triad((mode >> 6) & 7) + triad((mode >> 3) & 7) + triad(mode & 7)
}

// Compact local `YYYY-MM-DD HH:mm` for a last-modified time in epoch milliseconds.
export function formatMtime(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
