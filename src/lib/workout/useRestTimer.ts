/**
 * Rest countdown driven by timestamps (RestState.endsAt), never by counting ticks, so it stays
 * exact across reloads, background throttling and sleeping phones.
 *
 * - Re-renders ~4×/s while the page is visible; nothing runs on an interval while hidden.
 * - While hidden, a single timeout aimed at `endsAt` still fires `onEnd` (so the UI can post a
 *   system notification); if the browser throttled it, `onEnd` fires as soon as the tab is visible.
 * - `onEnd` fires EXACTLY ONCE per rest (keyed by `endsAt`; adjusting the rest makes a new key).
 * - `onTick(sec)` fires once per whole second of remaining time (for 3-2-1 beeps), never for the
 *   initial value of a rest.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RestState } from '../types'

export interface RestTimerOptions {
  /** Called once when the rest reaches 0. `lateMs` = how long ago it actually ended. */
  onEnd?: (info: { lateMs: number }) => void
  /** Called with the new whole seconds left (…, 3, 2, 1) each time it changes while visible. */
  onTick?: (remainingSec: number) => void
}

export interface RestTimerState {
  remainingMs: number
  /** Whole seconds left, rounded up (shows 1 until the very end). */
  remainingSec: number
  /** 0..1 elapsed. */
  fraction: number
  active: boolean
}

const VISIBLE_INTERVAL_MS = 250

const IDLE: RestTimerState = { remainingMs: 0, remainingSec: 0, fraction: 0, active: false }

/** Pure snapshot of a rest at time `now`. */
export function restSnapshot(rest: RestState | null | undefined, now: number): RestTimerState {
  if (!rest) return IDLE
  const total = Math.max(1, rest.endsAt - rest.startedAt)
  const remainingMs = Math.min(total, Math.max(0, rest.endsAt - now))
  return {
    remainingMs,
    remainingSec: Math.ceil(remainingMs / 1000),
    fraction: Math.min(1, Math.max(0, 1 - remainingMs / total)),
    active: remainingMs > 0,
  }
}

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'

export function useRestTimer(rest: RestState | null | undefined, options: RestTimerOptions = {}): RestTimerState {
  const [now, setNow] = useState(() => Date.now())
  const onEndRef = useRef(options.onEnd)
  const onTickRef = useRef(options.onTick)
  useLayoutEffect(() => {
    onEndRef.current = options.onEnd
    onTickRef.current = options.onTick
  })

  /** endsAt of the last rest whose onEnd already fired. */
  const firedRef = useRef<number | null>(null)
  /** Last whole-second value seen for the current rest. */
  const tickRef = useRef<{ key: number; sec: number } | null>(null)

  const endsAt = rest?.endsAt ?? null

  useEffect(() => {
    if (endsAt === null) return
    let interval: ReturnType<typeof setInterval> | undefined
    let timeout: ReturnType<typeof setTimeout> | undefined

    const stopTimers = () => {
      if (interval !== undefined) clearInterval(interval)
      if (timeout !== undefined) clearTimeout(timeout)
      interval = undefined
      timeout = undefined
    }

    /** Recompute from the clock; fire ticks / end as needed. Returns true when the rest is over. */
    const check = (): boolean => {
      const t = Date.now()
      setNow(t)
      const remaining = endsAt - t
      if (remaining > 0) {
        const sec = Math.ceil(remaining / 1000)
        const prev = tickRef.current
        if (!prev || prev.key !== endsAt) {
          tickRef.current = { key: endsAt, sec }
        } else if (sec < prev.sec) {
          tickRef.current = { key: endsAt, sec }
          if (!isHidden()) onTickRef.current?.(sec)
        }
        return false
      }
      if (firedRef.current !== endsAt) {
        firedRef.current = endsAt
        onEndRef.current?.({ lateMs: -remaining })
      }
      return true
    }

    const arm = () => {
      stopTimers()
      if (check()) return
      if (isHidden()) {
        // One shot at the end time: lets the UI notify while the phone is in the pocket.
        timeout = setTimeout(
          () => {
            if (check()) stopTimers()
            else arm()
          },
          Math.max(0, endsAt - Date.now()) + 20,
        )
      } else {
        interval = setInterval(() => {
          if (check()) stopTimers()
        }, VISIBLE_INTERVAL_MS)
      }
    }

    arm()
    const onVisibility = () => arm()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onVisibility)
    return () => {
      stopTimers()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onVisibility)
    }
  }, [endsAt])

  // A rest that just started can be newer than the last clock sample: never show more than its duration.
  return restSnapshot(rest, rest ? Math.max(now, rest.startedAt) : now)
}
