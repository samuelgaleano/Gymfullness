/**
 * Music-friendly feedback: short synthesized beeps + vibration. No audio files.
 *
 * - The AudioContext is created lazily (browsers block audio until a user gesture).
 * - On Safari we set `navigator.audioSession.type = 'ambient'` so our beeps MIX with
 *   Spotify / Apple Music instead of pausing them. (Ambient sounds follow the
 *   ring/silent switch on iPhone — that's the price of not interrupting music.)
 * - `unlockAudio()` must run inside a user gesture once (resume + silent buffer);
 *   `autoUnlockAudio()` wires that to the first tap for you.
 * - `vibrate()` is a safe no-op where unsupported (iOS Safari).
 */

export type BeepKind = 'tick' | 'go' | 'end' | 'success' | 'pr'
export type HapticKind = 'tick' | 'tap' | 'success' | 'warning' | 'error' | 'end' | 'pr'

export interface BeepOptions {
  /** 0..1, default 0.8 */
  volume?: number
  /** Convenience for settings.sounds; false = no-op. Default true. */
  enabled?: boolean
}

type AudioCtxCtor = new (options?: AudioContextOptions) => AudioContext

interface AudioSessionLike {
  type: string
}

let ctx: AudioContext | null = null
let unlocked = false

function audioCtor(): AudioCtxCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function isAudioSupported(): boolean {
  return audioCtor() !== null
}

/** Ask Safari to mix our sounds with other apps' audio (no-op elsewhere). */
export function setAmbientAudioSession(): void {
  if (typeof navigator === 'undefined') return
  const session = (navigator as Navigator & { audioSession?: AudioSessionLike }).audioSession
  if (!session) return
  try {
    if (session.type !== 'ambient') session.type = 'ambient'
  } catch {
    /* read-only in some versions */
  }
}

/** Lazily created shared AudioContext, or null when unsupported. */
export function getAudioContext(): AudioContext | null {
  if (ctx) return ctx
  const C = audioCtor()
  if (!C) return null
  setAmbientAudioSession()
  try {
    ctx = new C({ latencyHint: 'interactive' })
  } catch {
    try {
      ctx = new C()
    } catch {
      ctx = null
    }
  }
  return ctx
}

export function isAudioUnlocked(): boolean {
  return unlocked && ctx?.state === 'running'
}

/** Call from a user gesture: resumes the context and plays a silent buffer (iOS). */
export async function unlockAudio(): Promise<boolean> {
  const c = getAudioContext()
  if (!c) return false
  setAmbientAudioSession()
  try {
    if (c.state !== 'running') await c.resume()
  } catch {
    /* not allowed yet */
  }
  try {
    const buf = c.createBuffer(1, 1, 22050)
    const src = c.createBufferSource()
    src.buffer = buf
    src.connect(c.destination)
    src.start(0)
  } catch {
    /* ignore */
  }
  unlocked = c.state === 'running'
  return unlocked
}

/**
 * Unlock audio on the first user gesture anywhere on the page.
 * Returns a cleanup function. Safe to call more than once.
 */
export function autoUnlockAudio(target: EventTarget | null = typeof window !== 'undefined' ? window : null): () => void {
  if (!target) return () => {}
  const events = ['pointerdown', 'touchend', 'keydown', 'click'] as const
  const handler = () => {
    void unlockAudio().then((ok) => {
      if (ok) cleanup()
    })
  }
  const cleanup = () => {
    for (const e of events) target.removeEventListener(e, handler, true)
  }
  for (const e of events) target.addEventListener(e, handler, { capture: true, passive: true })
  return cleanup
}

/* ---------------- synthesis ---------------- */

interface Note {
  freq: number
  /** seconds from now */
  at: number
  /** seconds */
  dur: number
  type?: OscillatorType
  /** relative gain 0..1 */
  gain?: number
  /** bell-like overtone (2× freq) */
  bell?: boolean
}

const PEAK = 0.32

/** The sound recipes (exported for tests). Soft sines/triangles, short envelopes. */
export const BEEP_RECIPES: Record<BeepKind, Note[]> = {
  // countdown 3-2-1: short, soft, 880 Hz / 70 ms
  tick: [{ freq: 880, at: 0, dur: 0.07, gain: 0.7 }],
  // start / go: bright single bell
  go: [{ freq: 987.77, at: 0, dur: 0.24, type: 'triangle', gain: 0.8, bell: true }],
  // rest finished: two-tone chime G5 → C6
  end: [
    { freq: 783.99, at: 0, dur: 0.42, gain: 0.85, bell: true },
    { freq: 1046.5, at: 0.16, dur: 0.6, gain: 0.85, bell: true },
  ],
  // set logged: tiny upward blip
  success: [
    { freq: 659.25, at: 0, dur: 0.08, gain: 0.55 },
    { freq: 987.77, at: 0.07, dur: 0.12, gain: 0.55 },
  ],
  // personal record: C5 E5 G5 C6 arpeggio with a ringing top note
  pr: [
    { freq: 523.25, at: 0, dur: 0.14, gain: 0.6, bell: true },
    { freq: 659.25, at: 0.085, dur: 0.14, gain: 0.65, bell: true },
    { freq: 783.99, at: 0.17, dur: 0.16, gain: 0.7, bell: true },
    { freq: 1046.5, at: 0.255, dur: 0.7, gain: 0.85, bell: true },
  ],
}

function playNote(c: AudioContext, dest: AudioNode, n: Note, t0: number, volume: number): void {
  const start = t0 + n.at
  const end = start + n.dur
  const peak = Math.max(0.0002, PEAK * volume * (n.gain ?? 1))
  const voices: Array<{ freq: number; gain: number; type: OscillatorType; dur: number }> = [
    { freq: n.freq, gain: peak, type: n.type ?? 'sine', dur: n.dur },
  ]
  if (n.bell) voices.push({ freq: n.freq * 2, gain: peak * 0.22, type: 'sine', dur: n.dur * 0.6 })
  for (const v of voices) {
    const osc = c.createOscillator()
    const g = c.createGain()
    osc.type = v.type
    osc.frequency.setValueAtTime(v.freq, start)
    g.gain.setValueAtTime(0.0001, start)
    g.gain.exponentialRampToValueAtTime(v.gain, start + 0.006)
    g.gain.exponentialRampToValueAtTime(0.0001, start + v.dur)
    osc.connect(g)
    g.connect(dest)
    osc.start(start)
    osc.stop(Math.max(end, start + v.dur) + 0.03)
    osc.onended = () => {
      try {
        osc.disconnect()
        g.disconnect()
      } catch {
        /* ignore */
      }
    }
  }
}

/** Play a short synthesized cue. Never throws; no-op when unsupported/disabled. */
export function beep(kind: BeepKind, opts: BeepOptions = {}): void {
  if (opts.enabled === false) return
  const c = getAudioContext()
  if (!c) return
  const volume = Math.min(1, Math.max(0, opts.volume ?? 0.8))
  if (volume === 0) return
  try {
    setAmbientAudioSession()
    if (c.state !== 'running') void c.resume().catch(() => undefined)
    const recipe = BEEP_RECIPES[kind]
    if (!recipe) return
    // gentle low-pass to take the edge off
    const master = c.createGain()
    master.gain.value = 1
    try {
      const lp = c.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = 6000
      master.connect(lp)
      lp.connect(c.destination)
    } catch {
      master.connect(c.destination)
    }
    const t0 = c.currentTime + 0.01
    for (const n of recipe) playNote(c, master, n, t0, volume)
  } catch {
    /* audio is best-effort */
  }
}

/* ---------------- vibration ---------------- */

/** navigator.vibrate that never throws. Returns false where unsupported (iOS). */
export function vibrate(pattern: number | number[]): boolean {
  if (typeof navigator === 'undefined') return false
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean }
  if (typeof nav.vibrate !== 'function') return false
  try {
    return nav.vibrate(pattern)
  } catch {
    return false
  }
}

export const HAPTIC_PATTERNS: Record<HapticKind, number | number[]> = {
  tick: 8,
  tap: 15,
  success: [18, 40, 18],
  warning: [35, 60, 35],
  error: [60, 40, 60, 40, 60],
  end: [180, 90, 180],
  pr: [30, 45, 30, 45, 110],
}

/** Preset vibration. `enabled` mirrors settings.vibration. */
export function haptic(kind: HapticKind, enabled = true): boolean {
  if (!enabled) return false
  return vibrate(HAPTIC_PATTERNS[kind])
}

const BEEP_TO_HAPTIC: Record<BeepKind, HapticKind> = {
  tick: 'tick',
  go: 'tap',
  end: 'end',
  success: 'success',
  pr: 'pr',
}

/** Beep + matching vibration in one call, honoring the user's settings. */
export function cue(kind: BeepKind, opts: { sound?: boolean; vibration?: boolean; volume?: number } = {}): void {
  if (opts.sound !== false) beep(kind, { volume: opts.volume })
  if (opts.vibration !== false) haptic(BEEP_TO_HAPTIC[kind])
}

/** Test helper: forget the shared context. */
export function __resetAudioForTests(): void {
  ctx = null
  unlocked = false
}
