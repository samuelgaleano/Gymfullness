/**
 * Debounce for the primary workout button. A nervous double-tap on "Serie hecha" must log ONE
 * set and must not hit the "Saltar descanso" button that replaces it a frame later.
 * Returns a function that is true when the tap should run, false when it is a duplicate.
 */
export function createTapGuard(windowMs = 450, now: () => number = Date.now): () => boolean {
  let last = -Infinity
  return () => {
    const t = now()
    if (t - last < windowMs) return false
    last = t
    return true
  }
}
