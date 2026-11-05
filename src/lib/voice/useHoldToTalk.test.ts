import { act, renderHook } from '@testing-library/react'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toSpeechError, type Recognizer, type RecognizerOptions } from './speech'
import { useHoldToTalk, type UseHoldToTalkOptions } from './useHoldToTalk'

/* ---------------- fake recognizer ---------------- */

interface FakeSession {
  opts: RecognizerOptions
  started: number
  stopped: number
  aborted: number
  active: boolean
  partial: (t: string) => void
  final: (t: string, alts?: string[]) => void
  error: (code: string) => void
  end: () => void
}

function makeFactory() {
  const sessions: FakeSession[] = []
  const factory = (opts: RecognizerOptions): Recognizer => {
    const s: FakeSession = {
      opts,
      started: 0,
      stopped: 0,
      aborted: 0,
      active: false,
      partial: (t) => opts.onPartial?.(t),
      final: (t, alts) => opts.onFinal?.(t, alts ?? [t]),
      error: (code) => opts.onError?.(toSpeechError(code)),
      end: () => {
        s.active = false
        opts.onEnd?.()
      },
    }
    sessions.push(s)
    return {
      start() {
        s.started++
        s.active = true
        return true
      },
      stop() {
        s.stopped++
      },
      abort() {
        s.aborted++
        s.active = false
        opts.onEnd?.()
      },
      get active() {
        return s.active
      },
    }
  }
  return { factory, sessions, last: () => sessions[sessions.length - 1]! }
}

/* ---------------- fake DOM events ---------------- */

function pe(o: { id?: number; x?: number; y?: number; type?: string; button?: number } = {}) {
  const target = {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
    hasPointerCapture: vi.fn(() => true),
  }
  return {
    pointerId: o.id ?? 1,
    clientX: o.x ?? 100,
    clientY: o.y ?? 100,
    pointerType: o.type ?? 'touch',
    button: o.button ?? 0,
    preventDefault: vi.fn(),
    currentTarget: target,
  } as unknown as ReactPointerEvent<HTMLElement>
}
const click = (detail: number) => ({ detail, preventDefault: vi.fn() }) as unknown as ReactMouseEvent<HTMLElement>
const key = (k: string) => ({ key: k, preventDefault: vi.fn() }) as unknown as ReactKeyboardEvent<HTMLElement>

/* ---------------- harness ---------------- */

let vibrateMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vibrateMock = vi.fn(() => true)
  Object.defineProperty(navigator, 'vibrate', { value: vibrateMock, configurable: true, writable: true })
})
afterEach(() => {
  vi.useRealTimers()
  Reflect.deleteProperty(navigator, 'vibrate')
})

function setup(extra: Partial<UseHoldToTalkOptions> = {}) {
  const f = makeFactory()
  const onResult = vi.fn<(t: string, alts: string[]) => void>()
  const onPartial = vi.fn<(t: string) => void>()
  const onError = vi.fn<(m: string, c: string) => void>()
  const hook = renderHook((props: Partial<UseHoldToTalkOptions>) =>
    useHoldToTalk({ lang: 'es-MX', onResult, onPartial, onError, createRecognizer: f.factory, ...extra, ...props }),
  )
  return { ...f, onResult, onPartial, onError, hook, get r() { return hook.result.current } }
}

describe('useHoldToTalk — hold', () => {
  it('press-and-hold listens, release stops and delivers', () => {
    const t = setup()
    expect(t.r.supported).toBe(true)
    expect(t.r.mode).toBe('idle')

    const down = pe()
    act(() => t.r.bind.onPointerDown(down))
    expect(down.preventDefault).toHaveBeenCalled()
    expect(t.r.mode).toBe('hold')
    expect(t.r.listening).toBe(true)
    expect(t.r.bind['aria-pressed']).toBe(true)
    expect(t.sessions).toHaveLength(1)
    expect(t.last().started).toBe(1)
    expect(t.last().opts.lang).toBe('es-MX')
    expect(vibrateMock).toHaveBeenCalledTimes(1) // haptic tick on start

    act(() => t.last().partial('ochenta por'))
    expect(t.r.transcript).toBe('ochenta por')
    expect(t.onPartial).toHaveBeenLastCalledWith('ochenta por')

    act(() => vi.advanceTimersByTime(800))
    act(() => t.r.bind.onPointerUp(pe()))
    expect(t.r.mode).toBe('stopping')
    expect(t.r.processing).toBe(true)
    expect(t.r.listening).toBe(false)
    expect(t.last().stopped).toBe(1)
    expect(vibrateMock).toHaveBeenCalledTimes(2) // haptic tick on stop

    act(() => {
      t.last().final('80 por 10', ['80 por 10', '80 por 2'])
      t.last().end()
    })
    expect(t.onResult).toHaveBeenCalledTimes(1)
    expect(t.onResult).toHaveBeenCalledWith('80 por 10', ['80 por 10', '80 por 2'])
    expect(t.r.mode).toBe('idle')
    expect(t.r.transcript).toBe('80 por 10')
    expect(t.r.error).toBeNull()
  })

  it('joins pieces when the engine stops on a pause while still holding', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(600))
    act(() => {
      t.last().final('80 kilos')
      t.last().end() // engine stopped by itself, finger still down
    })
    expect(t.onResult).not.toHaveBeenCalled()
    expect(t.sessions).toHaveLength(2) // restarted
    expect(t.r.mode).toBe('hold')
    act(() => t.last().partial('10 reps'))
    expect(t.r.transcript).toBe('80 kilos 10 reps')
    act(() => vi.advanceTimersByTime(500))
    act(() => t.r.bind.onPointerUp(pe()))
    act(() => {
      t.last().final('10 reps')
      t.last().end()
    })
    expect(t.onResult).toHaveBeenCalledWith('80 kilos 10 reps', ['80 kilos 10 reps'])
  })

  it('ignores a second pointerdown while listening (no double start)', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe({ id: 1 })))
    act(() => t.r.bind.onPointerDown(pe({ id: 2 })))
    expect(t.sessions).toHaveLength(1)
    expect(t.last().started).toBe(1)
  })

  it('ignores non-primary mouse buttons', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe({ type: 'mouse', button: 2 })))
    expect(t.r.mode).toBe('idle')
    expect(t.sessions).toHaveLength(0)
  })

  it('slide away > 80 px cancels and discards', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe({ x: 100, y: 100 })))
    act(() => t.last().partial('ochenta'))
    act(() => t.r.bind.onPointerMove(pe({ x: 60, y: 100 })))
    expect(t.r.cancelProgress).toBe(0.5)
    expect(t.r.mode).toBe('hold')
    act(() => t.r.bind.onPointerMove(pe({ x: 10, y: 100 })))
    expect(t.r.mode).toBe('idle')
    expect(t.last().aborted).toBe(1)
    expect(t.r.transcript).toBe('')
    expect(t.r.cancelProgress).toBe(0)
    act(() => t.r.bind.onPointerUp(pe()))
    act(() => {
      t.last().final('80 por 10') // late engine events are ignored
      t.last().end()
    })
    expect(t.onResult).not.toHaveBeenCalled()
    expect(t.r.error).toBeNull()
  })

  it('pointercancel during hold still delivers what was heard', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(100))
    act(() => t.r.bind.onPointerCancel(pe()))
    expect(t.r.mode).toBe('stopping')
    act(() => {
      t.last().final('doce')
      t.last().end()
    })
    expect(t.onResult).toHaveBeenCalledWith('doce', ['doce'])
  })
})

describe('useHoldToTalk — tap / toggle', () => {
  it('a quick tap switches to toggle mode and delivers on the first final', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(120))
    act(() => t.r.bind.onPointerUp(pe()))
    expect(t.r.mode).toBe('toggle')
    expect(t.r.listening).toBe(true)
    expect(t.last().stopped).toBe(0)
    act(() => {
      t.last().final('siguiente')
      t.last().end()
    })
    expect(t.onResult).toHaveBeenCalledWith('siguiente', ['siguiente'])
    expect(t.r.mode).toBe('idle')
    expect(t.sessions).toHaveLength(1) // no restart in toggle mode
  })

  it('a second tap stops toggle mode', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => t.r.bind.onPointerUp(pe()))
    expect(t.r.mode).toBe('toggle')
    act(() => t.last().partial('80 por 10'))
    act(() => t.r.bind.onPointerDown(pe()))
    expect(t.r.mode).toBe('stopping')
    expect(t.last().stopped).toBe(1)
    act(() => t.r.bind.onPointerUp(pe()))
    expect(t.r.mode).toBe('stopping')
    act(() => t.last().end())
    expect(t.onResult).toHaveBeenCalledWith('80 por 10', ['80 por 10'])
  })

  it('keyboard activation (click with detail 0) toggles; Escape cancels', () => {
    const t = setup()
    act(() => t.r.bind.onClick(click(1))) // pointer click: ignored (pointer events handle it)
    expect(t.r.mode).toBe('idle')
    act(() => t.r.bind.onClick(click(0)))
    expect(t.r.mode).toBe('toggle')
    act(() => t.r.bind.onClick(click(0)))
    expect(t.r.mode).toBe('stopping')
    act(() => t.last().end())
    expect(t.r.mode).toBe('idle')

    act(() => t.r.bind.onClick(click(0)))
    const esc = key('Escape')
    act(() => t.r.bind.onKeyDown(esc))
    expect(esc.preventDefault).toHaveBeenCalled()
    expect(t.r.mode).toBe('idle')
  })

  it('imperative start / stop / cancel', () => {
    const t = setup()
    act(() => t.r.start())
    expect(t.r.mode).toBe('toggle')
    act(() => t.r.stop())
    expect(t.r.mode).toBe('stopping')
    act(() => {
      t.last().final('igual')
      t.last().end()
    })
    expect(t.onResult).toHaveBeenCalledWith('igual', ['igual'])
    act(() => t.r.start())
    act(() => t.r.cancel())
    expect(t.r.mode).toBe('idle')
    expect(t.onResult).toHaveBeenCalledTimes(1)
  })
})

describe('useHoldToTalk — errors & safety', () => {
  it('permission denied → Spanish error, no restart, onError called', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(600))
    act(() => {
      t.last().error('not-allowed')
      t.last().end()
    })
    expect(t.sessions).toHaveLength(1)
    expect(t.r.mode).toBe('idle')
    expect(t.r.error).toBe('Permite el micrófono para dictar tus series')
    expect(t.onError).toHaveBeenCalledWith('Permite el micrófono para dictar tus series', 'not-allowed')
    expect(t.onResult).not.toHaveBeenCalled()
    act(() => t.r.clearError())
    expect(t.r.error).toBeNull()
  })

  it('nothing heard → "No te escuché"', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(600))
    act(() => t.r.bind.onPointerUp(pe()))
    act(() => t.last().end())
    expect(t.r.error).toBe('No te escuché, intenta de nuevo')
    expect(t.onResult).not.toHaveBeenCalled()
  })

  it('error clears on the next attempt', () => {
    const t = setup()
    act(() => t.r.start())
    act(() => t.last().end())
    expect(t.r.error).not.toBeNull()
    act(() => t.r.start())
    expect(t.r.error).toBeNull()
  })

  it('unsupported → error message, no recognizer', () => {
    const t = setup({ supported: false })
    expect(t.r.supported).toBe(false)
    act(() => t.r.bind.onPointerDown(pe()))
    expect(t.r.mode).toBe('idle')
    expect(t.sessions).toHaveLength(0)
    expect(t.r.error).toBe('Tu navegador no permite dictar. Escribe tu serie')
  })

  it('unmount while listening aborts and swallows late events', () => {
    const t = setup()
    act(() => t.r.bind.onPointerDown(pe()))
    const s = t.last()
    t.hook.unmount()
    expect(s.aborted).toBe(1)
    expect(() => {
      s.final('80 por 10')
      s.end()
    }).not.toThrow()
    expect(t.onResult).not.toHaveBeenCalled()
  })

  it('caps listening time', () => {
    const t = setup({ maxListenMs: 5000 })
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(5001))
    expect(t.r.mode).toBe('stopping')
    expect(t.last().stopped).toBe(1)
  })

  it('haptics can be disabled', () => {
    const t = setup({ haptics: false })
    act(() => t.r.bind.onPointerDown(pe()))
    act(() => vi.advanceTimersByTime(600))
    act(() => t.r.bind.onPointerUp(pe()))
    expect(vibrateMock).not.toHaveBeenCalled()
  })

  it('prevents the long-press context menu and exposes no-select styles', () => {
    const t = setup()
    const e = click(1)
    t.r.bind.onContextMenu(e)
    expect(e.preventDefault).toHaveBeenCalled()
    expect(t.r.bind.style).toMatchObject({ touchAction: 'none', userSelect: 'none', WebkitTouchCallout: 'none' })
    expect(t.r.bind.draggable).toBe(false)
  })

  it('a recognizer factory that throws is reported, not crashed', () => {
    const t = setup({
      createRecognizer: () => {
        throw new Error('no engine')
      },
    })
    act(() => t.r.bind.onPointerDown(pe()))
    expect(t.r.mode).toBe('idle')
    expect(t.r.error).toBe('No se pudo usar el micrófono, intenta de nuevo')
  })
})
