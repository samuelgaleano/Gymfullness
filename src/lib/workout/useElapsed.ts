/**
 * Whole seconds elapsed since a timestamp, re-rendering on each second boundary.
 * Pass `until` (e.g. session.endedAt) to freeze the value without any timer.
 */
import { useEffect, useState } from 'react'

/** Pure: whole seconds between `since` and `now` (0 when missing or in the future). */
export function elapsedSeconds(since: number | null | undefined, now: number): number {
  if (typeof since !== 'number' || !Number.isFinite(since)) return 0
  return Math.max(0, Math.floor((now - since) / 1000))
}

export function useElapsed(since: number | null | undefined, until?: number | null): number {
  const [now, setNow] = useState(() => Date.now())
  const running = typeof since === 'number' && Number.isFinite(since) && (until === undefined || until === null)

  useEffect(() => {
    if (!running || typeof since !== 'number') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = () => {
      const t = Date.now()
      setNow(t)
      // Align to the next whole second since `since`, so the clock flips exactly on time.
      const ms = (((t - since) % 1000) + 1000) % 1000
      timer = setTimeout(tick, Math.max(16, 1000 - ms + 5))
    }
    tick()
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (timer !== undefined) clearTimeout(timer)
      tick()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [running, since])

  if (typeof until === 'number' && Number.isFinite(until)) return elapsedSeconds(since, until)
  return elapsedSeconds(since, Math.max(now, typeof since === 'number' ? since : now))
}
