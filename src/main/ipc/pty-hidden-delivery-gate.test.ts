import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetHiddenRendererPtyDeliveryGateForTest,
  clearHiddenRendererPtyDeliveryState,
  getHiddenRendererPtyDeliveryDebug,
  isHiddenPtyDeliveryGateEnabled,
  isHiddenRendererPtyInAnyWindow,
  markHiddenRendererPty,
  recordHiddenRendererPtyDataDrop,
  resetRendererScopedHiddenPtyDeliveryState,
  setRendererPtyDeliveryInterest,
  shouldDropHiddenRendererPtyData,
  shouldDropHiddenRendererPtyDataInAnyWindow,
  unmarkHiddenRendererPty
} from './pty-hidden-delivery-gate'

const PTY_ID = 'pty-1'
const WINDOW_A = 11
const WINDOW_B = 22

describe('pty hidden delivery gate', () => {
  beforeEach(() => {
    _resetHiddenRendererPtyDeliveryGateForTest()
  })

  it('only operates when both kill switches are on (default on)', () => {
    expect(isHiddenPtyDeliveryGateEnabled(undefined)).toBe(true)
    expect(isHiddenPtyDeliveryGateEnabled({})).toBe(true)
    expect(isHiddenPtyDeliveryGateEnabled({ terminalHiddenDeliveryGate: false })).toBe(false)
    expect(isHiddenPtyDeliveryGateEnabled({ terminalMainSideEffectAuthority: false })).toBe(false)
  })

  it('drops only hidden PTYs without registered delivery interest', () => {
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(false)

    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(true)
    expect(
      shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, { terminalHiddenDeliveryGate: false })
    ).toBe(false)

    setRendererPtyDeliveryInterest(WINDOW_A, PTY_ID, true)
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(false)
    setRendererPtyDeliveryInterest(WINDOW_A, PTY_ID, false)
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(true)
  })

  it('keeps hidden and interest marks scoped to their reporting window', () => {
    markHiddenRendererPty(WINDOW_A, PTY_ID)

    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(true)
    expect(shouldDropHiddenRendererPtyData(WINDOW_B, PTY_ID, {})).toBe(false)
    expect(isHiddenRendererPtyInAnyWindow(PTY_ID)).toBe(true)

    // Window B's interest must not suppress window A's gate.
    setRendererPtyDeliveryInterest(WINDOW_B, PTY_ID, true)
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(true)
    expect(shouldDropHiddenRendererPtyDataInAnyWindow(PTY_ID, {})).toBe(false)
  })

  it('requests the restore marker exactly once per drop episode, re-armed by unmark', () => {
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(recordHiddenRendererPtyDataDrop(PTY_ID, 10).shouldEmitRestoreMarker).toBe(true)
    expect(recordHiddenRendererPtyDataDrop(PTY_ID, 10).shouldEmitRestoreMarker).toBe(false)

    // Why: unmark consumes the latch (and re-emits via its own return value);
    // the next hidden period's first drop reports again.
    unmarkHiddenRendererPty(WINDOW_A, PTY_ID)
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(recordHiddenRendererPtyDataDrop(PTY_ID, 10).shouldEmitRestoreMarker).toBe(true)
  })

  it('keeps drop memory when an already-dropped PTY is re-marked hidden', () => {
    // Why: a hidden remount or renderer reload re-marks without an unhide in
    // between — clearing the latch there would make reveal skip the restore.
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    recordHiddenRendererPtyDataDrop(PTY_ID, 10)
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(unmarkHiddenRendererPty(WINDOW_A, PTY_ID).droppedWhileHidden).toBe(true)
  })

  it('reports drops on unhide so reveal can heal a replaced renderer view', () => {
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(unmarkHiddenRendererPty(WINDOW_A, PTY_ID).droppedWhileHidden).toBe(false)

    markHiddenRendererPty(WINDOW_A, PTY_ID)
    recordHiddenRendererPtyDataDrop(PTY_ID, 10)
    expect(unmarkHiddenRendererPty(WINDOW_A, PTY_ID).droppedWhileHidden).toBe(true)
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(false)
  })

  it('clears one window on reload while preserving other windows and drop memory', () => {
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    recordHiddenRendererPtyDataDrop(PTY_ID, 10)
    setRendererPtyDeliveryInterest(WINDOW_A, 'pty-2', true)
    markHiddenRendererPty(WINDOW_A, 'pty-2')
    markHiddenRendererPty(WINDOW_B, 'pty-3')

    resetRendererScopedHiddenPtyDeliveryState(WINDOW_A)

    // Window A's hidden marks and interest holds died with its renderer process.
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(false)
    expect(getHiddenRendererPtyDeliveryDebug()).toMatchObject({
      hiddenDeliveryGatedPtyCount: 1,
      deliveryInterestPtyCount: 0
    })
    // Window B's marks stay untouched by window A's reload.
    expect(shouldDropHiddenRendererPtyData(WINDOW_B, 'pty-3', {})).toBe(true)
    // pty-2's leaked interest is gone: re-marking gates it again.
    markHiddenRendererPty(WINDOW_A, 'pty-2')
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, 'pty-2', {})).toBe(true)
    // Drop memory survives so the new renderer's first unhide still restores.
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    expect(unmarkHiddenRendererPty(WINDOW_A, PTY_ID).droppedWhileHidden).toBe(true)
  })

  it('clears all per-PTY state across windows on teardown and tracks debug counters', () => {
    markHiddenRendererPty(WINDOW_A, PTY_ID)
    markHiddenRendererPty(WINDOW_B, PTY_ID)
    setRendererPtyDeliveryInterest(WINDOW_A, 'pty-2', true)
    recordHiddenRendererPtyDataDrop(PTY_ID, 7)
    recordHiddenRendererPtyDataDrop(PTY_ID, 5)

    expect(getHiddenRendererPtyDeliveryDebug()).toEqual({
      hiddenDeliveryGatedPtyCount: 1,
      deliveryInterestPtyCount: 1,
      hiddenDeliveryDroppedChars: 12,
      hiddenDeliveryDroppedChunks: 2
    })

    clearHiddenRendererPtyDeliveryState(PTY_ID)
    clearHiddenRendererPtyDeliveryState('pty-2')
    expect(getHiddenRendererPtyDeliveryDebug()).toMatchObject({
      hiddenDeliveryGatedPtyCount: 0,
      deliveryInterestPtyCount: 0
    })
    expect(shouldDropHiddenRendererPtyData(WINDOW_A, PTY_ID, {})).toBe(false)
    expect(shouldDropHiddenRendererPtyData(WINDOW_B, PTY_ID, {})).toBe(false)
  })
})
