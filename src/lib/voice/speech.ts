/**
 * Web Speech API (SpeechRecognition) wrapper.
 *
 * One `start()` = one engine session. While it runs you get `onPartial(text)`
 * with the live transcript; when it ends you get exactly one `onFinal(text)`
 * (if anything was heard) followed by exactly one `onEnd()`.
 *
 * Quirks handled
 * - `webkitSpeechRecognition` prefix (Safari, older Chrome).
 * - A fresh engine object per session (Safari misbehaves when reusing one).
 * - iOS/Safari may deliver the final result only after `stop()`, or never mark a
 *   result as final, or never fire `onend`: after `stop()` we wait up to
 *   `finalTimeoutMs` (1500 ms) for `onend`, then fall back to the last interim
 *   transcript so nothing the user said is lost.
 * - Results are rebuilt from the full result list on every event (robust to
 *   engines that resend previous results).
 * - Calling `start()` twice is a no-op; engine exceptions are mapped to errors.
 */

export type SpeechErrorCode =
  | 'not-allowed'
  | 'service-not-allowed'
  | 'no-speech'
  | 'audio-capture'
  | 'network'
  | 'aborted'
  | 'language-not-supported'
  | 'bad-grammar'
  | 'unsupported'
  | 'unknown'

export interface SpeechError {
  code: SpeechErrorCode
  /** Spanish, user-facing. Empty for 'aborted' (silent). */
  message: string
  /** The engine's own error string, for logs. */
  raw?: string
}

const MESSAGES: Record<SpeechErrorCode, string> = {
  'not-allowed': 'Permite el micrófono para dictar tus series',
  'service-not-allowed': 'Activa el dictado del teléfono para usar la voz',
  'no-speech': 'No te escuché, intenta de nuevo',
  'audio-capture': 'No encontramos el micrófono. Revisa que otra app no lo esté usando',
  network: 'Sin conexión: el dictado necesita internet',
  aborted: '',
  'language-not-supported': 'Tu navegador no reconoce este idioma. Cámbialo en Perfil',
  'bad-grammar': 'No pudimos procesar el audio, intenta de nuevo',
  unsupported: 'Tu navegador no permite dictar. Escribe tu serie',
  unknown: 'No se pudo usar el micrófono, intenta de nuevo',
}

const KNOWN_CODES = new Set<string>(Object.keys(MESSAGES))

/** Normalize an engine error string / DOMException name into our code. */
export function toSpeechErrorCode(raw: string | undefined | null): SpeechErrorCode {
  const r = (raw ?? '').trim()
  if (KNOWN_CODES.has(r)) return r as SpeechErrorCode
  switch (r) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'permission-denied':
      return 'not-allowed'
    case 'NotFoundError':
    case 'NotReadableError':
      return 'audio-capture'
    case 'AbortError':
      return 'aborted'
    case 'NotSupportedError':
      return 'unsupported'
    default:
      return 'unknown'
  }
}

/** Spanish message for an error code, or null when it must stay silent ('aborted'). */
export function speechErrorMessage(code: string): string | null {
  const c = toSpeechErrorCode(code)
  return c === 'aborted' ? null : MESSAGES[c]
}

export function toSpeechError(raw: string | undefined | null): SpeechError {
  const code = toSpeechErrorCode(raw)
  return { code, message: MESSAGES[code], raw: raw ?? undefined }
}

/** Errors after which retrying right away is pointless. */
export function isFatalSpeechError(code: SpeechErrorCode): boolean {
  return (
    code === 'not-allowed' ||
    code === 'service-not-allowed' ||
    code === 'audio-capture' ||
    code === 'network' ||
    code === 'language-not-supported' ||
    code === 'unsupported'
  )
}

/* ---------------- minimal engine typings (not all in lib.dom) ---------------- */

export interface RecognitionAlternativeLike {
  readonly transcript: string
  readonly confidence: number
}
export interface RecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  readonly [index: number]: RecognitionAlternativeLike | undefined
}
export interface RecognitionResultListLike {
  readonly length: number
  readonly [index: number]: RecognitionResultLike | undefined
}
export interface RecognitionEventLike {
  readonly resultIndex?: number
  readonly results: RecognitionResultListLike
}
export interface RecognitionErrorEventLike {
  readonly error: string
  readonly message?: string
}
export interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onstart: ((ev: unknown) => void) | null
  onresult: ((ev: RecognitionEventLike) => void) | null
  onerror: ((ev: RecognitionErrorEventLike) => void) | null
  onend: ((ev: unknown) => void) | null
  start(): void
  stop(): void
  abort(): void
}
export type SpeechRecognitionCtorLike = new () => SpeechRecognitionLike

/** The browser's SpeechRecognition constructor (prefixed or not), or null. */
export function getSpeechRecognitionCtor(): SpeechRecognitionCtorLike | null {
  if (typeof globalThis === 'undefined') return null
  const g = globalThis as unknown as {
    SpeechRecognition?: SpeechRecognitionCtorLike
    webkitSpeechRecognition?: SpeechRecognitionCtorLike
  }
  return g.SpeechRecognition ?? g.webkitSpeechRecognition ?? null
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null
}

/* ---------------- recognizer ---------------- */

export interface RecognizerOptions {
  /** BCP-47, e.g. 'es-CO'. */
  lang: string
  /** Live transcript (final-so-far + interim). */
  onPartial?: (text: string) => void
  /** Called once per session with the final transcript (if anything was heard). */
  onFinal?: (text: string, alternatives: string[]) => void
  onError?: (error: SpeechError) => void
  /** Called once per session, after onFinal/onError. */
  onEnd?: () => void
  onStart?: () => void
  /** Choose among alternatives (e.g. the one that parses best). Default: first. */
  choose?: (alternatives: string[]) => string
  /** Default 3. */
  maxAlternatives?: number
  /** How long to wait after stop() for the engine's final result. Default 1500 ms. */
  finalTimeoutMs?: number
  /** Inject an engine (tests / custom engines). Default: the browser's. */
  ctor?: SpeechRecognitionCtorLike | null
}

export interface Recognizer {
  /** Start a session. Returns false if it could not start (error already reported). */
  start(): boolean
  /** Stop listening and deliver what was heard. */
  stop(): void
  /** Stop immediately and discard everything (no onFinal). */
  abort(): void
  readonly active: boolean
}

type Phase = 'idle' | 'listening' | 'stopping'

export function createRecognizer(opts: RecognizerOptions): Recognizer {
  const Ctor = opts.ctor === undefined ? getSpeechRecognitionCtor() : opts.ctor
  const finalTimeoutMs = opts.finalTimeoutMs ?? 1500
  const maxAlternatives = opts.maxAlternatives ?? 3

  let phase: Phase = 'idle'
  let engine: SpeechRecognitionLike | null = null
  let session = 0
  let finalText = ''
  let finalAlts: string[] = []
  let lastPartial = ''
  let hadError: SpeechErrorCode | null = null
  let stopTimer: ReturnType<typeof setTimeout> | null = null

  const clearStopTimer = () => {
    if (stopTimer !== null) {
      clearTimeout(stopTimer)
      stopTimer = null
    }
  }

  const detach = (e: SpeechRecognitionLike | null) => {
    if (!e) return
    e.onstart = null
    e.onresult = null
    e.onerror = null
    e.onend = null
  }

  const finish = (deliver: boolean) => {
    if (phase === 'idle') return
    clearStopTimer()
    const e = engine
    engine = null
    phase = 'idle'
    session++
    detach(e)
    if (deliver) {
      const text = (finalText || lastPartial).replace(/\s+/g, ' ').trim()
      if (text) {
        const alts = finalText && finalAlts.length ? finalAlts : [text]
        let chosen = text
        if (opts.choose && alts.length > 1) {
          try {
            chosen = (opts.choose(alts) || text).trim() || text
          } catch {
            chosen = text
          }
        }
        safe(() => opts.onFinal?.(chosen, alts))
      } else if (hadError === null) {
        // engine ended without hearing anything and without saying why
        safe(() => opts.onError?.(toSpeechError('no-speech')))
      }
    }
    safe(() => opts.onEnd?.())
  }

  const handleResult = (ev: RecognitionEventLike) => {
    const list = ev.results
    const finals: RecognitionResultLike[] = []
    let interim = ''
    for (let i = 0; i < list.length; i++) {
      const r = list[i]
      if (!r) continue
      const t = r[0]?.transcript ?? ''
      if (r.isFinal) finals.push(r)
      else interim += ` ${t}`
    }
    if (finals.length) {
      finalText = finals.map((r) => r[0]?.transcript ?? '').join(' ').replace(/\s+/g, ' ').trim()
      // alternative k = earlier finals' best + last final's k-th guess
      const last = finals[finals.length - 1]!
      const head = finals
        .slice(0, -1)
        .map((r) => r[0]?.transcript ?? '')
        .join(' ')
      const alts: string[] = []
      for (let k = 0; k < Math.min(last.length, maxAlternatives); k++) {
        const a = last[k]?.transcript
        if (a === undefined) continue
        const full = `${head} ${a}`.replace(/\s+/g, ' ').trim()
        if (full && !alts.includes(full)) alts.push(full)
      }
      finalAlts = alts.length ? alts : finalText ? [finalText] : []
    }
    const partial = `${finalText} ${interim}`.replace(/\s+/g, ' ').trim()
    if (partial) {
      lastPartial = partial
      safe(() => opts.onPartial?.(partial))
    }
  }

  const start = (): boolean => {
    if (phase !== 'idle') return false
    if (!Ctor) {
      safe(() => opts.onError?.(toSpeechError('unsupported')))
      safe(() => opts.onEnd?.())
      return false
    }
    finalText = ''
    finalAlts = []
    lastPartial = ''
    hadError = null
    let e: SpeechRecognitionLike
    try {
      e = new Ctor()
      e.lang = opts.lang
      e.continuous = false
      e.interimResults = true
      e.maxAlternatives = maxAlternatives
    } catch {
      safe(() => opts.onError?.(toSpeechError('unsupported')))
      safe(() => opts.onEnd?.())
      return false
    }
    const id = ++session
    const live = () => id === session
    e.onstart = () => {
      if (live()) safe(() => opts.onStart?.())
    }
    e.onresult = (ev) => {
      if (live()) handleResult(ev)
    }
    e.onerror = (ev) => {
      if (!live()) return
      const err = toSpeechError(ev?.error)
      hadError = err.code
      // with text in hand, a late 'no-speech'/'aborted' is not worth showing
      if (err.code === 'aborted') return
      if (err.code === 'no-speech' && (finalText || lastPartial)) return
      safe(() => opts.onError?.(err))
    }
    e.onend = () => {
      if (live()) finish(true)
    }
    engine = e
    phase = 'listening'
    try {
      e.start()
    } catch (err) {
      const name = err instanceof Error ? err.name : typeof err === 'string' ? err : 'unknown'
      // InvalidStateError: already started by someone else — treat as running.
      if (name === 'InvalidStateError') return true
      engine = null
      phase = 'idle'
      session++
      detach(e)
      const se = toSpeechError(name)
      safe(() => opts.onError?.(se))
      safe(() => opts.onEnd?.())
      return false
    }
    return true
  }

  const stop = () => {
    if (phase !== 'listening') return
    phase = 'stopping'
    const e = engine
    try {
      e?.stop()
    } catch {
      /* engine already stopped */
    }
    clearStopTimer()
    stopTimer = setTimeout(() => {
      // iOS: onend never came. Release the mic and deliver what we have.
      const pending = engine
      finish(true)
      try {
        pending?.abort()
      } catch {
        /* ignore */
      }
    }, finalTimeoutMs)
  }

  const abort = () => {
    if (phase === 'idle') return
    const e = engine
    finish(false)
    try {
      e?.abort()
    } catch {
      /* ignore */
    }
  }

  return {
    start,
    stop,
    abort,
    get active() {
      return phase !== 'idle'
    },
  }
}

function safe(fn: () => void): void {
  try {
    fn()
  } catch (err) {
    // a consumer callback must never break the recognizer state machine
    if (typeof console !== 'undefined') console.error('[voice]', err)
  }
}
