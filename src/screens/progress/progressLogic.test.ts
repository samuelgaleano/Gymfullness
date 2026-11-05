import { describe, expect, it } from 'vitest'
import type { Exercise, WorkoutSession } from '@/lib/types'
import {
  balanceInsight,
  balanceStatus,
  compactNumber,
  deltaOver,
  deltaTone,
  exerciseRows,
  exerciseSeries,
  filterExerciseRows,
  filterRange,
  groupByMonth,
  lastDelta,
  metricsFor,
  muscleBalance,
  recentLines,
  setsByDay,
  weekBars,
} from './progressLogic'

const NOW = new Date(2026, 10, 5, 12).getTime()
const DAY = 86_400_000
const key = (daysAgo: number) => {
  const d = new Date(NOW - daysAgo * DAY)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function session(id: string, daysAgo: number, exerciseId: string, sets: { weight?: number; reps?: number; seconds?: number }[]): WorkoutSession {
  const startedAt = NOW - daysAgo * DAY
  return {
    id,
    name: 'Día A',
    unit: 'kg',
    startedAt,
    endedAt: startedAt + 3_000_000,
    exercises: [
      {
        id: `${id}-e`,
        exerciseId,
        target: { sets: sets.length, repsMin: 5, repsMax: 8, restSec: 90 },
        sets: sets.map((s, i) => ({ id: `${id}-s${i}`, weight: s.weight ?? null, reps: s.reps ?? null, seconds: s.seconds, done: true })),
      },
    ],
    cursor: { ex: 0, set: 0 },
    updatedAt: startedAt,
  }
}

const EX: Record<string, Exercise> = {
  'bench-press': { id: 'bench-press', name: 'Press de banca', kind: 'weight_reps' } as Exercise,
  plank: { id: 'plank', name: 'Plancha', kind: 'time' } as Exercise,
  'pull-up': { id: 'pull-up', name: 'Dominadas', kind: 'reps' } as Exercise,
}
const get = (id: string) => EX[id]

describe('body helpers', () => {
  const series = [
    { date: key(100), value: 80 },
    { date: key(40), value: 78 },
    { date: key(31), value: 77.5 },
    { date: key(2), value: 76 },
  ]
  it('filters by range and keeps all for "all"', () => {
    expect(filterRange(series, '1M', NOW)).toHaveLength(1)
    expect(filterRange(series, '3M', NOW)).toHaveLength(3)
    expect(filterRange(series, '6M', NOW)).toHaveLength(4)
    expect(filterRange(series, 'all', NOW)).toHaveLength(4)
  })
  it('delta vs ~30 days ago uses the latest log on/before the cutoff', () => {
    expect(deltaOver(series, 30, NOW)).toEqual({ current: 76, delta: -1.5, days: 29 })
  })
  it('falls back to the oldest log when it is at least a week old, else null', () => {
    expect(deltaOver([{ date: key(10), value: 70 }, { date: key(1), value: 71 }], 30, NOW)?.delta).toBe(1)
    expect(deltaOver([{ date: key(3), value: 70 }, { date: key(1), value: 71 }], 30, NOW)).toBeNull()
    expect(deltaOver([{ date: key(3), value: 70 }], 30, NOW)).toBeNull()
  })
  it('lastDelta compares with the previous value', () => {
    expect(lastDelta(series)).toBe(-1.5)
    expect(lastDelta([series[0]])).toBeNull()
  })
  it('colors only goal-aligned moves and is never negative', () => {
    expect(deltaTone('fat_loss', -1)).toBe('good')
    expect(deltaTone('fat_loss', 1)).toBe('neutral')
    expect(deltaTone('muscle', 1)).toBe('good')
    expect(deltaTone(undefined, -1)).toBe('neutral')
    expect(deltaTone('muscle', 0)).toBe('neutral')
  })
})

describe('muscle balance', () => {
  it('classifies under / ok / over', () => {
    expect(balanceStatus(2, 10)).toBe('under')
    expect(balanceStatus(6, 10)).toBe('ok')
    expect(balanceStatus(10, 10)).toBe('ok')
    expect(balanceStatus(16, 10)).toBe('over')
  })
  it('covers every target muscle', () => {
    const rows = muscleBalance({ chest: 16, back: 3 })
    expect(rows.find((r) => r.muscle === 'chest')?.status).toBe('over')
    expect(rows.find((r) => r.muscle === 'back')?.status).toBe('under')
    expect(rows.length).toBeGreaterThanOrEqual(8)
  })
  it('insight: empty week, balanced week, weakest muscle', () => {
    expect(balanceInsight(muscleBalance({}))).toMatch(/Entrena esta semana/)
    const balanced = muscleBalance({ back: 10, chest: 10, quads: 10, hamstrings: 8, glutes: 8, shoulders: 8, core: 6, triceps: 6, biceps: 6, calves: 6, forearms: 4 })
    expect(balanceInsight(balanced)).toMatch(/Buen reparto/)
    const lopsided = muscleBalance({ back: 10, chest: 10, quads: 1, hamstrings: 8, glutes: 8, shoulders: 8, core: 6, triceps: 6, biceps: 6, calves: 6, forearms: 4 })
    expect(balanceInsight(lopsided)).toMatch(/cuádriceps/)
  })
})

describe('weeks & history', () => {
  it('weekBars highlights the current (last) week', () => {
    const bars = weekBars(
      [
        { weekStart: '2026-10-26', sessions: 3, sets: 20, volume: 9000, minutes: 150 },
        { weekStart: '2026-11-02', sessions: 1, sets: 8, volume: 3000, minutes: 50 },
      ],
      'sessions',
    )
    expect(bars.map((b) => b.value)).toEqual([3, 1])
    expect(bars[0].label).toBe('26 oct')
    expect(bars[1].highlight).toBe(true)
    expect(bars[0].highlight).toBe(false)
  })
  it('compactNumber', () => {
    expect(compactNumber(900)).toBe('900')
    expect(compactNumber(12400)).toBe('12,4k')
  })
  it('setsByDay sums working sets per local day', () => {
    const a = session('a', 0, 'bench-press', [{ weight: 50, reps: 5 }])
    const b = session('b', 0, 'bench-press', [{ weight: 50, reps: 5 }])
    expect(setsByDay([a, b])[key(0)]).toBe(2)
  })
  it('groups by month, newest first', () => {
    const items = [{ startedAt: new Date(2026, 9, 3).getTime() }, { startedAt: new Date(2026, 10, 2).getTime() }, { startedAt: new Date(2026, 10, 4).getTime() }, { startedAt: new Date(2025, 11, 4).getTime() }]
    const g = groupByMonth(items, NOW)
    expect(g.map((x) => x.label)).toEqual(['Noviembre', 'Octubre', 'Diciembre 2025'])
    expect(g[0].items[0].startedAt).toBeGreaterThan(g[0].items[1].startedAt)
  })
})

describe('exercise views', () => {
  const sessions = [
    session('s1', 30, 'bench-press', [{ weight: 60, reps: 8 }, { weight: 60, reps: 8 }]),
    session('s2', 20, 'bench-press', [{ weight: 65, reps: 8 }]),
    session('s3', 10, 'bench-press', [{ weight: 70, reps: 6 }]),
    session('s4', 5, 'plank', [{ seconds: 45 }, { seconds: 60 }]),
    session('s5', 3, 'pull-up', [{ reps: 8 }, { reps: 10 }]),
  ]
  it('offers sensible metrics per kind', () => {
    expect(metricsFor('weight_reps')).toEqual(['e1rm', 'weight', 'volume', 'reps'])
    expect(metricsFor('time')).toEqual(['seconds'])
    expect(metricsFor('reps')).toEqual(['reps'])
  })
  it('series per metric', () => {
    expect(exerciseSeries(sessions, 'bench-press', 'weight', 'kg').map((p) => p.y)).toEqual([60, 65, 70])
    expect(exerciseSeries(sessions, 'bench-press', 'volume', 'kg').map((p) => p.y)).toEqual([960, 520, 420])
    expect(exerciseSeries(sessions, 'plank', 'seconds', 'kg').map((p) => p.y)).toEqual([60])
    expect(exerciseSeries(sessions, 'pull-up', 'reps', 'kg').map((p) => p.y)).toEqual([10])
    expect(exerciseSeries(sessions, 'nothing', 'e1rm', 'kg')).toEqual([])
  })
  it('rows are sorted by recency with headline metrics', () => {
    const rows = exerciseRows(sessions, 'kg', get)
    expect(rows.map((r) => r.id)).toEqual(['pull-up', 'plank', 'bench-press'])
    const bench = rows.find((r) => r.id === 'bench-press')!
    expect(bench.metric).toBe('e1rm')
    expect(bench.sessions).toBe(3)
    expect(bench.spark).toHaveLength(3)
    expect(bench.best).toBeGreaterThanOrEqual(bench.spark[0])
    expect(rows.find((r) => r.id === 'plank')!.metric).toBe('seconds')
  })
  it('search ignores accents and case', () => {
    const rows = exerciseRows(sessions, 'kg', get)
    expect(filterExerciseRows(rows, 'PRESS').map((r) => r.id)).toEqual(['bench-press'])
    expect(filterExerciseRows(rows, 'dominada')).toHaveLength(1)
    expect(filterExerciseRows(rows, '')).toHaveLength(3)
    expect(filterExerciseRows(rows, 'zzz')).toHaveLength(0)
  })
  it('recentLines lists newest first with the best set', () => {
    const lines = recentLines(sessions, 'bench-press', 'kg', 2)
    expect(lines).toHaveLength(2)
    expect(lines[0].best).toBe('70 × 6')
    expect(lines[1].sets).toBe(1)
  })
})
