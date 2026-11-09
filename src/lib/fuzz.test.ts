import { describe, expect, it } from 'vitest'
import { parseUtterance } from './voice/parse'
import { handleLocally } from './agent/local'

/** Deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const WORDS = [
  'ochenta', 'kilos', 'diez', 'repeticiones', 'por', 'x', '×', 'con', 'libras', 'segundos', 'minuto', 'y', 'medio', 'rpe',
  'siguiente', 'deshacer', 'descanso', 'terminar', 'entreno', 'igual', 'subí', 'bajé', 'cinco', 'cien', 'mil', 'punto', 'coma',
  '80', '82.5', '82,5', '-5', '0', '1e9', 'NaN', 'Infinity', '٣', '😀', '', ' ', '\n', '\u0000', '‮', 'ñ', 'é', 'ü',
  'reps', 'kg', 'lb', 'registra', 'mi', 'peso', 'cambia', 'este', 'ejercicio', 'añade', 'sentadilla', 'cómo', 'voy',
]

function phrase(r: () => number): string {
  const n = Math.floor(r() * 9)
  const parts: string[] = []
  for (let i = 0; i < n; i++) parts.push(WORDS[Math.floor(r() * WORDS.length)])
  const sep = r() < 0.2 ? '' : ' '
  return parts.join(sep) + (r() < 0.1 ? 'x'.repeat(Math.floor(r() * 3000)) : '')
}

const ctxs = [
  { lastWeight: 80, lastReps: 10, unit: 'kg' as const, kind: 'weight_reps' as const },
  { lastWeight: null, lastReps: null, unit: 'lb' as const, kind: 'reps' as const },
  { lastWeight: 0, lastReps: 0, unit: 'kg' as const, kind: 'time' as const },
]

describe('parseUtterance fuzz', () => {
  it('never throws and never returns absurd numbers', () => {
    const r = rng(42)
    for (let i = 0; i < 4000; i++) {
      const text = phrase(r)
      const ctx = ctxs[i % ctxs.length]
      const out = parseUtterance(text, ctx)
      expect(['set', 'command', 'unknown']).toContain(out.type)
      if (out.type === 'set') {
        for (const v of [out.weight, out.reps, out.seconds, out.rpe]) {
          if (v !== null && v !== undefined) {
            expect(Number.isFinite(v), `"${text.slice(0, 60)}" → ${v}`).toBe(true)
            expect(v).toBeGreaterThanOrEqual(0)
          }
        }
        if (out.weight != null) expect(out.weight).toBeLessThanOrEqual(1000)
        if (out.reps != null) expect(out.reps).toBeLessThanOrEqual(100)
        expect(out.confidence).toBeGreaterThanOrEqual(0)
        expect(out.confidence).toBeLessThanOrEqual(1)
      }
    }
  })

  it('handles non-string garbage defensively', () => {
    for (const bad of [null, undefined, 42, {}, [], Symbol.iterator]) {
      expect(() => parseUtterance(bad as unknown as string, ctxs[0])).not.toThrow()
    }
  })
})

describe('handleLocally fuzz', () => {
  it('tolerates non-string input', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => handleLocally(bad as unknown as string, {})).not.toThrow()
    }
  })

  it('never throws on arbitrary text', () => {
    const r = rng(7)
    const runtime = { navigate: () => {} } as never
    for (let i = 0; i < 1500; i++) {
      const text = phrase(r)
      expect(() => (handleLocally as (t: string, c: unknown) => unknown)(text, { runtime, route: '/' })).not.toThrow()
    }
  })
})
