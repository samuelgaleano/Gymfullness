import { describe, expect, it } from 'vitest'
import type { SessionExercise, SetLog, WorkoutSession } from '@/lib/types'
import {
  clock,
  formatSetCompact,
  formatSetValues,
  lastDoneSet,
  lastPerformance,
  loggedSets,
  remainingSets,
  restEndAnnouncement,
  segments,
  targetLine,
} from './helpers'

const set = (p: Partial<SetLog> = {}): SetLog => ({ id: Math.random().toString(36).slice(2), weight: 80, reps: 10, done: false, ...p })
const ex = (id: string, sets: SetLog[], p: Partial<SessionExercise> = {}): SessionExercise => ({
  id: `se_${id}`,
  exerciseId: id,
  target: { sets: sets.length, repsMin: 8, repsMax: 12, restSec: 90 },
  sets,
  ...p,
})
const session = (exercises: SessionExercise[], p: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'w1',
  name: 'Test',
  unit: 'kg',
  startedAt: 1000,
  exercises,
  cursor: { ex: 0, set: 0 },
  updatedAt: 1000,
  ...p,
})

describe('formatting', () => {
  it('formats set values by kind', () => {
    expect(formatSetValues({ weight: 80, reps: 10 }, 'weight_reps', 'kg')).toBe('80 kg × 10')
    expect(formatSetValues({ weight: 82.5, reps: 8 }, 'weight_reps', 'lb')).toBe('82.5 lb × 8')
    expect(formatSetValues({ reps: 12 }, 'reps', 'kg')).toBe('12 reps')
    expect(formatSetValues({ seconds: 90 }, 'time', 'kg')).toBe('1:30 min')
    expect(formatSetValues({ seconds: 45 }, 'time', 'kg')).toBe('45 s')
    expect(formatSetValues({}, 'weight_reps', 'kg')).toBe('–')
  })
  it('formats compact chips', () => {
    expect(formatSetCompact({ weight: 80, reps: 10 }, 'weight_reps')).toBe('80×10')
    expect(formatSetCompact({ reps: 15 }, 'reps')).toBe('15')
    expect(formatSetCompact({ seconds: 30 }, 'time')).toBe('30 s')
  })
  it('clock', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(90)).toBe('1:30')
    expect(clock(605)).toBe('10:05')
    expect(clock(-3)).toBe('0:00')
  })
  it('builds the target line', () => {
    expect(targetLine(ex('a', [set()]), 'weight_reps')).toBe('8–12 reps · Descanso 90 s')
    const same = ex('a', [set()], { target: { sets: 1, repsMin: 10, repsMax: 10, restSec: 150 } })
    expect(targetLine(same, 'weight_reps')).toBe('10 reps · Descanso 2:30 min')
    const timed = ex('p', [set()], { target: { sets: 1, repsMin: 0, repsMax: 0, restSec: 45, targetSeconds: 40 } })
    expect(targetLine(timed, 'time')).toBe('40 s · Descanso 45 s')
  })
})

describe('progress helpers', () => {
  const s = session([
    ex('a', [set({ done: true }), set({ done: true }), set()]),
    ex('b', [set({ done: true }), set()], { skipped: true }),
    ex('c', [set(), set()]),
  ])
  it('counts remaining and logged sets (skipped exercises do not count as remaining)', () => {
    expect(remainingSets(s)).toBe(3)
    expect(loggedSets(s)).toBe(3)
  })
  it('segments per exercise', () => {
    const g = segments({ ...s, cursor: { ex: 2, set: 0 } })
    expect(g.map((x) => Math.round(x.fill * 100))).toEqual([67, 50, 0])
    expect(g.map((x) => x.skipped)).toEqual([false, true, false])
    expect(g.map((x) => x.current)).toEqual([false, false, true])
  })
  it('last done set', () => {
    const a = ex('a', [set({ done: true, completedAt: 5, reps: 8 }), set({ done: true, completedAt: 9, reps: 7 }), set()])
    expect(lastDoneSet(a)?.reps).toBe(7)
    expect(lastDoneSet(ex('a', [set()]))).toBeNull()
  })
})

describe('lastPerformance', () => {
  const past = (id: string, startedAt: number, unit: 'kg' | 'lb', sets: SetLog[]) =>
    session([ex('bench-press', sets)], { id, startedAt, unit, endedAt: startedAt + 1 })

  it('returns the best set of the latest session, ignoring warm-ups and the current one', () => {
    const history = [
      past('old', 1000, 'kg', [set({ done: true, weight: 60, reps: 10 })]),
      past('new', 5000, 'kg', [
        set({ done: true, weight: 40, reps: 12, isWarmup: true }),
        set({ done: true, weight: 80, reps: 8 }),
        set({ done: true, weight: 75, reps: 10 }),
      ]),
      past('cur', 9000, 'kg', [set({ done: true, weight: 100, reps: 5 })]),
    ]
    const r = lastPerformance(history, 'bench-press', 'kg', 'cur')
    expect(r).toMatchObject({ weight: 80, reps: 8, at: 5000 })
    expect(lastPerformance(history, 'squat', 'kg')).toBeNull()
  })
  it('converts units', () => {
    const history = [past('x', 1000, 'lb', [set({ done: true, weight: 176, reps: 5 })])]
    expect(lastPerformance(history, 'bench-press', 'kg')?.weight).toBe(80)
  })
})

describe('restEndAnnouncement', () => {
  const name = (id: string) => (id === 'b' ? 'Remo' : 'Press')
  const s = session([ex('a', [set(), set(), set(), set()]), ex('b', [set(), set(), set()])], {
    rest: { startedAt: 0, endsAt: 1, durationSec: 90, nextExIndex: 0, nextSetIndex: 2 },
  })
  it('announces the next set of the same exercise', () => {
    expect(restEndAnnouncement(s, name)).toBe('Descanso terminado. Serie 3 de 4.')
  })
  it('announces a new exercise', () => {
    const n = { ...s, rest: { ...s.rest!, nextExIndex: 1, nextSetIndex: 0 } }
    expect(restEndAnnouncement(n, name)).toBe('Descanso terminado. Siguiente: Remo, serie 1 de 3.')
  })
})
