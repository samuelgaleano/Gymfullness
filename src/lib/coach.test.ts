import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  __resetCoachForTests,
  askCoach,
  buildCoachContext,
  coachAvailable,
  detectIntent,
  localAnswer,
  MAX_CONTEXT_CHARS,
  type CoachIntent,
} from './coach'
import { getBuiltinExercise } from '@/data/exercises'
import type { Exercise, Profile } from './types'

const bench = getBuiltinExercise('bench-press') as Exercise
const plank = getBuiltinExercise('plank')
const pullup = getBuiltinExercise('pull-up')
const profile: Profile = { goal: 'strength', level: 'beginner', equipment: 'gym', onboarded: true, updatedAt: 1 }

const lineCount = (s: string) => s.split('\n').length

describe('detectIntent', () => {
  const cases: [string, CoachIntent][] = [
    ['¿Cómo se hace bien?', 'technique'],
    ['¿Cómo respiro en este ejercicio?', 'breathing'],
    ['¿Qué errores debo evitar?', 'mistakes'],
    ['Me duele el hombro al bajar', 'pain'],
    ['Creo que me lesioné la rodilla', 'pain'],
    ['Tengo agujetas, ¿puedo entrenar?', 'soreness'],
    ['¿Cuánto peso debo usar?', 'weight'],
    ['¿Cuántas repeticiones y series hago?', 'reps'],
    ['¿Cuánto descanso entre series?', 'rest'],
    ['¿Cómo caliento antes?', 'warmup'],
    ['La máquina está ocupada, ¿qué alternativa hay?', 'alternatives'],
    ['¿Cuándo subo de peso?', 'progression'],
    ['Estoy estancado', 'progression'],
    ['hola', 'general'],
  ]
  it.each(cases)('%s → %s', (q, intent) => {
    expect(detectIntent(q)).toBe(intent)
  })
})

describe('localAnswer', () => {
  it('technique uses the exercise setup and cues', () => {
    const a = localAnswer('¿Cómo se hace?', { exercise: bench })
    expect(a).toContain(bench.name)
    expect(a).toContain(bench.setup[0].replace(/\.$/, ''))
    expect(a).toContain(bench.cues[0].replace(/\.$/, ''))
  })

  it('breathing uses the exercise breathing text', () => {
    const a = localAnswer('¿cómo respiro?', { exercise: bench })
    expect(bench.breathing).toBeTruthy()
    expect(a).toContain(bench.breathing as string)
  })

  it('mistakes lists the exercise mistakes', () => {
    const a = localAnswer('errores comunes', { exercise: bench })
    for (const m of bench.mistakes.slice(0, 3)) expect(a).toContain(m.replace(/\.$/, ''))
  })

  it('pain: stop + consult a professional, even without an exercise', () => {
    for (const ctx of [{ exercise: bench }, {}]) {
      const a = localAnswer('Siento un pinchazo en el codo', ctx)
      expect(a).toMatch(/det[eé]n/i)
      expect(a).toMatch(/consulta a un profesional/)
    }
  })

  it('weight: reps in reserve and the exercise increment', () => {
    const a = localAnswer('¿Cuántos kilos pongo?', { exercise: bench })
    expect(a).toMatch(/reserva/)
    expect(a).toContain(`${bench.increment} kg`)
  })

  it('weight on a bodyweight exercise talks about bodyweight', () => {
    if (!pullup) return
    expect(localAnswer('¿cuánto peso?', { exercise: pullup })).toMatch(/peso corporal/)
  })

  it('reps follow the profile goal', () => {
    expect(localAnswer('¿Cuántas reps hago?', { exercise: bench, profile })).toMatch(/3–6 reps/)
    expect(localAnswer('¿Cuántas reps hago?', { exercise: bench, profile: { ...profile, goal: 'muscle' } })).toMatch(
      /8–12 reps/,
    )
  })

  it('time exercises get seconds, not reps', () => {
    if (!plank) return
    expect(localAnswer('¿cuántas series?', { exercise: plank })).toMatch(/s con buena forma/)
  })

  it('rest uses the exercise default rest', () => {
    const a = localAnswer('¿cuánto descanso?', { exercise: bench, profile })
    expect(a).toContain('2 min 30 s') // bench defaultRestSec = 150
    expect(a).toMatch(/ganar fuerza/)
  })

  it('alternatives suggests other exercises, not the same one', () => {
    const a = localAnswer('¿Qué alternativa hay?', { exercise: bench, profile })
    const bullets = a.split('\n').filter((l) => l.startsWith('• '))
    expect(bullets.length).toBeGreaterThanOrEqual(2)
    expect(bullets.some((l) => l === `• ${bench.name}.`)).toBe(false)
  })

  it('soreness, warm-up, progression and general answers are sensible', () => {
    expect(localAnswer('tengo agujetas', {})).toMatch(/2–4 días/)
    expect(localAnswer('¿cómo caliento?', { exercise: bench })).toMatch(/aproximación/)
    expect(localAnswer('¿cuándo subo de peso?', { exercise: bench, profile })).toMatch(/Progresión doble/)
    expect(localAnswer('hola', {})).toMatch(/Puedo ayudarte/)
  })

  it('every answer is at most 6 lines, for every intent and context', () => {
    const qs = [
      'técnica',
      'respiración',
      'errores',
      'me duele',
      'agujetas',
      'peso',
      'reps',
      'descanso',
      'calentar',
      'alternativa',
      'progresar',
      'hola',
    ]
    for (const q of qs) {
      for (const ctx of [{}, { exercise: bench, profile }]) {
        const a = localAnswer(q, ctx)
        expect(a.length).toBeGreaterThan(20)
        expect(lineCount(a)).toBeLessThanOrEqual(6)
      }
    }
  })
})

describe('buildCoachContext', () => {
  it('keeps exercise technique and coarse profile, never the name', () => {
    const ctx = buildCoachContext({ exercise: bench, profile: { ...profile, name: 'Ana', birthYear: 1996 } }, new Date('2026-06-01'))
    expect(ctx.exercise?.name).toBe(bench.name)
    expect(ctx.exercise?.primary).toBe('Pecho')
    expect(ctx.profile).toEqual({ goal: 'strength', level: 'beginner', equipment: 'gym', age: 30 })
    expect(JSON.stringify(ctx)).not.toContain('Ana')
  })

  it('stays within 4 KB even with huge inputs', () => {
    const huge: Exercise = {
      ...bench,
      setup: Array(3).fill('x'.repeat(2000)),
      cues: Array(5).fill('y'.repeat(2000)),
      mistakes: Array(4).fill('z'.repeat(2000)),
    }
    const ctx = buildCoachContext({ exercise: huge, recentSummary: 'r'.repeat(5000) })
    expect(JSON.stringify(ctx).length).toBeLessThanOrEqual(MAX_CONTEXT_CHARS)
  })
})

/* ------------------------------------------------------------------ network paths */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('askCoach / coachAvailable', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    __resetCoachForTests()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('uses the AI answer when the endpoint is enabled', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? jsonResponse({ answer: 'Baja controlado y empuja fuerte.' }) : jsonResponse({ enabled: true }),
    )
    const res = await askCoach('¿Cómo mejoro mi press?', { exercise: bench, profile })
    expect(res).toEqual({ answer: 'Baja controlado y empuja fuerte.', source: 'ai' })
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    const body = JSON.parse(String(post?.[1]?.body)) as { question: string; context: { exercise: { name: string } } }
    expect(body.question).toBe('¿Cómo mejoro mi press?')
    expect(body.context.exercise.name).toBe(bench.name)
  })

  it('caches availability: one GET for several questions', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ enabled: false }))
    await askCoach('peso', { exercise: bench })
    await askCoach('reps', { exercise: bench })
    expect(await coachAvailable()).toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to local when disabled, 404, HTML (dev server) or network error', async () => {
    const variants: (() => Promise<Response>)[] = [
      async () => jsonResponse({ enabled: false }),
      async () => new Response('not found', { status: 404 }),
      async () => new Response('<!doctype html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      async () => {
        throw new TypeError('Failed to fetch')
      },
    ]
    for (const v of variants) {
      __resetCoachForTests()
      fetchMock.mockReset()
      fetchMock.mockImplementation(v)
      const res = await askCoach('¿cuánto descanso?', { exercise: bench })
      expect(res.source).toBe('local')
      expect(res.answer).toMatch(/descansa/)
      expect(fetchMock.mock.calls.every(([, init]) => init?.method !== 'POST')).toBe(true)
    }
  })

  it('falls back to local when the AI call fails or is rate limited', async () => {
    fetchMock.mockImplementation(async (_url, init) =>
      init?.method === 'POST' ? jsonResponse({ error: 'rate_limited' }, 429) : jsonResponse({ enabled: true }),
    )
    const res = await askCoach('me duele la espalda', { exercise: bench })
    expect(res.source).toBe('local')
    expect(res.answer).toMatch(/profesional/)
  })

  it('times out after 15 s and answers locally', async () => {
    vi.useFakeTimers()
    fetchMock.mockImplementation((_url, init) => {
      if (init?.method !== 'POST') return Promise.resolve(jsonResponse({ enabled: true }))
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      })
    })
    const pending = askCoach('¿cómo respiro?', { exercise: bench })
    await vi.advanceTimersByTimeAsync(14_000)
    let settled = false
    void pending.then(() => (settled = true))
    await Promise.resolve()
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1_500)
    const res = await pending
    expect(res.source).toBe('local')
    expect(res.answer).toContain(bench.breathing as string)
  })

  it('answers locally without any request when offline', async () => {
    const spy = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const res = await askCoach('¿técnica?', { exercise: bench })
    expect(res.source).toBe('local')
    expect(fetchMock).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
