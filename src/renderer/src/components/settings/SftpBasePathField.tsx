import { useEffect, useRef, useState } from 'react'
import { Check, FolderTree, LoaderCircle, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '../ui/input'
import { Label } from '../ui/label'
import { translate } from '@/i18n/i18n'

export type SftpDirListing = {
  resolvedPath: string
  entries: { name: string; type: 'file' | 'directory' | 'symlink' }[]
}

type Suggestion = { name: string; path: string }
type PathStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'needs-connection'

type SftpBasePathFieldProps = {
  value: string
  onChange: (value: string) => void
  onValidityChange: (valid: boolean) => void
  /** Whether the current draft has enough connection info to reach the server. */
  canProbe: boolean
  /** Lists a remote directory (saved host or draft probe — chosen by the parent). */
  listDirectory: (path: string) => Promise<SftpDirListing | { error: string }>
}

// POSIX helpers — remote paths are always '/'-separated.
function parentOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  if (index === -1) {
    return '.'
  }
  return index === 0 ? '/' : trimmed.slice(0, index)
}
function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index !== -1 ? trimmed.slice(index + 1) : trimmed
}
function joinPosix(dir: string, name: string): string {
  return dir === '/' ? `/${name}` : `${dir.replace(/\/+$/, '')}/${name}`
}
function toDirSuggestions(listing: SftpDirListing): Suggestion[] {
  return listing.entries
    .filter((entry) => entry.type === 'directory')
    .map((entry) => ({ name: entry.name, path: joinPosix(listing.resolvedPath, entry.name) }))
}

export function SftpBasePathField({
  value,
  onChange,
  onValidityChange,
  canProbe,
  listDirectory
}: SftpBasePathFieldProps): React.JSX.Element {
  const [status, setStatus] = useState<PathStatus>('idle')
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [open, setOpen] = useState(false)
  const generationRef = useRef(0)
  // Why: read the latest lister/callback without re-subscribing the debounce to their identity, which
  // would change on every keystroke and restart the timer.
  const listRef = useRef(listDirectory)
  listRef.current = listDirectory
  const validityRef = useRef(onValidityChange)
  validityRef.current = onValidityChange

  useEffect(() => {
    if (!value.trim()) {
      generationRef.current += 1
      setStatus('idle')
      setSuggestions([])
      validityRef.current(true)
      return
    }
    if (!canProbe) {
      generationRef.current += 1
      setStatus('needs-connection')
      setSuggestions([])
      validityRef.current(false)
      return
    }
    setStatus('checking')
    const generation = (generationRef.current += 1)
    const timer = setTimeout(() => {
      void (async () => {
        const listing = await listRef.current(value)
        if (generation !== generationRef.current) {
          return
        }
        if (!('error' in listing)) {
          setStatus('valid')
          validityRef.current(true)
          setSuggestions(toDirSuggestions(listing))
          return
        }
        // Not itself a directory — offer siblings from the parent so the user can complete the name.
        setStatus('invalid')
        validityRef.current(false)
        const parentListing = await listRef.current(parentOf(value))
        if (generation !== generationRef.current) {
          return
        }
        if ('error' in parentListing) {
          setSuggestions([])
          return
        }
        const prefix = basenameOf(value).toLowerCase()
        setSuggestions(
          toDirSuggestions(parentListing).filter((entry) =>
            entry.name.toLowerCase().startsWith(prefix)
          )
        )
      })()
    }, 250)
    return () => clearTimeout(timer)
  }, [value, canProbe])

  return (
    <div className="col-span-2 space-y-1.5">
      <Label htmlFor="sftp-host-basepath" className="flex items-center gap-1.5">
        <FolderTree className="size-3.5" />
        {translate('auto.components.settings.SftpBasePathField.label', 'Explorer start path')}
      </Label>
      <div className="relative">
        <Input
          id="sftp-host-basepath"
          value={value}
          autoComplete="off"
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={translate(
            'auto.components.settings.SftpBasePathField.placeholder',
            '/home/user/project (empty = server root /)'
          )}
          className={cn(
            'pr-7',
            (status === 'invalid' || status === 'needs-connection') && 'border-destructive/60'
          )}
          aria-invalid={status === 'invalid' || status === 'needs-connection'}
        />
        <span className="absolute right-2 top-1/2 -translate-y-1/2">
          {status === 'checking' ? (
            <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
          ) : status === 'valid' ? (
            <Check className="size-3.5 text-muted-foreground" />
          ) : status === 'invalid' || status === 'needs-connection' ? (
            <X className="size-3.5 text-destructive" />
          ) : null}
        </span>
        {open && suggestions.length > 0 ? (
          <ul className="absolute z-50 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md scrollbar-sleek">
            {suggestions.map((suggestion) => (
              <li key={suggestion.path}>
                <button
                  type="button"
                  className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-xs hover:bg-accent"
                  // Why: mousedown (before the input's blur) so selecting a row doesn't close the list first.
                  onMouseDown={(e) => {
                    e.preventDefault()
                    onChange(suggestion.path)
                  }}
                >
                  <FolderTree className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">{suggestion.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <p className="text-[11px] text-muted-foreground">
        {status === 'needs-connection'
          ? translate(
              'auto.components.settings.SftpBasePathField.needsConnection',
              'Enter connection details to validate the path.'
            )
          : status === 'invalid'
            ? translate(
                'auto.components.settings.SftpBasePathField.invalid',
                'This directory does not exist on the server.'
              )
            : translate(
                'auto.components.settings.SftpBasePathField.hint',
                'Directory the Server Explorer opens at. Leave empty for the server root (/).'
              )}
      </p>
    </div>
  )
}
