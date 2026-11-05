/**
 * Tiny navigation guard so a screen with unsaved edits can intercept tab-bar navigation.
 * The screen registers a guard while it is dirty; the TabBar asks before following a link.
 * A guard returns `false` to block the navigation (and is responsible for asking the user,
 * then navigating to the remembered href itself).
 */
type Guard = (href: string) => boolean

let guard: Guard | null = null

export function setNavGuard(g: Guard | null): void {
  guard = g
}

export function canNavigate(href: string): boolean {
  return guard ? guard(href) : true
}
