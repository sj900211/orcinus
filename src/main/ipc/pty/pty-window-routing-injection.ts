import type { BrowserWindow } from 'electron'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import {
  setMainWindowForRouting,
  setProjectKeyResolverForRouting,
  setPtyWorktreeResolverForRouting
} from '../../window/window-affinity-router'

export function injectPtyWindowRouting(
  mainWindow: BrowserWindow | undefined,
  runtime: OrcaRuntimeService | undefined
): void {
  // Fork regate: every pty stream resolves its owner window through the affinity
  // router — main fallback plus the runtime's pty→worktree and worktree→project
  // resolvers must be injected the moment handlers bind, or the router silently
  // routes everything to main.
  // Why: headless must clear a previously routed window, or owner-routed sends keep reaching it.
  setMainWindowForRouting(mainWindow ?? null)
  // Optional calls: pared-down runtime stubs (tests, headless) may omit the routing accessors.
  setPtyWorktreeResolverForRouting(runtime ? (ptyId) => runtime.getPtyWorktreeId?.(ptyId) : null)
  setProjectKeyResolverForRouting(
    runtime ? (worktreeId) => runtime.getWorktreeRepoId?.(worktreeId) : null
  )
}
