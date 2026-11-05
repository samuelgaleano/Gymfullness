import { describe, expect, it } from 'vitest'
import type { BodyLog, Exercise, SetLog, Unit, WorkoutSession } from './types'
import {
  bodySeries,
  e1rm,
  exerciseHistory,
  muscleSets,
  personalRecords,
  sessionDurationSec,
  startOfWeek,
  streak,
  summarizeSession,
  weeklyStats,
} from './stats'
import { toDateKey } from './date'

/* Local-time fixed dates: Thursday 5 Nov 2026, 10:00 (week starts Monday 2 Nov). */
const at = (y: number, m: number, d: number, h = 10, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const NOW = at(2026, 11, 5)
const DAY = 86_400_000

function ex(id: string, patch: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name: id,
    aliases: [],
    primary: 'chest',
    secondary: [],
    equipment: ['barbell'],
    kind: 'weight_reps',
    level: 'beginner',
    isCompound: true,
    defaultRestSec: 120,
    increment: 2.5,
    setup: [],
    cues: [],
    mistakes: [],
    ...patch,
  }
}
const LIB: Record<string, Exercise> = {
  bench: ex('bench', { name: 'Press de banca', primary: 'chest', secondary: ['triceps', 'shoulders'] }),
  row: ex('row', { name: 'Remo', primary: 'back', secondary: ['biceps'] }),
  pullup: ex('pullup', { name: 'Dominadas', primary: 'back', secondary: ['biceps'], kind: 'reps' }),
  plank: ex('plank', { name: 'Plancha', primary: 'core', kind: 'time' }),
}
const getExercise = (id: string) => LIB[id]

let n = 0
type S = Partial<SetLog> & { w?: number | null; r?: number | null }
const set = ({ w = null, r = null, ...rest }: S): SetLog => ({ id: `s${++n}`, weight: w, reps: r, done: true, ...rest })

function session(
  startedAt: number,
  entries: Record<string, S[]> | [string, S[]][],
  opts: { unit?: Unit; minutes?: number; extra?: Partial<WorkoutSession> } = {},
): WorkoutSession {
  const list = Array.isArray(entries) ? entries : Object.entries(entries)
  return {
    id: `w${++n}`,
    name: 'Día A',
    unit: opts.unit ?? 'kg',
    startedAt,
    endedAt: startedAt + (opts.minutes ?? 60) * 60_000,
    cursor: { ex: 0, set: 0 },
    updatedAt: startedAt,
    exercises: list.map(([exerciseId, sets]) => ({
      id: `se${++n}`,
      exerciseId,
      target: { sets: sets.length, repsMin: 8, repsMax: 12, restSec: 90 },
      sets: sets.map(set),
    })),
    ...opts.extra,
  }
}

describe('e1rm', () => {
  it('Epley: w × (1 + reps/30); 1 rep → weight; null when not computable', () => {
    expect(e1rm(100, 10)).toBeCloseTo(133.333, 3)
    expect(e1rm(80, 1)).toBe(80)
    expect(e1rm(null, 10)).toBeNull()
    expect(e1rm(100, null)).toBeNull()
    expect(e1rm(undefined, 5)).toBeNull()
    expect(e1rm(0, 5)).toBeNull()
    expect(e1rm(100, 0)).toBeNull()
    expect(e1rm(-5, 5)).toBeNull()
  })
})

describe('summarizeSession', () => {
  const s = session(
    NOW,
    [
      ['bench', [{ w: 40, r: 10, isWarmup: true }, { w: 80, r: 10 }, { w: 80, r: 8, isPR: true }, { w: 80, r: 6, done: false }]],
      ['pullup', [{ r: 10 }, { r: 8 }]],
      ['plank', [{ seconds: 45 }]],
      ['ghost-move', [{ w: 10, r: 10 }]],
      ['row', [{ w: 50, r: 10, done: false }]],
    ],
    { minutes: 52 },
  )
  const sum = summarizeSession(s, getExercise)

  it('counts working sets only (no warm-ups, no undone sets)', () => {
    expect(sum.totalSets).toBe(6) // bench 2, pullup 2, plank 1, ghost 1
    expect(sum.totalReps).toBe(10 + 8 + 10 + 8 + 10)
    expect(sum.durationSec).toBe(52 * 60)
    expect(sum).toMatchObject({ sessionId: s.id, name: 'Día A', unit: 'kg', startedAt: NOW, endedAt: NOW + 52 * 60_000 })
  })

  it('volume = Σ weight × reps of working sets; time sets add none', () => {
    expect(sum.volume).toBe(80 * 10 + 80 * 8 + 10 * 10)
    const bench = sum.exercises.find((e) => e.exerciseId === 'bench')!
    expect(bench.volume).toBe(1440)
    expect(bench.sets).toEqual([
      { weight: 80, reps: 10 },
      { weight: 80, reps: 8, isPR: true },
    ])
    expect(bench.bestE1rm).toBeCloseTo(106.7, 1)
    const plank = sum.exercises.find((e) => e.exerciseId === 'plank')!
    expect(plank.sets[0].seconds).toBe(45)
    expect(plank.volume).toBe(0)
  })

  it('skips exercises without working sets and names unknown ones', () => {
    expect(sum.exercises.map((e) => e.exerciseId)).toEqual(['bench', 'pullup', 'plank', 'ghost-move'])
    expect(sum.exercises[3].name).toBe('Ghost move')
    expect(sum.exercises[0].name).toBe('Press de banca')
  })

  it('PRs come from isPR flags, one per exercise (the best)', () => {
    const pr = session(NOW, {
      bench: [
        { w: 80, r: 8, isPR: true },
        { w: 82.5, r: 8, isPR: true },
        { w: 82.5, r: 6 },
      ],
      pullup: [{ r: 12, isPR: true }],
    })
    const out = summarizeSession(pr, getExercise)
    expect(out.prs).toHaveLength(2)
    expect(out.prs[0]).toMatchObject({ exerciseId: 'bench', name: 'Press de banca', weight: 82.5, reps: 8, e1rm: 104.5 })
    expect(out.prs[1]).toMatchObject({ exerciseId: 'pullup', weight: null, reps: 12, e1rm: null })
  })

  it('muscles: primary 1, secondary 0.5 per working set', () => {
    expect(sum.muscles).toEqual({ chest: 2, triceps: 1, shoulders: 1, back: 2, biceps: 1, core: 1 })
  })

  it('without endedAt the duration runs to the last completed set', () => {
    const open = session(NOW, { bench: [{ w: 80, r: 8, completedAt: NOW + 20 * 60_000 }] }, { extra: { endedAt: null } })
    expect(sessionDurationSec(open)).toBe(20 * 60)
    expect(summarizeSession(open, getExercise).durationSec).toBe(20 * 60)
  })
})

describe('exerciseHistory', () => {
  it('one point per session with the exercise, oldest → newest, converted to the unit', () => {
    const sessions = [
      session(NOW - 2 * DAY, { bench: [{ w: 85, r: 5 }, { w: 80, r: 8 }] }),
      session(NOW - 9 * DAY, { bench: [{ w: 176, r: 8 }] }, { unit: 'lb' }),
      session(NOW - 5 * DAY, { row: [{ w: 50, r: 10 }] }),
      session(NOW - 1 * DAY, { bench: [{ w: 200, r: 1 }] }, { extra: { deleted: true } }),
      session(NOW - 3 * DAY, { bench: [{ w: 60, r: 5, isWarmup: true }] }),
    ]
    const pts = exerciseHistory(sessions, 'bench', 'kg')
    expect(pts.map((p) => p.date)).toEqual([NOW - 9 * DAY, NOW - 2 * DAY])
    expect(pts[0].bestWeight).toBeCloseTo(79.8, 1)
    expect(pts[1]).toMatchObject({ bestWeight: 85, bestReps: 8, sets: 2, volume: 85 * 5 + 80 * 8 })
    expect(pts[1].bestE1rm).toBeCloseTo(101.3, 1)
  })
})

describe('personalRecords', () => {
  it('best e1RM / weight / reps per exercise, dated when first reached, newest first', () => {
    const sessions = [
      session(NOW - 20 * DAY, { bench: [{ w: 80, r: 10 }], pullup: [{ r: 8 }] }),
      session(NOW - 10 * DAY, { bench: [{ w: 90, r: 3 }] }), // heavier but lower e1RM (99)
      session(NOW - 5 * DAY, { bench: [{ w: 80, r: 10 }], pullup: [{ r: 11 }] }), // ties e1RM, more pull-ups
      session(NOW - 2 * DAY, { plank: [{ seconds: 60 }] }),
    ]
    const prs = personalRecords(sessions, 'kg')
    expect(prs.map((p) => p.exerciseId)).toEqual(['pullup', 'bench'])
    const bench = prs.find((p) => p.exerciseId === 'bench')!
    expect(bench).toMatchObject({ bestWeight: 90, bestReps: 10, bestE1rm: 106.7, date: NOW - 20 * DAY })
    expect(prs.find((p) => p.exerciseId === 'pullup')).toMatchObject({ bestReps: 11, bestE1rm: null, date: NOW - 5 * DAY })
  })

  it('converts records to the requested unit', () => {
    const prs = personalRecords([session(NOW, { bench: [{ w: 100, r: 1 }] })], 'lb')
    expect(prs[0].bestWeight).toBeCloseTo(220.5, 1)
    expect(prs[0].bestE1rm).toBeCloseTo(220.5, 1)
  })
})

describe('weeklyStats', () => {
  it('weeks start on Monday (local), oldest → newest, including the current week', () => {
    expect(toDateKey(startOfWeek(NOW))).toBe('2026-11-02')
    expect(toDateKey(startOfWeek(at(2026, 11, 8, 23, 30)))).toBe('2026-11-02') // Sunday night
    expect(toDateKey(startOfWeek(at(2026, 11, 9, 0, 5)))).toBe('2026-11-09') // Monday
    const sessions = [
      session(at(2026, 11, 2, 7), { bench: [{ w: 100, r: 5 }, { w: 100, r: 5 }] }, { minutes: 45 }),
      session(at(2026, 11, 4, 19), { row: [{ w: 50, r: 10 }] }, { minutes: 30 }),
      session(at(2026, 11, 1, 18), { bench: [{ w: 225, r: 5 }] }, { unit: 'lb', minutes: 60 }), // Sunday → previous week
      session(at(2026, 10, 1, 18), { bench: [{ w: 60, r: 5 }] }), // too old
      session(at(2026, 11, 3, 18), { bench: [{ w: 60, r: 5 }] }, { extra: { deleted: true } }),
    ]
    const weeks = weeklyStats(sessions, 4, 'kg', NOW)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02'])
    expect(weeks[3]).toEqual({ weekStart: '2026-11-02', sessions: 2, sets: 3, volume: 1500, minutes: 75 })
    expect(weeks[2]).toMatchObject({ sessions: 1, sets: 1, minutes: 60 })
    expect(weeks[2].volume).toBeCloseTo(510.3, 1)
    expect(weeks[0]).toEqual({ weekStart: '2026-10-12', sessions: 0, sets: 0, volume: 0, minutes: 0 })
    expect(weeklyStats(sessions, 0, 'kg', NOW)).toEqual([])
  })
})

describe('streak', () => {
  const s = (ts: number) => session(ts, { bench: [{ w: 60, r: 8 }] })

  it('counts consecutive weeks ending this week', () => {
    const list = [s(at(2026, 11, 3)), s(at(2026, 11, 4)), s(at(2026, 10, 28)), s(at(2026, 10, 20)), s(at(2026, 10, 1))]
    expect(streak(list, NOW)).toEqual({ weeks: 3, thisWeek: 2, total: 5 })
  })

  it('ends last week when this week has no session yet', () => {
    const list = [s(at(2026, 10, 28)), s(at(2026, 10, 21))]
    expect(streak(list, NOW)).toEqual({ weeks: 2, thisWeek: 0, total: 2 })
  })

  it('is 0 when neither this week nor last week has a session; ignores deleted', () => {
    const del = session(at(2026, 11, 3), { bench: [{ w: 60, r: 8 }] }, { extra: { deleted: true } })
    expect(streak([s(at(2026, 10, 14)), del], NOW)).toEqual({ weeks: 0, thisWeek: 0, total: 1 })
    expect(streak([], NOW)).toEqual({ weeks: 0, thisWeek: 0, total: 0 })
  })
})

describe('muscleSets', () => {
  it('working sets per muscle in the last N days (primary 1, secondary 0.5)', () => {
    const list = [
      session(NOW - 2 * DAY, { bench: [{ w: 80, r: 8 }, { w: 80, r: 8 }, { w: 40, r: 8, isWarmup: true }] }),
      session(NOW - 3 * DAY, { pullup: [{ r: 8 }, { r: 8 }, { r: 8 }], unknown: [{ w: 1, r: 1 }] }),
      session(NOW - 10 * DAY, { row: [{ w: 60, r: 10 }] }),
    ]
    expect(muscleSets(list, getExercise, 7, NOW)).toEqual({ chest: 2, triceps: 1, shoulders: 1, back: 3, biceps: 1.5 })
    expect(muscleSets(list, getExercise, 14, NOW).back).toBe(4)
  })
})

describe('bodySeries', () => {
  const log = (date: string, patch: Partial<BodyLog>): BodyLog => ({ id: date, date, unit: 'kg', updatedAt: 1, ...patch })

  it('oldest → newest, skips missing values and deleted logs, converts weight', () => {
    const logs = [
      log('2026-11-03', { weight: 80, waist: 84 }),
      log('2026-10-01', { weight: 176.4, unit: 'lb' }),
      log('2026-10-15', { waist: 86, weight: null }),
      log('2026-10-20', { weight: 81, deleted: true }),
    ]
    expect(bodySeries(logs, 'weight', 'kg')).toEqual([
      { date: '2026-10-01', value: 80 },
      { date: '2026-11-03', value: 80 },
    ])
    expect(bodySeries(logs, 'weight', 'lb')[1]).toEqual({ date: '2026-11-03', value: 176.4 })
    expect(bodySeries(logs, 'waist', 'lb')).toEqual([
      { date: '2026-10-15', value: 86 },
      { date: '2026-11-03', value: 84 },
    ])
    expect(bodySeries(logs, 'neck', 'kg')).toEqual([])
  })
})
