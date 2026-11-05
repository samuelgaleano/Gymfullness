/**
 * Voice announcements via speechSynthesis ("Descanso terminado. Serie 3 de 4.").
 *
 * - Picks the best voice for the language: exact locale > same language, local /
 *   "enhanced" / "premium" / Google voices preferred, novelty voices avoided.
 * - Each `speak()` cancels the previous utterance (announcements never queue up).
 * - `primeSpeech()` on the first user gesture unlocks synthesis on iOS.
 * - Everything is a silent no-op where unsupported.
 */

export interface SpeakOptions {
  /** BCP-47, e.g. 'es-CO'. Default 'es-ES'. */
  lang?: string
  /** 0.5..2, default 1.05 (slightly brisk, easier to catch over music). */
  rate?: number
  pitch?: number
  /** 0..1, default 1 */
  volume?: number
  /** Mirrors settings.voiceAnnouncements; false = no-op. Default true. */
  enabled?: boolean
}

/** The subset of SpeechSynthesisVoice we rank on (tests pass plain objects). */
export interface VoiceLike {
  readonly name: string
  readonly lang: string
  readonly localService: boolean
  readonly default: boolean
  readonly voiceURI?: string
}

function synth(): SpeechSynthesis | null {
  if (typeof window === 'undefined') return null
  const s = (window as Window & { speechSynthesis?: SpeechSynthesis }).speechSynthesis
  return s ?? null
}

export function isTTSSupported(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance !== 'undefined'
}

/* ---------------- voice selection ---------------- */

const LATAM = new Set(['419', 'mx', 'us', 'co', 'ar', 'cl', 'pe', 've', 'ec', 'gt', 'cu', 'bo', 'do', 'hn', 'py', 'sv', 'ni', 'cr', 'pa', 'uy', 'pr'])

/** Apple's novelty / robotic voices that also exist for Spanish. */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|eddy|flo|good news|grandma|grandpa|hysterical|jester|junior|organ|pipe organ|ralph|reed|rocko|sandy|shelley|superstar|trinoids|whisper|wobble|zarvox|fred|kathy)\b/i
const QUALITY = /(enhanced|premium|mejorad|neural|natural|wavenet|online)/i

function splitLang(lang: string): { base: string; region: string } {
  const [base = '', region = ''] = lang.replace('_', '-').toLowerCase().split('-')
  return { base, region }
}

/** Higher is better; ≤ 0 means "wrong language". */
export function scoreVoice(v: VoiceLike, lang: string): number {
  const want = splitLang(lang)
  const have = splitLang(v.lang)
  if (!have.base || have.base !== want.base) return 0
  let score = 50
  if (have.region === want.region) score += 40
  else if (want.base === 'es') {
    const wantLatam = want.region !== 'es'
    const haveLatam = LATAM.has(have.region)
    if (wantLatam === haveLatam) score += 15
  }
  if (v.localService) score += 10
  if (QUALITY.test(v.name)) score += 22
  if (/google/i.test(v.name)) score += 12
  if (/compact/i.test(v.name)) score -= 8
  if (NOVELTY.test(v.name)) score -= 45
  if (v.default) score += 2
  return score
}

/** Best voice for `lang`, or null when none speaks the language. */
export function pickVoice<V extends VoiceLike>(voices: readonly V[], lang: string): V | null {
  let best: V | null = null
  let bestScore = 0
  for (const v of voices) {
    const s = scoreVoice(v, lang)
    if (s > bestScore) {
      best = v
      bestScore = s
    }
  }
  return best
}

let voicesCache: SpeechSynthesisVoice[] = []
let voicesListening = false

function refreshVoices(): SpeechSynthesisVoice[] {
  const s = synth()
  if (!s) return []
  try {
    const list = s.getVoices()
    if (list.length) voicesCache = list
  } catch {
    /* ignore */
  }
  if (!voicesListening) {
    voicesListening = true
    try {
      s.addEventListener('voiceschanged', () => {
        try {
          voicesCache = s.getVoices()
        } catch {
          /* ignore */
        }
      })
    } catch {
      /* old Safari: no addEventListener on speechSynthesis */
    }
  }
  return voicesCache
}

/** Voices load asynchronously in Chrome; resolves within `timeoutMs`. */
export function loadVoices(timeoutMs = 1200): Promise<SpeechSynthesisVoice[]> {
  const s = synth()
  if (!s) return Promise.resolve([])
  const now = refreshVoices()
  if (now.length) return Promise.resolve(now)
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      try {
        s.removeEventListener('voiceschanged', done)
      } catch {
        /* ignore */
      }
      resolve(refreshVoices())
    }
    const timer = setTimeout(done, timeoutMs)
    try {
      s.addEventListener('voiceschanged', done)
    } catch {
      /* ignore */
    }
  })
}

/* ---------------- speaking ---------------- */

/** Kept alive so Chrome doesn't garbage-collect it mid-sentence (which drops onend). */
let current: SpeechSynthesisUtterance | null = null
let primed = false

/**
 * Speak `text`, cancelling anything already being said. Resolves when finished
 * (or immediately when disabled/unsupported). Never rejects.
 */
export function speak(text: string, opts: SpeakOptions = {}): Promise<void> {
  const s = synth()
  const clean = (text ?? '').trim()
  if (opts.enabled === false || !s || !clean || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve()
  const lang = opts.lang || 'es-ES'
  return new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      clearTimeout(guard)
      if (current === u) current = null
      resolve()
    }
    let u: SpeechSynthesisUtterance
    try {
      u = new SpeechSynthesisUtterance(clean)
      u.lang = lang
      const v = pickVoice(refreshVoices(), lang)
      if (v) {
        u.voice = v
        u.lang = v.lang
      }
      u.rate = clampNum(opts.rate ?? 1.05, 0.5, 2)
      u.pitch = clampNum(opts.pitch ?? 1, 0, 2)
      u.volume = clampNum(opts.volume ?? 1, 0, 1)
      u.onend = done
      u.onerror = done
    } catch {
      resolve()
      return
    }
    // if the engine never reports back (some Android builds), resolve anyway
    const guard = setTimeout(done, 1500 + clean.length * 90)
    try {
      const busy = s.speaking || s.pending
      if (busy) s.cancel()
      if (s.paused) s.resume()
      current = u
      // Chrome can swallow a speak() issued in the same tick as cancel()
      if (busy) setTimeout(() => s.speak(u), 50)
      else s.speak(u)
    } catch {
      done()
    }
  })
}

/** Stop any announcement in progress (e.g. when the user starts dictating). */
export function cancelSpeech(): void {
  const s = synth()
  if (!s) return
  try {
    if (s.speaking || s.pending) s.cancel()
  } catch {
    /* ignore */
  }
  current = null
}

export function isSpeaking(): boolean {
  const s = synth()
  if (!s) return false
  try {
    return s.speaking
  } catch {
    return false
  }
}

/**
 * Call inside the first user gesture (tap on "Empezar entreno"): iOS only allows
 * speech that was first triggered by a gesture. Also warms up the voice list.
 */
export function primeSpeech(): void {
  const s = synth()
  if (!s || primed || typeof SpeechSynthesisUtterance === 'undefined') return
  primed = true
  refreshVoices()
  try {
    const u = new SpeechSynthesisUtterance(' ')
    u.volume = 0
    u.rate = 2
    s.speak(u)
  } catch {
    primed = false
  }
}

function clampNum(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo
}

/** Test helper. */
export function __resetTTSForTests(): void {
  voicesCache = []
  voicesListening = false
  current = null
  primed = false
}
