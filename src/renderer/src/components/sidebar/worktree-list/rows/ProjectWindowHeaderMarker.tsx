import React from 'react'
import { AppWindow } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'

/**
 * Muted project-header marker shown when the project (repoId or `folder:` key) is
 * open in another app window — activating its worktrees raises that window.
 */
export function ProjectWindowHeaderMarker({
  projectKey
}: {
  projectKey: string
}): React.JSX.Element | null {
  // Why boolean-selected: headers re-render only when their own membership flips, not on every registry change.
  const isOpenInOtherWindow = useAppStore((s) => s.projectKeysInOtherWindows.has(projectKey))
  if (!isOpenInOtherWindow) {
    return null
  }
  const label = translate(
    'auto.components.sidebar.WorktreeList.projectOpenInAnotherWindow',
    'Project open in another window'
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground/70">
          <AppWindow className="size-3" aria-hidden="true" />
          <span className="sr-only">{label}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
