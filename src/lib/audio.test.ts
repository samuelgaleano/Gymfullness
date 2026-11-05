import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEEP_RECIPES,
  HAPTIC_PATTERNS,
  __resetAudioForTests,
  autoUnlockAudio,
  beep,
  cue,
  getAudioContext,
  haptic,
  isAudioSupported,
  isAudioUnlocked,
  setAmbientAudioSession,
  unlockAudio,
  vibrate,
} from './audio'

/* ---------------- fake Web Audio ---------------- */

class FakeParam {
  value = 0
  setValueAtTime = vi.fn()
  exponentialRampToValueAtTime = vi.fn()
  linearRampToValueAtTime = vi.fn()
}
class FakeNode {
  connect = vi.fn((n: unknown) => n)
  disconnect = vi.fn()
}
class FakeOsc extends FakeNode {
  type = 'sine'
  frequency = new FakeParam()
  start = vi.fn()
  stop = vi.fn()
  onended: (() => void) | null = null
}
class FakeGain extends FakeNode {
  gain = new FakeParam()
}
class FakeFilter extends FakeNode {
  type = ''
  frequency = new FakeParam()
}
class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  state: 'suspended' | 'running' = 'suspended'
  currentTime = 0
  destination = new FakeNode()
  oscillators: FakeOsc[] = []
  sources: Array<{ start: ReturnType<typeof vi.fn> }> = []
  options: unknown
  constructor(options?: unknown) {
    this.options = options
    FakeAudioContext.instances.push(this)
  }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  createOscillator() {
    const o = new FakeOsc()
    this.oscillators.push(o)
    return o
  }
  createGain() {
    return new FakeGain()
  }
  createBiquadFilter() {
    return new FakeFilter()
  }
  createBuffer() {
    return {}
  }
  createBufferSource() {
    const s = { buffer: null as unknown, connect: vi.fn(), start: vi.fn() }
    this.sources.push(s)
    return s
  }
}

function installAudio() {
  Object.defineProperty(window, 'AudioContext', { value: FakeAudioContext, configurable: true, writable: true })
}

beforeEach(() => {
  __resetAudioForTests()
  FakeAudioContext.instances = []
})
afterEach(() => {
  Reflect.deleteProperty(window, 'AudioContext')
  Reflect.deleteProperty(window, 'webkitAudioContext')
  Reflect.deleteProperty(navigator, 'vibrate')
  Reflect.deleteProperty(navigator, 'audioSession')
})

describe('vibrate / haptic', () => {
  it('is a safe no-op where unsupported (iOS)', () => {
    expect(vibrate(10)).toBe(false)
    expect(haptic('end')).toBe(false)
  })

  it('forwards patterns and swallows exceptions', () => {
    const fn = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true })
    expect(vibrate([10, 20])).toBe(true)
    expect(fn).toHaveBeenCalledWith([10, 20])
    expect(haptic('end')).toBe(true)
    expect(fn).toHaveBeenLastCalledWith(HAPTIC_PATTERNS.end)
    expect(haptic('tick', false)).toBe(false)
    expect(fn).toHaveBeenCalledTimes(2)

    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('blocked')
      },
      configurable: true,
      writable: true,
    })
    expect(vibrate(10)).toBe(false)
  })
})

describe('audio context', () => {
  it('beep is a no-op without Web Audio', () => {
    expect(isAudioSupported()).toBe(false)
    expect(getAudioContext()).toBeNull()
    expect(() => beep('end')).not.toThrow()
  })

  it('is created lazily, once, and sets the ambient audio session first', () => {
    installAudio()
    const session = { type: 'auto' }
    Object.defineProperty(navigator, 'audioSession', { value: session, configurable: true })
    expect(FakeAudioContext.instances).toHaveLength(0)
    const a = getAudioContext()
    const b = getAudioContext()
    expect(a).toBe(b)
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(session.type).toBe('ambient')
  })

  it('setAmbientAudioSession is harmless without the API', () => {
    expect(() => setAmbientAudioSession()).not.toThrow()
  })

  it('falls back to webkitAudioContext', () => {
    Object.defineProperty(window, 'webkitAudioContext', { value: FakeAudioContext, configurable: true, writable: true })
    expect(getAudioContext()).toBeInstanceOf(FakeAudioContext)
  })

  it('unlockAudio resumes and plays a silent buffer', async () => {
    installAudio()
    expect(isAudioUnlocked()).toBe(false)
    await expect(unlockAudio()).resolves.toBe(true)
    const c = FakeAudioContext.instances[0]!
    expect(c.resume).toHaveBeenCalled()
    expect(c.sources[0]!.start).toHaveBeenCalled()
    expect(isAudioUnlocked()).toBe(true)
  })

  it('autoUnlockAudio unlocks on the first gesture and cleans up', async () => {
    installAudio()
    const target = new EventTarget()
    const cleanup = autoUnlockAudio(target)
    target.dispatchEvent(new Event('pointerdown'))
    await vi.waitFor(() => expect(isAudioUnlocked()).toBe(true))
    expect(typeof cleanup).toBe('function')
    cleanup()
  })
})

describe('beep', () => {
  it('tick is a soft 880 Hz, ~70 ms tone', () => {
    installAudio()
    beep('tick')
    const c = FakeAudioContext.instances[0]!
    expect(c.oscillators).toHaveLength(1)
    const o = c.oscillators[0]!
    expect(o.frequency.setValueAtTime).toHaveBeenCalledWith(880, expect.any(Number))
    const [startAt] = o.start.mock.calls[0] as [number]
    const [stopAt] = o.stop.mock.calls[0] as [number]
    expect(stopAt - startAt).toBeGreaterThan(0.06)
    expect(stopAt - startAt).toBeLessThan(0.15)
  })

  it('end is a two-tone chime, pr an arpeggio (bell overtones included)', () => {
    installAudio()
    beep('end')
    const c = FakeAudioContext.instances[0]!
    expect(c.oscillators).toHaveLength(BEEP_RECIPES.end.length * 2)
    const freqs = c.oscillators.map((o) => (o.frequency.setValueAtTime.mock.calls[0] as [number])[0])
    expect(new Set(freqs).size).toBeGreaterThanOrEqual(2)

    beep('pr')
    expect(c.oscillators.length).toBe(BEEP_RECIPES.end.length * 2 + BEEP_RECIPES.pr.length * 2)
    expect(BEEP_RECIPES.pr.map((n) => n.freq)).toEqual([...BEEP_RECIPES.pr.map((n) => n.freq)].sort((a, b) => a - b))
  })

  it('every kind plays without throwing and resumes a suspended context', () => {
    installAudio()
    for (const k of ['tick', 'go', 'end', 'success', 'pr'] as const) expect(() => beep(k, { volume: 0.5 })).not.toThrow()
    expect(FakeAudioContext.instances[0]!.resume).toHaveBeenCalled()
  })

  it('respects enabled:false and volume 0', () => {
    installAudio()
    beep('end', { enabled: false })
    expect(FakeAudioContext.instances).toHaveLength(0)
    beep('end', { volume: 0 })
    expect(FakeAudioContext.instances[0]?.oscillators ?? []).toHaveLength(0)
  })

  it('envelope peaks stay gentle (no clipping)', () => {
    installAudio()
    const gains: number[] = []
    const orig = FakeAudioContext.prototype.createGain
    FakeAudioContext.prototype.createGain = function () {
      const g = orig.call(this)
      g.gain.exponentialRampToValueAtTime.mockImplementation((v: number) => {
        gains.push(v)
      })
      return g
    }
    try {
      beep('pr', { volume: 1 })
    } finally {
      FakeAudioContext.prototype.createGain = orig
    }
    expect(Math.max(...gains)).toBeLessThanOrEqual(0.35)
  })
})

describe('cue', () => {
  it('combines sound and vibration per settings', () => {
    installAudio()
    const fn = vi.fn(() => true)
    Object.defineProperty(navigator, 'vibrate', { value: fn, configurable: true, writable: true })
    cue('end', { sound: false, vibration: true })
    expect(FakeAudioContext.instances).toHaveLength(0)
    expect(fn).toHaveBeenCalledWith(HAPTIC_PATTERNS.end)
    cue('pr', { sound: true, vibration: false })
    expect(FakeAudioContext.instances).toHaveLength(1)
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
