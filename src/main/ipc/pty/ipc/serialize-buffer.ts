import { randomUUID } from 'node:crypto'
import { getPtyIpc } from '../../pty-host-bindings'
import { parseTerminalKittyKeyboardFlags } from '../../../../shared/terminal-kitty-keyboard-flags'
import { sendToPtyOwner } from '../../../window/window-affinity-router'
import { isPtyEventFromTrustedAppWindow } from './write-input'
import type { PtyIpcSession, SerializeResult } from '../session'

export function settleSerializeRequest(
  session: PtyIpcSession,
  requestId: string,
  result: SerializeResult
): void {
  const pending = session.pendingSerializeRequests.get(requestId)
  if (!pending) {
    return
  }
  clearTimeout(pending.timeout)
  session.pendingSerializeRequests.delete(requestId)
  pending.resolve(result)
}

export function installPtySerializeBufferIpc(session: PtyIpcSession): void {
  const ipcMain = getPtyIpc()
  // Why: one persistent listener with a request-ID dispatch table instead of one per call, so concurrent serialize requests don't trip Node's MaxListeners=10 warning.
  ipcMain.on(
    'pty:serializeBuffer:response',
    (
      event,
      args: {
        requestId?: string
        snapshot?: {
          data?: unknown
          cols?: unknown
          rows?: unknown
          seq?: unknown
          lastTitle?: unknown
          kittyKeyboardFlags?: unknown
        } | null
      }
    ) => {
      // Why: the snapshot seeds terminal restore state, so only trusted app windows (main or a workspace window that streams the pane) may settle it.
      if (
        !isPtyEventFromTrustedAppWindow(event, session.mainWindow) ||
        typeof args?.requestId !== 'string'
      ) {
        return
      }
      const snapshot = args.snapshot
      if (
        snapshot &&
        typeof snapshot.data === 'string' &&
        typeof snapshot.cols === 'number' &&
        typeof snapshot.rows === 'number'
      ) {
        const result: {
          data: string
          cols: number
          rows: number
          seq?: number
          lastTitle?: string
          kittyKeyboardFlags?: number
        } = {
          data: snapshot.data,
          cols: snapshot.cols,
          rows: snapshot.rows
        }
        if (typeof snapshot.seq === 'number' && Number.isFinite(snapshot.seq)) {
          result.seq = snapshot.seq
        }
        if (typeof snapshot.lastTitle === 'string' && snapshot.lastTitle.length > 0) {
          result.lastTitle = snapshot.lastTitle
        }
        // Why gated on seq: without a boundary the flags cannot be reconciled
        // against live bytes, so they prove nothing.
        const kittyKeyboardFlags = parseTerminalKittyKeyboardFlags(snapshot.kittyKeyboardFlags)
        if (result.seq !== undefined && kittyKeyboardFlags !== undefined) {
          result.kittyKeyboardFlags = kittyKeyboardFlags
        }
        settleSerializeRequest(session, args.requestId, result)
      } else {
        settleSerializeRequest(session, args.requestId, null)
      }
    }
  )
}

export function requestSerializedBuffer(
  session: PtyIpcSession,
  ptyId: string,
  opts?: { scrollbackRows?: number }
): Promise<SerializeResult> {
  const requestId = randomUUID()
  return new Promise<SerializeResult>((resolve) => {
    const timeout = setTimeout(() => {
      settleSerializeRequest(session, requestId, null)
    }, 750)
    session.pendingSerializeRequests.set(requestId, { resolve, timeout })
    const payload: {
      requestId: string
      ptyId: string
      opts?: { scrollbackRows?: number }
    } = { requestId, ptyId }
    if (opts) {
      payload.opts = opts
    }
    // Why owner window: only the window that streams this pty holds its xterm buffer.
    if (!sendToPtyOwner(ptyId, 'pty:serializeBuffer:request', payload)) {
      settleSerializeRequest(session, requestId, null)
    }
  })
}
