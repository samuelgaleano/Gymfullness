import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createRecognizer,
  getSpeechRecognitionCtor,
  isFatalSpeechError,
  isSpeechRecognitionSupported,
  speechErrorMessage,
  toSpeechError,
  toSpeechErrorCode,
  type RecognitionErrorEventLike,
  type RecognitionEventLike,
  type RecognitionResultLike,
  type SpeechRecognitionLike,
} from './speech'

/* ---------------- fake engine ---------------- */

interface FakeResult {
  final: boolean
  alts: string[]
}

function makeResults(list: FakeResult[]): RecognitionEventLike {
  const results: RecognitionResultLike[] = list.map((r) =>
    Object.assign(
      r.alts.map((t, i) => ({ transcript: t, confidence: 0.9 - i * 0.1 })),
      { isFinal: r.final },
    ),
  )
  return { resultIndex: 0, results }
}

class FakeRecognition implements SpeechRecognitionLike {
  static instances: FakeRecognition[] = []
  static throwOnStart: string | null = null
  lang = ''
  continuous = true
  interimResults = false
  maxAlternatives = 1
  onstart: ((ev: unknown) => void) | null = null
  onresult: ((ev: RecognitionEventLike) => void) | null = null
  onerror: ((ev: RecognitionErrorEventLike) => void) | null = null
  onend: ((ev: unknown) => void) | null = null
  startCalls = 0
  stopCalls = 0
  abortCalls = 0
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start() {
    this.startCalls++
    if (FakeRecognition.throwOnStart) {
      const e = new Error('boom')
      e.name = FakeRecognition.throwOnStart
      throw e
    }
    this.onstart?.({})
  }
  stop() {
    this.stopCalls++
  }
  abort() {
    this.abortCalls++
  }
  // test drivers
  emit(list: FakeResult[]) {
    this.onresult?.(makeResults(list))
  }
  fail(code: string) {
    this.onerror?.({ error: code })
  }
  end() {
    this.onend?.({})
  }
}

const last = () => FakeRecognition.instances[FakeRecognition.instances.length - 1]!

function setup(extra: Partial<Parameters<typeof createRecognizer>[0]> = {}) {
  const onPartial = vi.fn<(t: string) => void>()
  const onFinal = vi.fn<(t: string, alts: string[]) => void>()
  const onError = vi.fn()
  const onEnd = vi.fn()
  const rec = createRecognizer({ lang: 'es-CO', onPartial, onFinal, onError, onEnd, ctor: FakeRecognition, ...extra })
  return { rec, onPartial, onFinal, onError, onEnd }
}

beforeEach(() => {
  FakeRecognition.instances = []
  FakeRecognition.throwOnStart = null
})
afterEach(() => {
  vi.useRealTimers()
})

/* ---------------- error mapping ---------------- */

describe('error mapping', () => {
  it.each([
    ['not-allowed', 'Permite el micrófono para dictar tus series'],
    ['no-speech', 'No te escuché, intenta de nuevo'],
    ['network', 'Sin conexión: el dictado necesita internet'],
    ['audio-capture', 'No encontramos el micrófono. Revisa que otra app no lo esté usando'],
    ['service-not-allowed', 'Activa el dictado del teléfono para usar la voz'],
    ['language-not-supported', 'Tu navegador no reconoce este idioma. Cámbialo en Perfil'],
    ['NotAllowedError', 'Permite el micrófono para dictar tus series'],
    ['NotFoundError', 'No encontramos el micrófono. Revisa que otra app no lo esté usando'],
    ['something-new', 'No se pudo usar el micrófono, intenta de nuevo'],
  ])('%s → %s', (code, msg) => {
    expect(speechErrorMessage(code)).toBe(msg)
    expect(toSpeechError(code).message).toBe(msg)
  })

  it('aborted is silent', () => {
    expect(speechErrorMessage('aborted')).toBeNull()
    expect(speechErrorMessage('AbortError')).toBeNull()
    expect(toSpeechError('aborted').message).toBe('')
  })

  it('codes and fatality', () => {
    expect(toSpeechErrorCode(undefined)).toBe('unknown')
    expect(toSpeechErrorCode('SecurityError')).toBe('not-allowed')
    expect(isFatalSpeechError('not-allowed')).toBe(true)
    expect(isFatalSpeechError('network')).toBe(true)
    expect(isFatalSpeechError('no-speech')).toBe(false)
    expect(isFatalSpeechError('aborted')).toBe(false)
  })
})

describe('feature detection', () => {
  it('detects the webkit prefix', () => {
    const g = globalThis as unknown as { webkitSpeechRecognition?: unknown }
    expect(isSpeechRecognitionSupported()).toBe(false)
    g.webkitSpeechRecognition = FakeRecognition
    try {
      expect(isSpeechRecognitionSupported()).toBe(true)
      expect(getSpeechRecognitionCtor()).toBe(FakeRecognition)
    } finally {
      delete g.webkitSpeechRecognition
    }
  })
})

/* ---------------- recognizer ---------------- */

describe('createRecognizer', () => {
  it('configures the engine', () => {
    const { rec } = setup()
    expect(rec.start()).toBe(true)
    const e = last()
    expect(e.lang).toBe('es-CO')
    expect(e.continuous).toBe(false)
    expect(e.interimResults).toBe(true)
    expect(e.maxAlternatives).toBe(3)
    expect(rec.active).toBe(true)
  })

  it('streams partials and delivers one final at the end', () => {
    const { rec, onPartial, onFinal, onEnd } = setup()
    rec.start()
    const e = last()
    e.emit([{ final: false, alts: ['ochenta'] }])
    e.emit([{ final: false, alts: ['ochenta por'] }])
    e.emit([{ final: true, alts: ['80 por 10', '80 por 2'] }])
    expect(onPartial).toHaveBeenLastCalledWith('80 por 10')
    expect(onFinal).not.toHaveBeenCalled() // waits for onend (Safari may send more)
    e.end()
    expect(onFinal).toHaveBeenCalledTimes(1)
    expect(onFinal).toHaveBeenCalledWith('80 por 10', ['80 por 10', '80 por 2'])
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.active).toBe(false)
    e.end() // late duplicate events are ignored
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('joins several final results', () => {
    const { rec, onFinal } = setup()
    rec.start()
    last().emit([
      { final: true, alts: ['80 kilos'] },
      { final: true, alts: ['10 repeticiones', '10 repeticion'] },
    ])
    last().end()
    expect(onFinal).toHaveBeenCalledWith('80 kilos 10 repeticiones', ['80 kilos 10 repeticiones', '80 kilos 10 repeticion'])
  })

  it('lets a chooser pick the best alternative', () => {
    const choose = vi.fn((alts: string[]) => alts[1]!)
    const { rec, onFinal } = setup({ choose })
    rec.start()
    last().emit([{ final: true, alts: ['ochenta pro diez', '80 por 10'] }])
    last().end()
    expect(choose).toHaveBeenCalledWith(['ochenta pro diez', '80 por 10'])
    expect(onFinal).toHaveBeenCalledWith('80 por 10', ['ochenta pro diez', '80 por 10'])
  })

  it('iOS: no final and no onend after stop() → uses the last interim after the timeout', () => {
    vi.useFakeTimers()
    const { rec, onFinal, onEnd } = setup()
    rec.start()
    const e = last()
    e.emit([{ final: false, alts: ['80 por 10'] }])
    rec.stop()
    expect(e.stopCalls).toBe(1)
    vi.advanceTimersByTime(1400)
    expect(onFinal).not.toHaveBeenCalled()
    vi.advanceTimersByTime(200)
    expect(onFinal).toHaveBeenCalledWith('80 por 10', ['80 por 10'])
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(e.abortCalls).toBe(1) // mic released
    e.end() // a very late onend changes nothing
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('Safari: onend after stop() without a final → last interim is the final', () => {
    vi.useFakeTimers()
    const { rec, onFinal, onEnd } = setup()
    rec.start()
    last().emit([{ final: false, alts: ['doce'] }])
    rec.stop()
    last().end()
    expect(onFinal).toHaveBeenCalledWith('doce', ['doce'])
    expect(onEnd).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(5000)
    expect(onFinal).toHaveBeenCalledTimes(1)
  })

  it('final result arriving only after stop() is used', () => {
    const { rec, onFinal } = setup()
    rec.start()
    last().emit([{ final: false, alts: ['ochenta'] }])
    rec.stop()
    last().emit([{ final: true, alts: ['80 por 10'] }])
    last().end()
    expect(onFinal).toHaveBeenCalledWith('80 por 10', ['80 por 10'])
  })

  it.each([
    ['not-allowed', 'Permite el micrófono para dictar tus series'],
    ['network', 'Sin conexión: el dictado necesita internet'],
    ['no-speech', 'No te escuché, intenta de nuevo'],
    ['audio-capture', 'No encontramos el micrófono. Revisa que otra app no lo esté usando'],
  ])('engine error %s → onError + onEnd, no final', (code, message) => {
    const { rec, onFinal, onError, onEnd } = setup()
    rec.start()
    last().fail(code)
    last().end()
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code, message }))
    expect(onFinal).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('aborted errors are silent', () => {
    const { rec, onError, onEnd } = setup()
    rec.start()
    last().fail('aborted')
    last().end()
    expect(onError).not.toHaveBeenCalled()
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('a late no-speech after text is ignored and the text is delivered', () => {
    const { rec, onError, onFinal } = setup()
    rec.start()
    last().emit([{ final: false, alts: ['80 por 10'] }])
    last().fail('no-speech')
    last().end()
    expect(onError).not.toHaveBeenCalled()
    expect(onFinal).toHaveBeenCalledWith('80 por 10', ['80 por 10'])
  })

  it('ending with nothing heard reports no-speech', () => {
    const { rec, onError, onFinal } = setup()
    rec.start()
    last().end()
    expect(onFinal).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'no-speech' }))
  })

  it('guards double start', () => {
    const { rec } = setup()
    expect(rec.start()).toBe(true)
    expect(rec.start()).toBe(false)
    expect(FakeRecognition.instances).toHaveLength(1)
    expect(last().startCalls).toBe(1)
  })

  it('can run several sessions with a fresh engine each', () => {
    const { rec, onFinal } = setup()
    rec.start()
    last().emit([{ final: true, alts: ['uno'] }])
    last().end()
    rec.start()
    last().emit([{ final: true, alts: ['dos'] }])
    last().end()
    expect(FakeRecognition.instances).toHaveLength(2)
    expect(onFinal.mock.calls.map((c) => c[0])).toEqual(['uno', 'dos'])
  })

  it('abort discards everything and ignores late events', () => {
    const { rec, onFinal, onEnd, onPartial } = setup()
    rec.start()
    const e = last()
    e.emit([{ final: false, alts: ['ochenta'] }])
    rec.abort()
    expect(e.abortCalls).toBe(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    e.emit([{ final: true, alts: ['80 por 10'] }])
    e.end()
    expect(onFinal).not.toHaveBeenCalled()
    expect(onPartial).toHaveBeenCalledTimes(1)
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.active).toBe(false)
  })

  it('stop/abort when idle are no-ops', () => {
    const { rec, onEnd } = setup()
    rec.stop()
    rec.abort()
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('unsupported browser → onError(unsupported) + onEnd', () => {
    const { rec, onError, onEnd } = setup({ ctor: null })
    expect(rec.start()).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'unsupported' }))
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('maps exceptions thrown by start()', () => {
    FakeRecognition.throwOnStart = 'NotAllowedError'
    const { rec, onError, onEnd } = setup()
    expect(rec.start()).toBe(false)
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'not-allowed', message: 'Permite el micrófono para dictar tus series' }))
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.active).toBe(false)
  })

  it('a throwing consumer callback does not break the state machine', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onEnd = vi.fn()
    const rec = createRecognizer({
      lang: 'es',
      ctor: FakeRecognition,
      onPartial: () => {
        throw new Error('ui bug')
      },
      onEnd,
    })
    rec.start()
    last().emit([{ final: false, alts: ['hola'] }])
    last().end()
    expect(onEnd).toHaveBeenCalledTimes(1)
    expect(rec.active).toBe(false)
    spy.mockRestore()
  })
})
