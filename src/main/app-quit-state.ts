// Why a module flag: satellite fold-back routing must know the app is
// quitting, and main/index.ts's own isQuitting local is unreachable without
// an import cycle. index.ts marks this in its 'before-quit' handler.
let quitting = false

export function markAppQuitting(): void {
  quitting = true
}

export function isAppQuitting(): boolean {
  return quitting
}

/** A renderer beforeunload can veto the quit; a sticky flag would then
 *  misroute every later fold-back into the session instead of the live parent. */
export function resetAppQuitting(): void {
  quitting = false
}
