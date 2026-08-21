import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnMock, onMock } from './pty-ipc-mock-registry'
import { setupPtyIpcSuite } from './pty-ipc-test-harness'
import { getPtyRendererDeliveryDebugSnapshot, registerPtyHandlers, deletePtyOwnership } from './pty'
import { registerProjectWindow, unregisterProjectWindow } from '../window/project-window-registry'
import { addTrustedUIRendererWebContentsId, removeTrustedUIRendererWebContentsId } from './ui'

vi.mock('electron', () => import('./pty-ipc-mock-registry').then((m) => m.electronModuleMock()))
vi.mock('fs', () => import('./pty-ipc-mock-registry').then((m) => m.fsModuleMock()))
vi.mock('node-pty', () => import('./pty-ipc-mock-registry').then((m) => m.nodePtyModuleMock()))
vi.mock('node:child_process', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).childProcessModuleMock(await importOriginal())
)
vi.mock('../opencode/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.openCodeHookServiceModuleMock())
)
vi.mock('../mimo/hook-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.mimoHookServiceModuleMock())
)
vi.mock('../agent-hooks/server', () =>
  import('./pty-ipc-mock-registry').then((m) => m.agentHookServerModuleMock())
)
vi.mock('../pi/titlebar-extension-service', () =>
  import('./pty-ipc-mock-registry').then((m) => m.piTitlebarExtensionModuleMock())
)
vi.mock('../pwsh', () => import('./pty-ipc-mock-registry').then((m) => m.pwshModuleMock()))
vi.mock('../wsl', async (importOriginal) =>
  (await import('./pty-ipc-mock-registry')).wslModuleMock(await importOriginal())
)
vi.mock('../telemetry/client', () =>
  import('./pty-ipc-mock-registry').then((m) => m.telemetryClientModuleMock())
)
vi.mock('../telemetry/classify-error', () =>
  import('./pty-ipc-mock-registry').then((m) => m.classifyErrorModuleMock())
)
vi.mock('../cli/linux-terminal-orca-cli-shim', () =>
  import('./pty-ipc-mock-registry').then((m) => m.linuxCliShimModuleMock())
)
vi.mock('../memory/pty-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.ptyRegistryModuleMock())
)
vi.mock('../agent-hooks/migration-unsupported-pty-state', () =>
  import('./pty-ipc-mock-registry').then((m) => m.migrationUnsupportedPtyModuleMock())
)
vi.mock('../codex/codex-pane-account-registry', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexPaneAccountRegistryModuleMock())
)
vi.mock('../codex/codex-state-db-backfill-recovery', () =>
  import('./pty-ipc-mock-registry').then((m) => m.codexBackfillRecoveryModuleMock())
)

describe('registerPtyHandlers (project-window stream routing)', () => {
  const { handlers, mainWindow, getPtyWriteListener, getPtyAckDataListener, createMockProc } =
    setupPtyIpcSuite()

  const WORKSPACE_WEB_CONTENTS_ID = 707
  const PROJECT_KEY = 'repo-1'
  const WORKTREE_ID = 'repo-1::wt-owned'

  function createWorkspaceWindow() {
    return {
      isDestroyed: () => false,
      webContents: {
        id: WORKSPACE_WEB_CONTENTS_ID,
        isDestroyed: () => false,
        getType: () => 'window',
        getURL: () => 'file:///opt/orca/renderer/index.html?orca-project=repo-1',
        on: vi.fn(),
        send: vi.fn(),
        removeListener: vi.fn()
      }
    }
  }

  function createRuntimeStub(worktreeIdByPty: Map<string, string>) {
    return {
      setPtyController: vi.fn(),
      registerPty: vi.fn(),
      noteTerminalSpawnCommand: vi.fn(),
      onPtySpawned: vi.fn(),
      onPtyExit: vi.fn(),
      onPtyData: vi.fn(() => 0),
      getPtyOutputSequence: vi.fn(() => 0),
      getDriver: vi.fn(() => ({ kind: 'desktop' })),
      getPtyWorktreeId: vi.fn((ptyId: string) => worktreeIdByPty.get(ptyId)),
      // Project routing: worktree ids are `repoId::path`; the injected resolver mirrors the runtime accessor.
      getWorktreeRepoId: vi.fn((worktreeId: string) => worktreeId.split('::')[0]),
      createPreAllocatedTerminalHandle: vi.fn(() => null),
      preAllocateHandleForPty: vi.fn()
    }
  }

  function fireWorkspaceDispatcherReady(workspaceWindow: ReturnType<typeof createWorkspaceWindow>) {
    const readyCall = onMock.mock.calls.find(
      (call: unknown[]) => call[0] === 'pty:rendererDispatcherReady'
    )
    ;(readyCall![1] as (event: unknown) => void)({ sender: workspaceWindow.webContents })
  }

  const cleanups: (() => void)[] = []
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) {
      cleanup()
    }
  })

  function registerWorkspace(workspaceWindow: ReturnType<typeof createWorkspaceWindow>): void {
    registerProjectWindow(PROJECT_KEY, workspaceWindow as never)
    addTrustedUIRendererWebContentsId(workspaceWindow.webContents.id)
    cleanups.push(() => {
      unregisterProjectWindow(PROJECT_KEY, workspaceWindow as never)
      removeTrustedUIRendererWebContentsId(workspaceWindow.webContents.id)
    })
  }

  it('streams pty:data, exit, and spawned to the worktree owner window only', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      registerWorkspace(workspaceWindow)
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      const result = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        worktreeId: WORKTREE_ID
      })) as { id: string }
      worktreeIdByPty.set(result.id, WORKTREE_ID)
      fireWorkspaceDispatcherReady(workspaceWindow)
      mainWindow.webContents.send.mockClear()
      workspaceWindow.webContents.send.mockClear()

      mockProc.emitData('owned output')
      vi.advanceTimersByTime(2)

      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: result.id, data: 'owned output' })
      )
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('pty:data', expect.anything())

      mockProc.emitExit(0)
      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith('pty:exit', {
        id: result.id,
        code: 0,
        incarnationId: expect.any(String)
      })
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('pty:exit', expect.anything())
    } finally {
      vi.useRealTimers()
    }
  })

  it('holds workspace-owned output until that window reports its dispatcher ready', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      registerWorkspace(workspaceWindow)
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      const result = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        worktreeId: WORKTREE_ID
      })) as { id: string }
      worktreeIdByPty.set(result.id, WORKTREE_ID)

      // The main window's boot handshake already fired; the workspace window's gate is its own.
      mockProc.emitData('early bytes')
      vi.advanceTimersByTime(10)
      expect(workspaceWindow.webContents.send).not.toHaveBeenCalledWith(
        'pty:data',
        expect.anything()
      )
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('pty:data', expect.anything())

      fireWorkspaceDispatcherReady(workspaceWindow)
      vi.advanceTimersByTime(2)
      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: result.id, data: 'early bytes' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('accepts writes and ACK credit from the trusted workspace window', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      registerWorkspace(workspaceWindow)
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      const result = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        worktreeId: WORKTREE_ID
      })) as { id: string }
      worktreeIdByPty.set(result.id, WORKTREE_ID)
      fireWorkspaceDispatcherReady(workspaceWindow)

      getPtyWriteListener()(
        { sender: workspaceWindow.webContents },
        {
          id: result.id,
          data: 'typed-in-workspace'
        }
      )
      expect(mockProc.proc.write).toHaveBeenCalledWith('typed-in-workspace')

      mockProc.emitData('echo')
      vi.advanceTimersByTime(2)
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe('echo'.length)

      getPtyAckDataListener()({ sender: workspaceWindow.webContents } as never, {
        id: result.id,
        processedChars: 'echo'.length
      })
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('re-routes to the main window after the workspace window closes, resetting per-pty accounting', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      registerWorkspace(workspaceWindow)
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      const result = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        worktreeId: WORKTREE_ID
      })) as { id: string }
      worktreeIdByPty.set(result.id, WORKTREE_ID)
      fireWorkspaceDispatcherReady(workspaceWindow)

      mockProc.emitData('to-workspace')
      vi.advanceTimersByTime(2)
      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: result.id, data: 'to-workspace' })
      )

      // Window closed: the registry entry goes away and the stream falls back to main.
      unregisterProjectWindow(PROJECT_KEY, workspaceWindow as never)
      mainWindow.webContents.send.mockClear()
      mockProc.emitData('back-to-main')
      vi.advanceTimersByTime(2)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: result.id, data: 'back-to-main' })
      )
      // Unacked workspace debt was released with the owner change — main starts clean.
      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: result.id,
        processedChars: 'back-to-main'.length
      })
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(0)

      deletePtyOwnership(result.id)
    } finally {
      vi.useRealTimers()
    }
  })

  // Regression for the workspace-window takeover: a second sessionId attach is the renderer-reload
  // reattach path (provider returns the live pty, isReattach), so the later claim must win delivery.
  it('second sessionId attach from another window takes over delivery without killing the pty', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      // First attach: no workspace window yet — the main window owns the stream.
      const first = (await handlers.get('pty:spawn')!(
        { sender: mainWindow.webContents },
        {
          cols: 80,
          rows: 24,
          cwd: '/tmp',
          worktreeId: WORKTREE_ID,
          sessionId: 'sess-takeover'
        }
      )) as { id: string; isReattach?: boolean }
      worktreeIdByPty.set(first.id, WORKTREE_ID)
      mockProc.emitData('main-era')
      vi.advanceTimersByTime(2)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: first.id, data: 'main-era' })
      )
      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: first.id,
        processedChars: 'main-era'.length
      })

      // Second attach for the same session, now from the workspace window.
      registerWorkspace(workspaceWindow)
      const second = (await handlers.get('pty:spawn')!(
        { sender: workspaceWindow.webContents },
        {
          cols: 80,
          rows: 24,
          cwd: '/tmp',
          worktreeId: WORKTREE_ID,
          sessionId: 'sess-takeover'
        }
      )) as { id: string; isReattach?: boolean }
      expect(second.id).toBe(first.id)
      expect(second.isReattach).toBe(true)
      expect(mockProc.proc.kill).not.toHaveBeenCalled()

      fireWorkspaceDispatcherReady(workspaceWindow)
      mainWindow.webContents.send.mockClear()
      mockProc.emitData('workspace-era')
      vi.advanceTimersByTime(2)
      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: first.id, data: 'workspace-era' })
      )
      expect(mainWindow.webContents.send).not.toHaveBeenCalledWith('pty:data', expect.anything())
      // The owner change released main's claim and latched a restore marker for the new owner.
      expect(workspaceWindow.webContents.send).toHaveBeenCalledWith(
        'pty:modelRestoreNeeded',
        expect.objectContaining({ id: first.id, reason: 'delivery-heal' })
      )

      // A straggler cumulative ack from the demoted main window must not credit the new owner's debt.
      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: first.id,
        processedChars: 'main-era'.length
      })
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(
        'workspace-era'.length
      )

      // The workspace window's own counter starts at zero and drains its debt exactly.
      getPtyAckDataListener()({ sender: workspaceWindow.webContents } as never, {
        id: first.id,
        processedChars: 'workspace-era'.length
      })
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(0)

      deletePtyOwnership(first.id)
    } finally {
      vi.useRealTimers()
    }
  })

  it('discounts a returning owner window’s persisted cumulative counter (ack baseline)', async () => {
    vi.useFakeTimers()
    try {
      const worktreeIdByPty = new Map<string, string>()
      const runtime = createRuntimeStub(worktreeIdByPty)
      const workspaceWindow = createWorkspaceWindow()
      const mockProc = createMockProc()
      spawnMock.mockReturnValue(mockProc.proc)
      registerPtyHandlers(mainWindow as never, runtime as never)

      const result = (await handlers.get('pty:spawn')!(null, {
        cols: 80,
        rows: 24,
        cwd: '/tmp',
        worktreeId: WORKTREE_ID
      })) as { id: string }
      worktreeIdByPty.set(result.id, WORKTREE_ID)
      mockProc.emitData('first-bytes') // 11 chars — main's renderer counter reaches 11.
      vi.advanceTimersByTime(2)
      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: result.id,
        processedChars: 'first-bytes'.length
      })

      registerWorkspace(workspaceWindow)
      fireWorkspaceDispatcherReady(workspaceWindow)
      mockProc.emitData('second-era') // owned by the workspace window, never acked there
      vi.advanceTimersByTime(2)

      unregisterProjectWindow(PROJECT_KEY, workspaceWindow as never)
      mainWindow.webContents.send.mockClear()
      mockProc.emitData('era-three!') // 10 chars back to main
      vi.advanceTimersByTime(2)
      expect(mainWindow.webContents.send).toHaveBeenCalledWith(
        'pty:data',
        expect.objectContaining({ id: result.id, data: 'era-three!' })
      )

      // Main's renderer counter never reset (no exit/reload): 11 old + 4 newly parsed chars.
      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: result.id,
        processedChars: 'first-bytes'.length + 4
      })
      // Without the ackBase discount the stale 11 would credit the whole 10-char debt.
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(
        'era-three!'.length - 4
      )

      getPtyAckDataListener()({ sender: mainWindow.webContents } as never, {
        id: result.id,
        processedChars: 'first-bytes'.length + 'era-three!'.length
      })
      expect(getPtyRendererDeliveryDebugSnapshot().rendererInFlightChars).toBe(0)

      deletePtyOwnership(result.id)
    } finally {
      vi.useRealTimers()
    }
  })
})
