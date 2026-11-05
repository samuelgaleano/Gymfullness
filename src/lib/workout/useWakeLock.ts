/**
 * Keep the screen on during a workout (Screen Wake Lock API).
 * The browser drops the lock whenever the page is hidden, so it is re-acquired on
 * visibilitychange. Released when `enabled` turns false or on unmount.
 * Silent no-op where unsupported (older iOS, desktop Firefox) or when the request is refused.
 */
import { useEffect, useState } from 'react'

export function wakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator && !!navigator.wakeLock
}

export function useWakeLock(enabled: boolean): { supported: boolean; active: boolean } {
  const [active, setActive] = useState(false)
  const supported = wakeLockSupported()

  useEffect(() => {
    if (!enabled || !wakeLockSupported()) return
    let sentinel: WakeLockSentinel | null = null
    let pending = false
    let disposed = false

    const acquire = async () => {
      if (disposed || pending || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      pending = true
      try {
        const lock = await navigator.wakeLock.request('screen')
        if (disposed) {
          lock.release().catch(() => undefined)
          return
        }
        sentinel = lock
        setActive(true)
        lock.addEventListener('release', () => {
          if (sentinel !== lock) return
          sentinel = null
          if (!disposed) setActive(false)
        })
      } catch {
        // NotAllowedError (battery saver, not visible…) — nothing to do.
      } finally {
        pending = false
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      disposed = true
      document.removeEventListener('visibilitychange', onVisibility)
      const lock = sentinel
      sentinel = null
      if (lock && !lock.released) lock.release().catch(() => undefined)
      setActive(false)
    }
  }, [enabled])

  return { supported, active: enabled && active }
}
