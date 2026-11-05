/**
 * WhatsApp-style mic button: press-and-hold to talk, release to send.
 *
 *   const mic = useHoldToTalk({ lang: settings.speechLang, onResult: (t) => handle(parseUtterance(t, ctx)) })
 *   <button {...mic.bind} aria-label="Dictar serie" className={mic.listening ? 'on' : ''}>…</button>
 *
 * Gestures
 * - Hold (≥ 350 ms) → listens while pressed; release stops and delivers.
 *   If the engine stops by itself while you are still holding (a pause), it is
 *   restarted and the pieces are joined, so "80 kilos … 10 reps" is not cut.
 * - Quick tap (< 350 ms) → toggle mode: keeps listening until a final result or
 *   the next tap. Keyboard (Enter/Space) also toggles; Escape cancels.
 * - Slide the finger > 80 px away → cancel (nothing is delivered).
 *
 * Never loses speech: on release/stop, whatever was heard (final or, on iOS, the
 * last interim) is delivered. Guards double starts, unmounts and permission errors.
 * When unsupported, `supported` is false and the UI should show a text box instead
 * (don't spread `bind` then).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import {
  createRecognizer as defaultCreateRecognizer,
  isFatalSpeechError,
  isSpeechRecognitionSupported,
  toSpeechError,
  type Recognizer,
  type RecognizerOptions,
  type SpeechError,
} from './speech'
import { cancelSpeech } from './tts'
import { haptic, type HapticKind } from '../audio'

export type HoldToTalkMode = 'idle' | 'hold' | 'toggle' | 'stopping'

export interface UseHoldToTalkOptions {
  /** BCP-47, e.g. settings.speechLang. */
  lang: string
  /** Final text of the utterance (non-empty, trimmed). */
  onResult: (text: string, alternatives: string[]) => void
  /** Live transcript while listening. */
  onPartial?: (text: string) => void
  /** A user-facing (Spanish) error message is available (also in `error`). */
  onError?: (message: string, code: SpeechError['code']) => void
  /** Pick among engine alternatives (e.g. best-parsing one). */
  choose?: (alternatives: string[]) => string
  /** Vibration ticks on start/stop. Default true (mirror settings.vibration). */
  haptics?: boolean
  /** Press shorter than this = tap → toggle mode. Default 350 ms. */
  tapMs?: number
  /** Slide distance that cancels. Default 80 px. */
  cancelDistance?: number
  /** Safety cap per utterance. Default 30 s. */
  maxListenMs?: number
  /** Inject a recognizer factory (tests / custom engines). */
  createRecognizer?: (opts: RecognizerOptions) => Recognizer
  /** Override feature detection (tests). */
  supported?: boolean
}

export interface HoldToTalkBind {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void
  onContextMenu: (e: ReactMouseEvent<HTMLElement>) => void
  onClick: (e: ReactMouseEvent<HTMLElement>) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLElement>) => void
  'aria-pressed': boolean
  draggable: false
  style: CSSProperties
}

export interface HoldToTalk {
  supported: boolean
  /** Mic is open (hold or toggle). */
  listening: boolean
  /** Released, waiting for the engine's final words (≤ ~1.5 s). */
  processing: boolean
  mode: HoldToTalkMode
  /** Live transcript while listening; the last result afterwards. */
  transcript: string
  /** Spanish user-facing error, or null. */
  error: string | null
  /** 0..1 how close the slide is to cancelling (for "Desliza para cancelar" UI). */
  cancelProgress: number
  bind: HoldToTalkBind
  /** Start listening in toggle mode (e.g. from a keyboard shortcut). */
  start: () => void
  /** Stop and deliver what was heard. */
  stop: () => void
  /** Stop and discard. */
  cancel: () => void
  clearError: () => void
}

const MAX_RESTARTS = 5
const MIN_ENGINE_MS_FOR_RESTART = 300

const BIND_STYLE: CSSProperties = {
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  WebkitTouchCallout: 'none',
  WebkitTapHighlightColor: 'transparent',
}

interface Machine {
  mode: HoldToTalkMode
  rec: Recognizer | null
  /** gesture generation: callbacks from older generations are ignored */
  gen: number
  segments: string[]
  alts: string[]
  partial: string
  pointerId: number | null
  downAt: number
  x0: number
  y0: number
  ignoreUp: boolean
  restarts: number
  engineStartedAt: number
  stopRequested: boolean
  fatal: boolean
  lastError: SpeechError | null
  maxTimer: ReturnType<typeof setTimeout> | null
  mounted: boolean
  cancelProgress: number
}

export function useHoldToTalk(options: UseHoldToTalkOptions): HoldToTalk {
  const optsRef = useRef(options)
  optsRef.current = options

  const [supported] = useState<boolean>(
    () => options.supported ?? (options.createRecognizer ? true : isSpeechRecognitionSupported()),
  )
  const [mode, setMode] = useState<HoldToTalkMode>('idle')
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cancelProgress, setCancelProgress] = useState(0)

  const mRef = useRef<Machine>({
    mode: 'idle',
    rec: null,
    gen: 0,
    segments: [],
    alts: [],
    partial: '',
    pointerId: null,
    downAt: 0,
    x0: 0,
    y0: 0,
    ignoreUp: false,
    restarts: 0,
    engineStartedAt: 0,
    stopRequested: false,
    fatal: false,
    lastError: null,
    maxTimer: null,
    mounted: true,
    cancelProgress: 0,
  })

  const tick = useCallback((kind: HapticKind) => {
    if (optsRef.current.haptics !== false) haptic(kind)
  }, [])

  const actions = useMemo(() => {
    const m = mRef.current

    const setModeBoth = (next: HoldToTalkMode) => {
      m.mode = next
      if (m.mounted) setMode(next)
    }
    const setProgress = (p: number) => {
      if (p === m.cancelProgress) return
      m.cancelProgress = p
      if (m.mounted) setCancelProgress(p)
    }
    const clearMaxTimer = () => {
      if (m.maxTimer !== null) {
        clearTimeout(m.maxTimer)
        m.maxTimer = null
      }
    }
    const currentText = () => [...m.segments, m.partial].join(' ').replace(/\s+/g, ' ').trim()
    const publish = () => {
      const text = currentText()
      if (m.mounted) setTranscript(text)
      if (text) optsRef.current.onPartial?.(text)
    }
    const reportError = (err: SpeechError) => {
      if (!err.message) return
      if (m.mounted) setError(err.message)
      optsRef.current.onError?.(err.message, err.code)
    }

    const resetGesture = () => {
      clearMaxTimer()
      m.rec = null
      m.segments = []
      m.alts = []
      m.partial = ''
      m.restarts = 0
      m.stopRequested = false
      m.fatal = false
      m.lastError = null
    }

    const finalize = () => {
      const text = currentText()
      const alts = m.segments.length === 1 && !m.partial ? m.alts : text ? [text] : []
      const err = m.lastError
      m.gen++
      resetGesture()
      setModeBoth('idle')
      setProgress(0)
      if (text) {
        if (m.mounted) setTranscript(text)
        optsRef.current.onResult(text, alts.length ? alts : [text])
      } else {
        if (m.mounted) setTranscript('')
        reportError(err ?? toSpeechError('no-speech'))
      }
    }

    const startEngine = (gen: number) => {
      const factory = optsRef.current.createRecognizer ?? defaultCreateRecognizer
      const live = () => gen === m.gen
      let rec: Recognizer
      try {
        rec = factory({
          lang: optsRef.current.lang,
          choose: optsRef.current.choose,
          onPartial: (text) => {
            if (!live()) return
            m.partial = text
            publish()
          },
          onFinal: (text, alts) => {
            if (!live()) return
            m.segments.push(text)
            m.alts = alts
            m.partial = ''
            publish()
          },
          onError: (err) => {
            if (!live() || err.code === 'aborted') return
            m.lastError = err
            if (isFatalSpeechError(err.code)) m.fatal = true
          },
          onEnd: () => {
            if (!live()) return
            m.rec = null
            const longEnough = Date.now() - m.engineStartedAt >= MIN_ENGINE_MS_FOR_RESTART
            if (m.mode === 'hold' && !m.stopRequested && !m.fatal && m.restarts < MAX_RESTARTS && longEnough) {
              // engine stopped on a pause while the finger is still down: keep going
              m.restarts++
              if (m.lastError?.code === 'no-speech') m.lastError = null
              startEngine(gen)
              return
            }
            finalize()
          },
        })
      } catch {
        m.lastError = toSpeechError('unknown')
        finalize()
        return
      }
      m.rec = rec
      m.engineStartedAt = Date.now()
      rec.start()
    }

    const begin = (next: 'hold' | 'toggle'): boolean => {
      if (m.mode !== 'idle') return false
      if (!supported) {
        reportError(toSpeechError('unsupported'))
        return false
      }
      m.gen++
      resetGesture()
      setModeBoth(next)
      setProgress(0)
      if (m.mounted) {
        setError(null)
        setTranscript('')
      }
      cancelSpeech() // don't let announcements leak into the mic
      tick('tick')
      const gen = m.gen
      m.maxTimer = setTimeout(() => {
        if (gen === m.gen) stop()
      }, optsRef.current.maxListenMs ?? 30_000)
      startEngine(gen)
      return true
    }

    const stop = () => {
      if (m.mode !== 'hold' && m.mode !== 'toggle') return
      m.stopRequested = true
      setModeBoth('stopping')
      setProgress(0)
      tick('tick')
      if (m.rec) m.rec.stop()
      else finalize()
    }

    const cancel = () => {
      if (m.mode === 'idle') return
      m.gen++
      const rec = m.rec
      resetGesture()
      try {
        rec?.abort()
      } catch {
        /* ignore */
      }
      setModeBoth('idle')
      setProgress(0)
      if (m.mounted) setTranscript('')
      tick('warning')
    }

    const releaseCapture = (e: ReactPointerEvent<HTMLElement>) => {
      try {
        if (e.currentTarget?.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
      } catch {
        /* ignore */
      }
    }

    const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return
      e.preventDefault() // no focus steal, no text selection, no emulated mouse events
      if (m.mode === 'toggle') {
        // second tap ends a toggle session
        m.pointerId = e.pointerId
        m.ignoreUp = true
        stop()
        return
      }
      if (m.mode !== 'idle') return
      try {
        e.currentTarget?.setPointerCapture?.(e.pointerId)
      } catch {
        /* ignore */
      }
      m.pointerId = e.pointerId
      m.downAt = Date.now()
      m.x0 = e.clientX
      m.y0 = e.clientY
      m.ignoreUp = false
      if (!begin('hold')) m.ignoreUp = true
    }

    const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
      if (m.mode !== 'hold' || e.pointerId !== m.pointerId) return
      const limit = optsRef.current.cancelDistance ?? 80
      const d = Math.hypot(e.clientX - m.x0, e.clientY - m.y0)
      setProgress(Math.round(Math.min(1, d / limit) * 10) / 10)
      if (d > limit) {
        m.ignoreUp = true
        cancel()
      }
    }

    const endPointer = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      if (m.pointerId !== null && e.pointerId !== m.pointerId) return
      releaseCapture(e)
      m.pointerId = null
      setProgress(0)
      if (m.ignoreUp) {
        m.ignoreUp = false
        return
      }
      if (m.mode !== 'hold') return
      const quick = Date.now() - m.downAt < (optsRef.current.tapMs ?? 350)
      if (quick && !cancelled) {
        setModeBoth('toggle') // tap → keep listening until a result or the next tap
        return
      }
      stop() // release (or the OS stole the gesture): deliver what was heard
    }

    const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => endPointer(e, false)
    const onPointerCancel = (e: ReactPointerEvent<HTMLElement>) => endPointer(e, true)

    const onContextMenu = (e: ReactMouseEvent<HTMLElement>) => {
      e.preventDefault()
    }

    const onClick = (e: ReactMouseEvent<HTMLElement>) => {
      // pointer clicks are handled by pointer events; detail === 0 = keyboard / AT activation
      if (e.detail !== 0) return
      if (m.mode === 'idle') begin('toggle')
      else if (m.mode === 'hold' || m.mode === 'toggle') stop()
    }

    const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
      if (e.key === 'Escape' && m.mode !== 'idle') {
        e.preventDefault()
        cancel()
      }
    }

    const dispose = () => {
      m.mounted = false
      m.gen++
      const rec = m.rec
      resetGesture()
      m.mode = 'idle'
      try {
        rec?.abort()
      } catch {
        /* ignore */
      }
    }

    return {
      begin,
      stop,
      cancel,
      dispose,
      handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onContextMenu, onClick, onKeyDown },
    }
  }, [supported, tick])

  useEffect(() => {
    const m = mRef.current
    m.mounted = true
    return () => actions.dispose()
  }, [actions])

  const listening = mode === 'hold' || mode === 'toggle'

  const bind = useMemo<HoldToTalkBind>(
    () => ({ ...actions.handlers, 'aria-pressed': listening, draggable: false, style: BIND_STYLE }),
    [actions, listening],
  )

  const start = useCallback(() => {
    actions.begin('toggle')
  }, [actions])
  const clearError = useCallback(() => setError(null), [])

  return {
    supported,
    listening,
    processing: mode === 'stopping',
    mode,
    transcript,
    error,
    cancelProgress,
    bind,
    start,
    stop: actions.stop,
    cancel: actions.cancel,
    clearError,
  }
}
