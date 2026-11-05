import { describe, expect, it } from 'vitest'
import type { Exercise, Routine, RoutineItem, SessionExercise, SetLog, Unit, WorkoutSession } from '../types'
import {
  FREE_WORKOUT_NAME,
  addExercise,
  addSet,
  adjustRest,
  createSession,
  endRest,
  finishSession,
  getCursorInfo,
  logSet,
  moveExercise,
  removeSet,
  setCursor,
  skipExercise,
  startRest,
  suggestProgression,
  suggestTarget,
  swapExercise,
  undoLastSet,
  updateSet,
} from './engine'

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const T0 = Date.UTC(2026, 10, 5, 15, 0, 0) // fixed "now"
const DAY = 86_400_000

function exercise(id: string, patch: Partial<Exercise> = {}): Exercise {
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
  bench: exercise('bench', { name: 'Press de banca', defaultRestSec: 150 }),
  row: exercise('row', { name: 'Remo', primary: 'back', defaultRestSec: 120 }),
  curl: exercise('curl', { name: 'Curl', primary: 'biceps', equipment: ['dumbbell'], increment: 2, defaultRestSec: 75 }),
  pullup: exercise('pullup', { name: 'Dominadas', primary: 'back', kind: 'reps', equipment: ['pullup_bar'], increment: 0 }),
  plank: exercise('plank', { name: 'Plancha', primary: 'core', kind: 'time', equipment: ['bodyweight'], increment: 0, defaultRestSec: 60 }),
  treadmill: exercise('treadmill', { name: 'Cinta', primary: 'cardio', kind: 'time', equipment: ['machine'], increment: 0, defaultRestSec: 60 }),
}
const getExercise = (id: string) => LIB[id]

let seq = 0
const sid = (p: string) => `${p}${++seq}`

function item(exerciseId: string, patch: Partial<RoutineItem> = {}): RoutineItem {
  return { id: sid('ri_'), exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSec: 90, ...patch }
}

function routine(items: RoutineItem[], name = 'Día A · Empuje'): Routine {
  return { id: 'r_1', name, items, createdAt: T0 - 30 * DAY, updatedAt: T0 - 30 * DAY }
}

type SetSpec = [weight: number | null, reps: number | null] | { w?: number | null; r?: number | null; s?: number | null; warmup?: boolean }

function toSet(spec: SetSpec, t: number): SetLog {
  if (Array.isArray(spec)) return { id: sid('s_'), weight: spec[0], reps: spec[1], done: true, completedAt: t }
  const set: SetLog = { id: sid('s_'), weight: spec.w ?? null, reps: spec.r ?? null, done: true, completedAt: t }
  if (spec.s !== undefined) set.seconds = spec.s
  if (spec.warmup) set.isWarmup = true
  return set
}

/** A completed past session. */
function past(
  startedAt: number,
  entries: { id: string; sets: SetSpec[]; targetSeconds?: number }[],
  unit: Unit = 'kg',
  extra: Partial<WorkoutSession> = {},
): WorkoutSession {
  return {
    id: sid('w_'),
    name: 'Pasada',
    unit,
    startedAt,
    endedAt: startedAt + 3600_000,
    cursor: { ex: 0, set: 0 },
    rest: null,
    updatedAt: startedAt + 3600_000,
    exercises: entries.map((e) => ({
      id: sid('se_'),
      exerciseId: e.id,
      target: { sets: e.sets.length, repsMin: 8, repsMax: 12, restSec: 90, targetSeconds: e.targetSeconds },
      sets: e.sets.map((s, i) => toSet(s, startedAt + i * 60_000)),
    })),
    ...extra,
  }
}

function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o)
    for (const v of Object.values(o as Record<string, unknown>)) deepFreeze(v)
  }
  return o
}

/** A fresh session: bench 3×, row 3×, curl 2× (no history → weights null). */
function threeExercises(): WorkoutSession {
  return createSession(
    routine([item('bench', { restSec: 150 }), item('row', { restSec: 120 }), item('curl', { sets: 2, restSec: 60 })]),
    getExercise,
    [],
    'kg',
    T0,
  )
}

/** Log `n` sets in a row at the cursor (values: prefilled), with increasing timestamps. */
function logN(s: WorkoutSession, n: number, history: WorkoutSession[] = [], start = T0 + 60_000): WorkoutSession {
  let cur = s
  for (let i = 0; i < n; i++) cur = logSet(cur, { weight: 50, reps: 10 }, history, start + i * 60_000).session
  return cur
}

const BENCH_RANGE = { repsMin: 8, repsMax: 12 }

/* ------------------------------------------------------------------ */
/* suggestProgression                                                  */
/* ------------------------------------------------------------------ */

describe('suggestProgression', () => {
  it('first time: no weight, middle of the range, a hint to leave reps in reserve', () => {
    const s = suggestProgression([], 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s.weight).toBeNull()
    expect(s.reps).toBe(10)
    expect(s.reason).toBe('Primera vez: elige un peso que te deje 2 reps en reserva')
  })

  it('all working sets at repsMax at the top weight → + increment, reps back to repsMin', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 12], [80, 12], [80, 12]] }])]
    const s = suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s).toEqual({ weight: 82.5, reps: 8, reason: 'Hiciste 12 reps en todas: sube a 82.5 kg' })
  })

  it('best set below repsMin → keep the weight and aim for repsMin', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 7], [80, 6], [80, 5]] }])]
    const s = suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s).toEqual({ weight: 80, reps: 8, reason: 'Mantén 80 kg y busca 8 reps' })
  })

  it('inside the range → same weight, one more rep than the top set', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 10], [80, 9], [80, 8]] }])]
    const s = suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s).toEqual({ weight: 80, reps: 11, reason: 'Intenta 1 rep más que la última vez' })
  })

  it('top set already at repsMax but not every set → hold the weight, cap at repsMax', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 12], [80, 12], [80, 10]] }])]
    const s = suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s.weight).toBe(80)
    expect(s.reps).toBe(12)
  })

  it('a lighter back-off set blocks the jump (every working set must be at the top weight)', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 12], [80, 12], [70, 12]] }])]
    expect(suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg').weight).toBe(80)
  })

  it('two sessions in a row missing repsMin at the same weight → deload ~10%', () => {
    const h = [
      past(T0 - 6 * DAY, [{ id: 'bench', sets: [[100, 6], [100, 5]] }]),
      past(T0 - 3 * DAY, [{ id: 'bench', sets: [[100, 7], [100, 5]] }]),
    ]
    const s = suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')
    expect(s.weight).toBe(90)
    expect(s.reps).toBe(8)
    expect(s.reason).toContain('Baja un poco y recupera técnica')
  })

  it('no deload when the previous miss was at a different weight', () => {
    const h = [
      past(T0 - 6 * DAY, [{ id: 'bench', sets: [[97.5, 6]] }]),
      past(T0 - 3 * DAY, [{ id: 'bench', sets: [[100, 7]] }]),
    ]
    expect(suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')).toMatchObject({ weight: 100, reps: 8 })
  })

  it('uses the most recent session even when history is unsorted, and ignores deleted ones', () => {
    const h = [
      past(T0 - 1 * DAY, [{ id: 'bench', sets: [[200, 12]] }], 'kg', { deleted: true }),
      past(T0 - 3 * DAY, [{ id: 'bench', sets: [[85, 9]] }]),
      past(T0 - 9 * DAY, [{ id: 'bench', sets: [[80, 12]] }]),
    ]
    expect(suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')).toMatchObject({ weight: 85, reps: 10 })
  })

  it('ignores warm-up sets', () => {
    const h = [
      past(T0 - 3 * DAY, [{ id: 'bench', sets: [{ w: 40, r: 5, warmup: true }, [80, 12], [80, 12]] }]),
    ]
    expect(suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg').weight).toBe(82.5)
  })

  it('converts lb history to kg and rounds to a loadable increment', () => {
    // 180 lb = 81.6 kg → 82.5 kg loadable, +2.5 → 85
    const h = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[180, 12], [180, 12]] }], 'lb')]
    expect(suggestProgression(h, 'bench', BENCH_RANGE, LIB.bench, 'kg')).toMatchObject({ weight: 85, reps: 8 })
  })

  it('converts kg history to lb (5 lb plates) and progresses +5 lb', () => {
    const hold = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 10]] }])]
    expect(suggestProgression(hold, 'bench', BENCH_RANGE, LIB.bench, 'lb')).toMatchObject({ weight: 175, reps: 11 })
    const up = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[100, 12], [100, 12]] }])]
    const s = suggestProgression(up, 'bench', BENCH_RANGE, LIB.bench, 'lb')
    expect(s.weight).toBe(225) // 220.46 → 220 → +5
    expect(s.reason).toBe('Hiciste 12 reps en todas: sube a 225 lb')
  })

  it('uses the exercise increment (dumbbells +2 kg)', () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'curl', sets: [[14, 12], [14, 12]] }])]
    expect(suggestProgression(h, 'curl', BENCH_RANGE, LIB.curl, 'kg').weight).toBe(16)
  })

  it("'reps' exercises progress reps only", () => {
    const h = [past(T0 - 3 * DAY, [{ id: 'pullup', sets: [[null, 9], [null, 8]] }])]
    expect(suggestProgression(h, 'pullup', BENCH_RANGE, LIB.pullup, 'kg')).toEqual({
      weight: null,
      reps: 10,
      reason: 'Intenta 1 rep más que la última vez',
    })
    const maxed = [past(T0 - 3 * DAY, [{ id: 'pullup', sets: [[null, 12], [null, 12]] }])]
    expect(suggestProgression(maxed, 'pullup', BENCH_RANGE, LIB.pullup, 'kg')).toMatchObject({ weight: null, reps: 13 })
    expect(suggestProgression([], 'pullup', BENCH_RANGE, LIB.pullup, 'kg').reason).toContain('Primera vez')
  })

  it("'time' exercises progress seconds (+5 s for holds, +60 s for cardio)", () => {
    const ok = [past(T0 - 3 * DAY, [{ id: 'plank', sets: [{ s: 30 }, { s: 32 }], targetSeconds: 30 }])]
    expect(suggestTarget(ok, 'plank', { repsMin: 0, repsMax: 0, targetSeconds: 30 }, LIB.plank, 'kg')).toMatchObject({
      weight: null,
      reps: null,
      seconds: 35,
    })
    const missed = [past(T0 - 3 * DAY, [{ id: 'plank', sets: [{ s: 35 }, { s: 20 }], targetSeconds: 35 }])]
    expect(suggestTarget(missed, 'plank', { repsMin: 0, repsMax: 0, targetSeconds: 30 }, LIB.plank, 'kg').seconds).toBe(35)
    const run = [past(T0 - 3 * DAY, [{ id: 'treadmill', sets: [{ s: 600 }], targetSeconds: 600 }])]
    expect(suggestTarget(run, 'treadmill', { repsMin: 0, repsMax: 0, targetSeconds: 600 }, LIB.treadmill, 'kg').seconds).toBe(660)
    // suggestProgression keeps the public 3-field shape
    expect(Object.keys(suggestProgression(ok, 'plank', { repsMin: 0, repsMax: 0 }, LIB.plank, 'kg')).sort()).toEqual([
      'reason',
      'reps',
      'weight',
    ])
  })
})

/* ------------------------------------------------------------------ */
/* createSession                                                       */
/* ------------------------------------------------------------------ */

describe('createSession', () => {
  it('builds one exercise per routine item with pre-created, prefilled, undone sets', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 10], [80, 9]] }])]
    const r = routine([item('bench', { sets: 4, restSec: 150, note: 'Agarre medio' }), item('row')])
    const s = createSession(r, getExercise, history, 'kg', T0)
    expect(s.id.startsWith('w_')).toBe(true)
    expect(s).toMatchObject({ name: 'Día A · Empuje', routineId: 'r_1', unit: 'kg', startedAt: T0, cursor: { ex: 0, set: 0 }, rest: null })
    expect(s.exercises).toHaveLength(2)
    const bench = s.exercises[0]
    expect(bench.routineItemId).toBe(r.items[0].id)
    expect(bench.note).toBe('Agarre medio')
    expect(bench.target).toMatchObject({ sets: 4, repsMin: 8, repsMax: 12, restSec: 150, weight: 80 })
    expect(bench.target.reason).toBe('Intenta 1 rep más que la última vez')
    expect(bench.sets).toHaveLength(4)
    for (const set of bench.sets) expect(set).toMatchObject({ weight: 80, reps: 11, done: false })
    expect(new Set(bench.sets.map((x) => x.id)).size).toBe(4)
    // row has no history
    expect(s.exercises[1].sets[0]).toMatchObject({ weight: null, reps: 10, done: false })
  })

  it('free workout: empty, named "Entreno libre"', () => {
    const s = createSession(null, getExercise, [], 'lb', T0)
    expect(s.name).toBe(FREE_WORKOUT_NAME)
    expect(s.routineId).toBeNull()
    expect(s.exercises).toEqual([])
    expect(s.unit).toBe('lb')
  })

  it("prefill per kind: 'reps' → no weight, 'time' → seconds = (progressed) target, no reps", () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'plank', sets: [{ s: 40 }, { s: 40 }], targetSeconds: 40 }])]
    const s = createSession(
      routine([item('pullup', { repsMin: 6, repsMax: 10 }), item('plank', { repsMin: 0, repsMax: 0, targetSeconds: 40 })]),
      getExercise,
      history,
      'kg',
      T0,
    )
    expect(s.exercises[0].sets[0]).toMatchObject({ weight: null, reps: 8 })
    expect(s.exercises[0].target.weight).toBeNull()
    const plank = s.exercises[1]
    expect(plank.target.targetSeconds).toBe(45)
    expect(plank.sets[0]).toMatchObject({ weight: null, reps: null, seconds: 45, done: false })
  })

  it('keeps items whose exercise is unknown (e.g. a deleted custom exercise)', () => {
    const s = createSession(routine([item('ghost')]), getExercise, [], 'kg', T0)
    expect(s.exercises[0].exerciseId).toBe('ghost')
    expect(s.exercises[0].sets).toHaveLength(3)
  })
})

/* ------------------------------------------------------------------ */
/* logSet                                                              */
/* ------------------------------------------------------------------ */

describe('logSet', () => {
  it('logs the prefilled values at the cursor and advances to the next set', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 10]] }])]
    const s0 = startRest(createSession(routine([item('bench', { restSec: 150 })]), getExercise, history, 'kg', T0), 60, T0)
    const res = logSet(deepFreeze(s0), {}, history, T0 + 5000)
    const set = res.session.exercises[0].sets[0]
    expect(set).toMatchObject({ weight: 80, reps: 11, done: true, completedAt: T0 + 5000, source: 'tap' })
    expect(res.session.cursor).toEqual({ ex: 0, set: 1 })
    expect(res.restSec).toBe(150)
    expect(res.session.rest).toBeNull()
    expect(res.exerciseCompleted).toBe(false)
    expect(res.workoutCompleted).toBe(false)
    // input untouched
    expect(s0.exercises[0].sets[0].done).toBe(false)
  })

  it('uses provided values (undefined keeps the prefill) and the given source', () => {
    const s0 = threeExercises()
    const res = logSet(s0, { reps: 9, rpe: 8, source: 'voice' }, [], T0)
    expect(res.session.exercises[0].sets[0]).toMatchObject({ weight: null, reps: 9, rpe: 8, source: 'voice', done: true })
  })

  it('a weight change carries over to the remaining undone sets only', () => {
    let s = threeExercises()
    s = logSet(s, { weight: 60, reps: 10 }, [], T0).session
    s = logSet(s, { weight: 62.5 }, [], T0 + 1).session
    const sets = s.exercises[0].sets
    expect(sets[0].weight).toBe(60) // done set untouched
    expect(sets[1].weight).toBe(62.5)
    expect(sets[2]).toMatchObject({ weight: 62.5, done: false })
    // other exercises untouched
    expect(s.exercises[1].sets[0].weight).toBeNull()
  })

  it('does not overwrite later sets when the weight is not given or unchanged', () => {
    let s = threeExercises()
    s = updateSet(s, 0, 2, { weight: 70 })
    s = logSet(s, { reps: 10 }, [], T0).session
    expect(s.exercises[0].sets[2].weight).toBe(70)
  })

  it('advances across exercises when one is completed', () => {
    let s = threeExercises()
    s = logN(s, 2)
    const res = logSet(s, {}, [], T0 + 10 * 60_000)
    expect(res.exerciseCompleted).toBe(true)
    expect(res.session.cursor).toEqual({ ex: 1, set: 0 })
    expect(res.restSec).toBe(150) // rest of the exercise just finished
  })

  it('skips skipped exercises when advancing', () => {
    let s = skipExercise(threeExercises(), 1)
    s = logN(s, 3)
    expect(s.cursor).toEqual({ ex: 2, set: 0 })
  })

  it('wraps to earlier unfinished exercises', () => {
    let s = setCursor(threeExercises(), 2) // start with curls
    s = logN(s, 2)
    expect(s.cursor).toEqual({ ex: 0, set: 0 })
  })

  it('within an exercise, wraps to an earlier undone set when logging out of order', () => {
    const s = logSet(threeExercises(), { exIndex: 0, setIndex: 2, weight: 50, reps: 10 }, [], T0).session
    expect(s.cursor).toEqual({ ex: 0, set: 0 })
  })

  it('exIndex alone targets the first undone set of that exercise and un-skips it', () => {
    const s0 = skipExercise(threeExercises(), 1)
    const res = logSet(s0, { exIndex: 1, weight: 40, reps: 12 }, [], T0)
    expect(res.session.exercises[1].skipped).toBeUndefined()
    expect(res.session.exercises[1].sets[0].done).toBe(true)
    expect(res.session.cursor).toEqual({ ex: 1, set: 1 })
  })

  it('the very last set completes the workout: no rest and the cursor stays', () => {
    let s = threeExercises()
    s = logN(s, 7)
    expect(s.cursor).toEqual({ ex: 2, set: 1 })
    const res = logSet(s, {}, [], T0 + 3600_000)
    expect(res.workoutCompleted).toBe(true)
    expect(res.exerciseCompleted).toBe(true)
    expect(res.restSec).toBe(0)
    expect(res.session.cursor).toEqual({ ex: 2, set: 1 })
    expect(getCursorInfo(res.session).isFinished).toBe(true)
  })

  it('editing an already-done set updates it without moving the cursor or restarting rest', () => {
    let s = threeExercises()
    s = logSet(s, { weight: 50, reps: 10 }, [], T0).session
    s = startRest(s, 90, T0 + 1000)
    const res = logSet(s, { exIndex: 0, setIndex: 0, reps: 12 }, [], T0 + 5000)
    const set = res.session.exercises[0].sets[0]
    expect(set).toMatchObject({ reps: 12, weight: 50, done: true, completedAt: T0 })
    expect(res.session.cursor).toEqual({ ex: 0, set: 1 })
    expect(res.restSec).toBe(0)
    expect(res.session.rest).toEqual(s.rest)
  })

  it('beyond the last set it appends a new set (e.g. an extra set by voice)', () => {
    const s = logSet(threeExercises(), { exIndex: 2, setIndex: 2, weight: 12, reps: 12 }, [], T0).session
    expect(s.exercises[2].sets).toHaveLength(3)
    expect(s.exercises[2].sets[2]).toMatchObject({ weight: 12, reps: 12, done: true })
  })

  it('out-of-range exercise is a safe no-op', () => {
    const s = threeExercises()
    const res = logSet(s, { exIndex: 9 }, [], T0)
    expect(res.session).toBe(s)
    expect(res.restSec).toBe(0)
  })
})

describe('logSet · PR detection', () => {
  const r = () => routine([item('bench', { sets: 3 })])

  it('the first time ever is never a PR', () => {
    const s = createSession(r(), getExercise, [], 'kg', T0)
    const res = logSet(s, { weight: 100, reps: 10 }, [], T0)
    expect(res.isPR).toBe(false)
    expect(res.session.exercises[0].sets[0].isPR).toBeUndefined()
  })

  it('beating the best e1RM in history is a PR; matching it is not', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 10]] }])] // e1RM 106.7
    const s = createSession(r(), getExercise, history, 'kg', T0)
    expect(logSet(s, { weight: 80, reps: 10 }, history, T0).isPR).toBe(false)
    const res = logSet(s, { weight: 82.5, reps: 10 }, history, T0)
    expect(res.isPR).toBe(true)
    expect(res.session.exercises[0].sets[0].isPR).toBe(true)
  })

  it('must also beat earlier sets of this session', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[80, 8]] }])]
    let s = createSession(r(), getExercise, history, 'kg', T0)
    const first = logSet(s, { weight: 85, reps: 8 }, history, T0)
    expect(first.isPR).toBe(true)
    s = first.session
    const second = logSet(s, { weight: 85, reps: 8 }, history, T0 + 1)
    expect(second.isPR).toBe(false)
    const third = logSet(second.session, { weight: 85, reps: 9 }, history, T0 + 2)
    expect(third.isPR).toBe(true)
  })

  it('compares history logged in another unit', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[225, 5]] }], 'lb')] // ≈ 102 kg × 5
    const s = createSession(r(), getExercise, history, 'kg', T0)
    expect(logSet(s, { weight: 100, reps: 5 }, history, T0).isPR).toBe(false)
    expect(logSet(s, { weight: 105, reps: 5 }, history, T0).isPR).toBe(true)
  })

  it("'reps' exercises: more reps than ever", () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'pullup', sets: [[null, 8], [null, 7]] }])]
    const s = createSession(routine([item('pullup')]), getExercise, history, 'kg', T0)
    expect(logSet(s, { reps: 8 }, history, T0).isPR).toBe(false)
    expect(logSet(s, { reps: 9 }, history, T0).isPR).toBe(true)
  })

  it('a warm-up set is never a PR', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[60, 5]] }])]
    const s = updateSet(createSession(r(), getExercise, history, 'kg', T0), 0, 0, { isWarmup: true })
    expect(logSet(s, { weight: 100, reps: 5 }, history, T0).isPR).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* undo / update / add / remove                                        */
/* ------------------------------------------------------------------ */

describe('undoLastSet', () => {
  it('reverts the most recent done set (by completedAt), keeps its values and moves the cursor to it', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[50, 8]] }])]
    let s = threeExercises()
    s = logSet(s, { weight: 60, reps: 10 }, history, T0 + 1000).session
    s = logSet(s, { exIndex: 2, setIndex: 0, weight: 14, reps: 12 }, history, T0 + 3000).session
    s = logSet(s, { exIndex: 0, setIndex: 1, weight: 60, reps: 9 }, history, T0 + 2000).session
    s = startRest(s, 90, T0 + 3000)
    const u = undoLastSet(deepFreeze(s))
    const reverted = u.exercises[2].sets[0]
    expect(reverted).toMatchObject({ weight: 14, reps: 12, done: false })
    expect(reverted.completedAt).toBeUndefined()
    expect(reverted.isPR).toBeUndefined()
    expect(u.cursor).toEqual({ ex: 2, set: 0 })
    expect(u.rest).toBeNull()
    expect(u.exercises[0].sets[1].done).toBe(true)
  })

  it('clears the PR flag and is a no-op when nothing is done', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'bench', sets: [[50, 8]] }])]
    const s = logSet(threeExercises(), { weight: 100, reps: 8 }, history, T0).session
    expect(s.exercises[0].sets[0].isPR).toBe(true)
    expect(undoLastSet(s).exercises[0].sets[0].isPR).toBeUndefined()
    const fresh = threeExercises()
    expect(undoLastSet(fresh)).toBe(fresh)
  })
})

describe('updateSet / addSet / removeSet', () => {
  it('updateSet patches one set and nothing else', () => {
    const s = threeExercises()
    const u = updateSet(deepFreeze(s), 1, 2, { weight: 42, rpe: 7 })
    expect(u.exercises[1].sets[2]).toMatchObject({ weight: 42, rpe: 7, id: s.exercises[1].sets[2].id })
    expect(u.cursor).toEqual(s.cursor)
    expect(u.exercises[0]).toBe(s.exercises[0])
    expect(updateSet(s, 9, 0, { weight: 1 })).toBe(s)
  })

  it("addSet clones the last set's weight/reps as an undone set", () => {
    let s = threeExercises()
    s = updateSet(s, 2, 1, { weight: 16, reps: 11 })
    const u = addSet(deepFreeze(s), 2)
    expect(u.exercises[2].sets).toHaveLength(3)
    expect(u.exercises[2].sets[2]).toMatchObject({ weight: 16, reps: 11, done: false })
    expect(u.cursor).toEqual(s.cursor)
  })

  it('addSet after the workout is finished moves the cursor to the new set', () => {
    let s = threeExercises()
    s = logN(s, 8)
    expect(getCursorInfo(s).isFinished).toBe(true)
    const u = addSet(s, 0)
    expect(u.cursor).toEqual({ ex: 0, set: 3 })
    expect(getCursorInfo(u).isFinished).toBe(false)
  })

  it('removeSet keeps the cursor on the same set (and the rest preview in sync)', () => {
    let s = threeExercises()
    s = logN(s, 2) // cursor → ex 0 set 2
    s = startRest(s, 60, T0)
    const before = removeSet(s, 0, 0)
    expect(before.exercises[0].sets).toHaveLength(2)
    expect(before.cursor).toEqual({ ex: 0, set: 1 })
    expect(before.rest).toMatchObject({ nextExIndex: 0, nextSetIndex: 1 })
    const atCursor = removeSet(s, 0, 2) // remove the set the user was about to do
    expect(atCursor.cursor).toEqual({ ex: 1, set: 0 })
    expect(atCursor.rest).toMatchObject({ nextExIndex: 1, nextSetIndex: 0 })
  })
})

/* ------------------------------------------------------------------ */
/* skip / swap / add / move / setCursor                                */
/* ------------------------------------------------------------------ */

describe('skipExercise', () => {
  it('marks it skipped and moves the cursor to the next unfinished exercise', () => {
    const s = skipExercise(deepFreeze(threeExercises()), 0)
    expect(s.exercises[0].skipped).toBe(true)
    expect(s.cursor).toEqual({ ex: 1, set: 0 })
    const info = getCursorInfo(s)
    expect(info.totalSessionSets).toBe(5) // 3 + 2, skipped bench excluded
  })

  it('skipping a partially done exercise keeps its done sets in the progress', () => {
    let s = logN(threeExercises(), 1)
    s = skipExercise(s, 0)
    const info = getCursorInfo(s)
    expect(info.doneSets).toBe(1)
    expect(info.totalSessionSets).toBe(6)
  })
})

describe('swapExercise', () => {
  it('without done sets: replaces in place and re-prefills for the new exercise and kind', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'pullup', sets: [[null, 9]] }])]
    const s = threeExercises()
    const u = swapExercise(deepFreeze(s), 1, 'pullup', getExercise, history)
    const se = u.exercises[1]
    expect(se.id).toBe(s.exercises[1].id)
    expect(se.exerciseId).toBe('pullup')
    expect(se.swappedFrom).toBe('row')
    expect(se.sets).toHaveLength(3)
    for (const set of se.sets) expect(set).toMatchObject({ weight: null, reps: 10, done: false })
    expect(se.target.reason).toBe('Intenta 1 rep más que la última vez')
    expect(u.exercises).toHaveLength(3)
  })

  it('swapping to a hold gives seconds; swapping back to the original clears swappedFrom', () => {
    const s = swapExercise(threeExercises(), 0, 'plank', getExercise, [])
    expect(s.exercises[0].sets[0]).toMatchObject({ weight: null, reps: null, seconds: 30 })
    expect(s.exercises[0].target.targetSeconds).toBe(30)
    const back = swapExercise(s, 0, 'bench', getExercise, [])
    expect(back.exercises[0].swappedFrom).toBeUndefined()
    expect(back.exercises[0].target.targetSeconds).toBeUndefined()
    expect(back.exercises[0].sets[0]).toMatchObject({ reps: 10 })
  })

  it('with done sets: keeps them and inserts the new exercise right after with the remaining sets', () => {
    const s = logN(threeExercises(), 1) // bench: 1 done, 2 left
    const u = swapExercise(s, 0, 'curl', getExercise, [])
    expect(u.exercises).toHaveLength(4)
    expect(u.exercises[0].exerciseId).toBe('bench')
    expect(u.exercises[0].sets).toHaveLength(1)
    expect(u.exercises[0].sets[0].done).toBe(true)
    const inserted = u.exercises[1]
    expect(inserted).toMatchObject({ exerciseId: 'curl', swappedFrom: 'bench' })
    expect(inserted.sets).toHaveLength(2)
    expect(inserted.sets.every((x) => !x.done)).toBe(true)
    expect(u.exercises[2].exerciseId).toBe('row')
    expect(u.cursor).toEqual({ ex: 1, set: 0 })
  })
})

describe('addExercise', () => {
  it('appends 3 sets of 8–12 with the exercise rest, prefilled from history', () => {
    const history = [past(T0 - 3 * DAY, [{ id: 'curl', sets: [[12, 10]] }])]
    const s = threeExercises()
    const u = addExercise(deepFreeze(s), 'curl', getExercise, history, 90)
    const se = u.exercises[3]
    expect(se.target).toMatchObject({ sets: 3, repsMin: 8, repsMax: 12, restSec: 75, weight: 12 })
    expect(se.sets.map((x) => [x.weight, x.reps, x.done])).toEqual([
      [12, 11, false],
      [12, 11, false],
      [12, 11, false],
    ])
    expect(u.cursor).toEqual(s.cursor)
  })

  it('after finishing everything (or on an empty free workout) the cursor jumps to it', () => {
    const free = createSession(null, getExercise, [], 'kg', T0)
    const a = addExercise(free, 'bench', getExercise, [], 90)
    expect(a.cursor).toEqual({ ex: 0, set: 0 })
    expect(getCursorInfo(a).exercise?.exerciseId).toBe('bench')
    const done = logN(threeExercises(), 8)
    const b = addExercise(done, 'row', getExercise, [], 90)
    expect(b.cursor).toEqual({ ex: 3, set: 0 })
  })

  it('unknown exercise uses the default rest; time exercises get seconds', () => {
    const s = createSession(null, getExercise, [], 'kg', T0)
    expect(addExercise(s, 'mystery', getExercise, [], 75).exercises[0].target.restSec).toBe(75)
    const plank = addExercise(s, 'plank', getExercise, [], 75).exercises[0]
    expect(plank.target).toMatchObject({ sets: 3, targetSeconds: 30, restSec: 60 })
    expect(plank.sets[0]).toMatchObject({ seconds: 30, reps: null, weight: null })
    const run = addExercise(s, 'treadmill', getExercise, [], 75).exercises[0]
    expect(run.sets).toHaveLength(1)
    expect(run.sets[0].seconds).toBe(600)
  })
})

describe('moveExercise / setCursor', () => {
  it('moveExercise reorders and keeps the cursor on the same exercise', () => {
    let s = logN(threeExercises(), 1) // cursor ex 0 set 1
    s = startRest(s, 60, T0)
    const u = moveExercise(deepFreeze(s), 0, 2)
    expect(u.exercises.map((e) => e.exerciseId)).toEqual(['row', 'curl', 'bench'])
    expect(u.cursor).toEqual({ ex: 2, set: 1 })
    expect(u.rest).toMatchObject({ nextExIndex: 2, nextSetIndex: 1 })
    expect(moveExercise(s, 1, 1)).toBe(s)
  })

  it('setCursor clamps, picks the first undone set and un-skips', () => {
    let s = logN(threeExercises(), 1)
    s = skipExercise(s, 1)
    expect(setCursor(s, 0).cursor).toEqual({ ex: 0, set: 1 })
    const toSkipped = setCursor(s, 1)
    expect(toSkipped.cursor).toEqual({ ex: 1, set: 0 })
    expect(toSkipped.exercises[1].skipped).toBeUndefined()
    expect(setCursor(s, 99, 99).cursor).toEqual({ ex: 2, set: 1 })
    expect(setCursor(s, -3, 1).cursor).toEqual({ ex: 0, set: 1 })
  })
})

/* ------------------------------------------------------------------ */
/* rest                                                                */
/* ------------------------------------------------------------------ */

describe('rest', () => {
  it('startRest stores timestamps and leads into the cursor', () => {
    const s = logN(threeExercises(), 1)
    const r = startRest(s, 90, T0).rest
    expect(r).toEqual({ startedAt: T0, endsAt: T0 + 90_000, durationSec: 90, nextExIndex: 0, nextSetIndex: 1 })
    expect(startRest(startRest(s, 90, T0), 0, T0).rest).toBeNull()
  })

  it('adjustRest moves endsAt but never before now + 1 s; durationSec ≥ 1', () => {
    const s = startRest(threeExercises(), 60, T0)
    const plus = adjustRest(s, 15, T0 + 10_000)
    expect(plus.rest).toMatchObject({ endsAt: T0 + 75_000, durationSec: 75 })
    const minus = adjustRest(s, -15, T0 + 10_000)
    expect(minus.rest).toMatchObject({ endsAt: T0 + 45_000, durationSec: 45 })
    const clamped = adjustRest(s, -120, T0 + 50_000)
    expect(clamped.rest).toMatchObject({ endsAt: T0 + 51_000, durationSec: 1 })
    // +15 s after it already ran out → 15 s from now
    expect(adjustRest(s, 15, T0 + 100_000).rest?.endsAt).toBe(T0 + 115_000)
    const none = threeExercises()
    expect(adjustRest(none, 15, T0)).toBe(none)
  })

  it('endRest clears it', () => {
    const s = startRest(threeExercises(), 60, T0)
    expect(endRest(s).rest).toBeNull()
  })
})

/* ------------------------------------------------------------------ */
/* finish & cursor info                                                */
/* ------------------------------------------------------------------ */

describe('finishSession', () => {
  it('sets endedAt, clears rest, drops undone sets and exercises without done sets', () => {
    let s = logN(threeExercises(), 4) // bench 3/3, row 1/3, curl 0/2
    s = startRest(s, 60, T0)
    const f = finishSession(deepFreeze(s), T0 + 3600_000)
    expect(f.endedAt).toBe(T0 + 3600_000)
    expect(f.rest).toBeNull()
    expect(f.exercises.map((e) => [e.exerciseId, e.sets.length])).toEqual([
      ['bench', 3],
      ['row', 1],
    ])
    expect(f.exercises.flatMap((e) => e.sets).every((x: SetLog) => x.done)).toBe(true)
  })
})

describe('getCursorInfo', () => {
  it('at the start: set 1 of 3, next is set 2, no progress', () => {
    const info = getCursorInfo(threeExercises())
    expect(info).toMatchObject({
      exIndex: 0,
      setIndex: 0,
      setNumber: 1,
      totalSets: 3,
      progress: 0,
      doneSets: 0,
      totalSessionSets: 8,
      isLastSetOfExercise: false,
      isFinished: false,
    })
    expect(info.exercise?.exerciseId).toBe('bench')
    expect(info.next).toMatchObject({ exIndex: 0, setIndex: 1 })
  })

  it('on the last set of an exercise, next points at the following exercise', () => {
    const info = getCursorInfo(logN(threeExercises(), 2))
    expect(info.isLastSetOfExercise).toBe(true)
    expect(info.setNumber).toBe(3)
    expect(info.next?.exIndex).toBe(1)
    expect((info.next?.exercise as SessionExercise).exerciseId).toBe('row')
    expect(info.progress).toBeCloseTo(2 / 8)
  })

  it('finished and empty sessions', () => {
    const done = getCursorInfo(logN(threeExercises(), 8))
    expect(done).toMatchObject({ isFinished: true, next: null, progress: 1, doneSets: 8 })
    const empty = getCursorInfo(createSession(null, getExercise, [], 'kg', T0))
    expect(empty).toMatchObject({ exercise: null, isFinished: true, progress: 0, totalSets: 0, next: null })
  })
})
