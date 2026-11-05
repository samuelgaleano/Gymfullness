import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __resetTTSForTests, cancelSpeech, isSpeaking, isTTSSupported, pickVoice, primeSpeech, scoreVoice, speak, type VoiceLike } from './tts'

const v = (name: string, lang: string, localService = true, isDefault = false): VoiceLike => ({ name, lang, localService, default: isDefault })

const VOICES: VoiceLike[] = [
  v('Samantha', 'en-US', true, true),
  v('Google US English', 'en-US', false),
  v('Mónica', 'es-ES'),
  v('Paulina', 'es-MX'),
  v('Paulina (Enhanced)', 'es-MX'),
  v('Google español de Estados Unidos', 'es-US', false),
  v('Eddy (Spanish (Mexico))', 'es-MX'),
  v('Grandma (Spanish (Spain))', 'es-ES'),
]

describe('voice selection', () => {
  it('prefers an enhanced LatAm voice for es-CO', () => {
    expect(pickVoice(VOICES, 'es-CO')?.name).toBe('Paulina (Enhanced)')
  })

  it('prefers the exact Spain voice for es-ES', () => {
    expect(pickVoice(VOICES, 'es-ES')?.name).toBe('Mónica')
  })

  it('accepts underscores and casing in lang tags', () => {
    expect(pickVoice([v('Jorge', 'es_MX')], 'ES-mx')?.name).toBe('Jorge')
  })

  it('never picks novelty voices over normal ones', () => {
    const list = [v('Eddy (Spanish (Mexico))', 'es-MX'), v('Juan', 'es-MX')]
    expect(pickVoice(list, 'es-MX')?.name).toBe('Juan')
    expect(scoreVoice(list[0]!, 'es-MX')).toBeLessThan(scoreVoice(list[1]!, 'es-MX'))
  })

  it('returns null when no voice speaks the language', () => {
    expect(pickVoice([v('Samantha', 'en-US')], 'es-CO')).toBeNull()
    expect(pickVoice([], 'es-CO')).toBeNull()
  })

  it('works for English too', () => {
    expect(pickVoice(VOICES, 'en-US')?.lang).toBe('en-US')
  })
})

/* ---------------- fake speechSynthesis ---------------- */

class FakeUtterance {
  text: string
  lang = ''
  voice: unknown = null
  rate = 1
  pitch = 1
  volume = 1
  onend: (() => void) | null = null
  onerror: (() => void) | null = null
  constructor(text: string) {
    this.text = text
  }
}

function installSynth(voices: VoiceLike[] = VOICES) {
  const spoken: FakeUtterance[] = []
  const synth = {
    speaking: false,
    pending: false,
    paused: false,
    getVoices: vi.fn(() => voices),
    speak: vi.fn((u: FakeUtterance) => {
      spoken.push(u)
      synth.speaking = true
    }),
    cancel: vi.fn(() => {
      synth.speaking = false
    }),
    resume: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true, writable: true })
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { value: FakeUtterance, configurable: true, writable: true })
  return { synth, spoken }
}

function uninstallSynth() {
  Reflect.deleteProperty(window, 'speechSynthesis')
  Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance')
}

beforeEach(() => {
  __resetTTSForTests()
})
afterEach(() => {
  uninstallSynth()
  vi.useRealTimers()
})

describe('speak', () => {
  it('is a no-op without speechSynthesis', async () => {
    expect(isTTSSupported()).toBe(false)
    await expect(speak('Descanso terminado', { lang: 'es-CO' })).resolves.toBeUndefined()
    expect(isSpeaking()).toBe(false)
    expect(() => cancelSpeech()).not.toThrow()
    expect(() => primeSpeech()).not.toThrow()
  })

  it('is a no-op when disabled or empty', async () => {
    const { synth } = installSynth()
    await speak('Hola', { enabled: false })
    await speak('   ')
    expect(synth.speak).not.toHaveBeenCalled()
  })

  it('speaks with the best voice, language and rate; resolves on end', async () => {
    const { synth, spoken } = installSynth()
    expect(isTTSSupported()).toBe(true)
    const p = speak('Descanso terminado. Serie 3 de 4.', { lang: 'es-CO', rate: 1.2 })
    expect(synth.speak).toHaveBeenCalledTimes(1)
    const u = spoken[0]!
    expect(u.text).toBe('Descanso terminado. Serie 3 de 4.')
    expect((u.voice as VoiceLike).name).toBe('Paulina (Enhanced)')
    expect(u.lang).toBe('es-MX')
    expect(u.rate).toBe(1.2)
    expect(isSpeaking()).toBe(true)
    u.onend?.()
    await expect(p).resolves.toBeUndefined()
  })

  it('cancels the previous utterance before speaking again', () => {
    vi.useFakeTimers()
    const { synth, spoken } = installSynth()
    void speak('Siguiente: sentadilla')
    void speak('Descanso terminado')
    expect(synth.cancel).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(60)
    expect(spoken.map((u) => u.text)).toEqual(['Siguiente: sentadilla', 'Descanso terminado'])
  })

  it('resolves even if the engine never reports the end', async () => {
    vi.useFakeTimers()
    installSynth()
    const done = vi.fn()
    void speak('Hola').then(done)
    await vi.advanceTimersByTimeAsync(3000)
    expect(done).toHaveBeenCalled()
  })

  it('clamps rate and volume', () => {
    const { spoken } = installSynth()
    void speak('x', { rate: 9, volume: -1 })
    expect(spoken[0]!.rate).toBe(2)
    expect(spoken[0]!.volume).toBe(0)
  })

  it('cancelSpeech stops what is being said', () => {
    const { synth } = installSynth()
    void speak('Hola')
    cancelSpeech()
    expect(synth.cancel).toHaveBeenCalled()
    expect(isSpeaking()).toBe(false)
  })

  it('primeSpeech speaks one silent utterance, once', () => {
    const { synth, spoken } = installSynth()
    primeSpeech()
    primeSpeech()
    expect(synth.speak).toHaveBeenCalledTimes(1)
    expect(spoken[0]!.volume).toBe(0)
  })
})
