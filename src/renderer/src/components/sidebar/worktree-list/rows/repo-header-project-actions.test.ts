import { describe, expect, it } from 'vitest'
import { canOpenProjectInNewWindow } from './repo-header-project-actions'

describe('canOpenProjectInNewWindow', () => {
  it('shows for a free local project (owned by no window)', () => {
    expect(
      canOpenProjectInNewWindow({
        isOpenInOtherWindow: false,
        isOwnActiveProject: false,
        executionHostId: 'local'
      })
    ).toBe(true)
  })

  it('hides when the project is already open in another window (header marker + raise instead)', () => {
    expect(
      canOpenProjectInNewWindow({
        isOpenInOtherWindow: true,
        isOwnActiveProject: false,
        executionHostId: 'local'
      })
    ).toBe(false)
  })

  // Why: this window already owns the project it displays; "open in new window" is for a
  // DIFFERENT (free) project. Gating it out here is what caps windows at the project count.
  it('hides for this window own active project', () => {
    expect(
      canOpenProjectInNewWindow({
        isOpenInOtherWindow: false,
        isOwnActiveProject: true,
        executionHostId: 'local'
      })
    ).toBe(false)
  })

  // Why excluded: project windows defer non-local terminal attach, so an SSH/runtime
  // window would open onto dead panes.
  it('hides for SSH- and runtime-hosted projects', () => {
    expect(
      canOpenProjectInNewWindow({
        isOpenInOtherWindow: false,
        isOwnActiveProject: false,
        executionHostId: 'ssh:box'
      })
    ).toBe(false)
    expect(
      canOpenProjectInNewWindow({
        isOpenInOtherWindow: false,
        isOwnActiveProject: false,
        executionHostId: 'runtime:env-1'
      })
    ).toBe(false)
  })
})
