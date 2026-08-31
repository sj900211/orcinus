// Which kind of window this renderer runs in. Satellite editor windows
// (Expedition 5) reuse app components that must occasionally opt out of
// workbench-only affordances (e.g. the split-layout tab menu section) —
// threading a prop through every tab-strip layer would touch far more code
// than one module flag set once at entry-point boot, before any render.

export type RendererWindowSurface = 'app' | 'satellite'

let rendererWindowSurface: RendererWindowSurface = 'app'

export function setRendererWindowSurface(surface: RendererWindowSurface): void {
  rendererWindowSurface = surface
}

export function getRendererWindowSurface(): RendererWindowSurface {
  return rendererWindowSurface
}
