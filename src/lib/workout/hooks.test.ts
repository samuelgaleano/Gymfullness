import { StrictMode, createElement, type ReactNode } from 'react'
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RestState } from '../types'
import { restSnapshot, useRestTimer } from './useRestTimer'
import { elapsedSeconds, useElapsed } from './useElapsed'
import { useWakeLock } from './useWakeLock'
import { notify, requestNotificationPermission } from './notify'

const T0 = Date.UTC(2026, 10, 5, 15, 0, 0)

function rest(startedAt: number, sec: number): RestState {
  return { startedAt, endsAt: startedAt + sec * 1000, durationSec: sec, nextExIndex: 0, nextSetIndex: 1 }
}

let hidden = false
function setHidden(value: boolean) {
  hidden = value
  document.dispatchEvent(new Event('visibilitychange'))
}

const strict = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
  hidden = false
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('restSnapshot', () => {
  it('derives everything from timestamps', () => {
    const r = rest(T0, 60)
    expect(restSnapshot(r, T0)).toEqual({ remainingMs: 60_000, remainingSec: 60, fraction: 0, active: true })
    expect(restSnapshot(r, T0 + 45_500)).toMatchObject({ remainingSec: 15, active: true })
    expect(restSnapshot(r, T0 + 30_000).fraction).toBeCloseTo(0.5)
    expect(restSnapshot(r, T0 + 90_000)).toEqual({ remainingMs: 0, remainingSec: 0, fraction: 1, active: false })
    expect(restSnapshot(null, T0).active).toBe(false)
  })
})

describe('useRestTimer', () => {
  it('counts down from the clock and fires onEnd exactly once', () => {
    const onEnd = vi.fn()
    const { result } = renderHook(() => useRestTimer(rest(T0, 5), { onEnd }), { wrapper: strict })
    expect(result.current.remainingSec).toBe(5)
    act(() => void vi.advanceTimersByTime(2_000))
    expect(result.current.remainingSec).toBe(3)
    act(() => void vi.advanceTimersByTime(3_500))
    expect(result.current.active).toBe(false)
    expect(result.current.fraction).toBe(1)
    act(() => void vi.advanceTimersByTime(10_000))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('onTick fires once per whole second, not for the initial value', () => {
    const onTick = vi.fn()
    renderHook(() => useRestTimer(rest(T0, 4), { onTick }))
    act(() => void vi.advanceTimersByTime(4_100))
    expect(onTick.mock.calls.map((c) => c[0])).toEqual([3, 2, 1])
  })

  it('a rest that already ended (reload) fires onEnd right away, once, with how late it is', () => {
    const onEnd = vi.fn()
    renderHook(() => useRestTimer(rest(T0 - 90_000, 60), { onEnd }), { wrapper: strict })
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onEnd.mock.calls[0][0]).toEqual({ lateMs: 30_000 })
  })

  it('while hidden it still ends on time (for the notification), and not twice on return', () => {
    const onEnd = vi.fn()
    const onTick = vi.fn()
    renderHook(() => useRestTimer(rest(T0, 10), { onEnd, onTick }))
    act(() => setHidden(true))
    act(() => void vi.advanceTimersByTime(10_100))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(onTick).not.toHaveBeenCalled()
    act(() => setHidden(false))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('fires immediately when the tab becomes visible after endsAt passed (throttled timers)', () => {
    const onEnd = vi.fn()
    renderHook(() => useRestTimer(rest(T0, 10), { onEnd }))
    act(() => setHidden(true))
    vi.clearAllTimers() // simulate the browser never running our background timeout
    vi.setSystemTime(T0 + 60_000)
    expect(onEnd).not.toHaveBeenCalled()
    act(() => setHidden(false))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('an adjusted rest (new endsAt) gets its own onEnd', () => {
    const onEnd = vi.fn()
    const { rerender } = renderHook(({ r }) => useRestTimer(r, { onEnd }), { initialProps: { r: rest(T0, 2) } })
    act(() => void vi.advanceTimersByTime(2_500))
    expect(onEnd).toHaveBeenCalledTimes(1)
    rerender({ r: { ...rest(T0, 2), endsAt: Date.now() + 15_000 } })
    act(() => void vi.advanceTimersByTime(15_500))
    expect(onEnd).toHaveBeenCalledTimes(2)
  })

  it('null rest is idle', () => {
    const { result } = renderHook(() => useRestTimer(null, {}))
    expect(result.current).toEqual({ remainingMs: 0, remainingSec: 0, fraction: 0, active: false })
  })
})

describe('useElapsed', () => {
  it('ticks every second and freezes with `until`', () => {
    expect(elapsedSeconds(T0, T0 + 61_900)).toBe(61)
    expect(elapsedSeconds(null, T0)).toBe(0)
    const { result } = renderHook(() => useElapsed(T0 - 10_000))
    expect(result.current).toBe(10)
    act(() => void vi.advanceTimersByTime(3_050)) // flips just after each second boundary
    expect(result.current).toBe(13)
    const frozen = renderHook(() => useElapsed(T0 - 10_000, T0 + 50_000))
    expect(frozen.result.current).toBe(60)
  })
})

describe('useWakeLock & notify (unsupported environment)', () => {
  it('is a silent no-op without the APIs', () => {
    const { result, unmount } = renderHook(() => useWakeLock(true))
    expect(result.current.active).toBe(false)
    unmount()
  })

  it('acquires, re-acquires on visibility and releases on unmount', async () => {
    const releases: (() => void)[] = []
    const sentinel = () => {
      const listeners: (() => void)[] = []
      const s = {
        released: false,
        release: vi.fn(async () => {
          s.released = true
          listeners.forEach((l) => l())
        }),
        addEventListener: (_: string, l: () => void) => listeners.push(l),
      }
      releases.push(() => {
        s.released = true
        listeners.forEach((l) => l())
      })
      return s
    }
    const request = vi.fn(async () => sentinel())
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } })
    try {
      const { result, unmount } = renderHook(() => useWakeLock(true))
      await act(async () => {})
      expect(request).toHaveBeenCalledTimes(1)
      expect(result.current.active).toBe(true)
      // the browser drops the lock when hidden; it comes back when visible again
      act(() => releases[0]())
      expect(result.current.active).toBe(false)
      await act(async () => setHidden(false))
      expect(request).toHaveBeenCalledTimes(2)
      expect(result.current.active).toBe(true)
      unmount()
      const last = (await request.mock.results[1].value) as { release: ReturnType<typeof vi.fn> }
      expect(last.release).toHaveBeenCalled()
    } finally {
      Reflect.deleteProperty(navigator, 'wakeLock')
    }
  })

  it('notify/requestNotificationPermission resolve false without Notification support', async () => {
    expect(await requestNotificationPermission()).toBe(false)
    expect(await notify('Descanso terminado', 'Serie 3 de 4')).toBe(false)
  })
})
