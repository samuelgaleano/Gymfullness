/**
 * System notifications for the end of a rest when the phone is in the pocket / the tab is hidden.
 * Prefers ServiceWorkerRegistration.showNotification (the only path that works on Android
 * Chrome and installed iOS PWAs); falls back to `new Notification` on desktop.
 * Never notifies while the page is visible (the in-app beep/toast covers that).
 */

export interface NotifyOptions {
  /** Same tag replaces the previous notification instead of stacking (default 'gymfullness-rest'). */
  tag?: string
  /** Vibration pattern in ms (Android). */
  vibrate?: number[]
  /** Show even if the page is visible (default false). */
  force?: boolean
  /** Path opened/focused on click when handled by the service worker (default '/workout'). */
  url?: string
}

/** lib.dom lacks a few widely supported fields. */
type RichNotificationOptions = NotificationOptions & { renotify?: boolean; vibrate?: number[] }

const DEFAULT_TAG = 'gymfullness-rest'
const DEFAULT_VIBRATE = [200, 100, 200]
const ICON = '/pwa-192.png'

export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window
}

/** Current permission, or 'unsupported'. */
export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported'
}

/** Ask for permission (must be called from a user gesture). Resolves true when granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

async function activeRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !navigator.serviceWorker) return null
  try {
    // `ready` never settles when no worker is registered (dev), so check first and time-box it.
    const existing = await navigator.serviceWorker.getRegistration()
    if (!existing) return null
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ])
    return ready ?? (existing.active ? existing : null)
  } catch {
    return null
  }
}

/** Show a system notification when the page is hidden. Resolves true if one was shown. */
export async function notify(title: string, body: string, opts: NotifyOptions = {}): Promise<boolean> {
  if (!notificationsSupported() || Notification.permission !== 'granted') return false
  if (!opts.force && typeof document !== 'undefined' && !document.hidden) return false

  const options: RichNotificationOptions = {
    body,
    tag: opts.tag || DEFAULT_TAG,
    renotify: true,
    vibrate: opts.vibrate ?? DEFAULT_VIBRATE,
    icon: ICON,
    badge: ICON,
    lang: 'es',
    silent: false,
    data: { url: opts.url ?? '/workout' },
  }

  const registration = await activeRegistration()
  if (registration) {
    try {
      await registration.showNotification(title, options)
      return true
    } catch {
      /* fall through to the page-level API */
    }
  }
  try {
    const n = new Notification(title, options)
    n.onclick = () => {
      window.focus()
      n.close()
    }
    return true
  } catch {
    // Android Chrome throws "Illegal constructor" outside a service worker.
    return false
  }
}
