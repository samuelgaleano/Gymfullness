/**
 * Reviewer edge cases for the workout engine: invariants under sequences of edits,
 * cursor/rest consistency, unit handling and copy.
 */
import { describe, expect, it } from 'vitest'
import type { Exercise, Routine, RoutineItem, SetLog, Unit, WorkoutSession } from '../types'
import {
  addExercise,
  addSet,
  adjustRest,
  createSession,
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
} from './engine'

const T0 = Date.UTC(2026, 10, 5, 15, 0, 0)
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
  bench: exercise('bench', { defaultRestSec: 150 }),
  row: exercise('row', { primary: 'back' }),
  curl: exercise('curl', { primary: 'biceps', equipment: ['dumbbell'], increment: 2, defaultRestSec: 75 }),
  pullup: exercise('pullup', { primary: 'back', kind: 'reps', equipment: ['pullup_bar'], increment: 0 }),
  plank: exercise('plank', { primary: 'core', kind: 'time', equipment: ['bodyweight'], increment: 0, defaultRestSec: 60 }),
  bike: exercise('bike', { primary: 'cardio', kind: 'time', equipment: ['machine'], increment: 0, defaultRestSec: 60 }),
  lateral: exercise('lateral', { primary: 'shoulders', equipment: ['dumbbell'], increment: 1 }),
}
const getExercise = (id: string) => LIB[id]

let seq = 0
const sid = (p: string) => `${p}${++seq}`

function item(exerciseId: string, patch: Partial<RoutineItem> = {}): RoutineItem {
  return { id: sid('ri_'), exerciseId, sets: 3, repsMin: 8, repsMax: 12, restSec: 90, ...patch }
}
function routine(items: RoutineItem[]): Routine {
  return { id: 'r_1', name: 'Día A', items, createdAt: T0, updatedAt: T0 }
}

function past(
  startedAt: number,
  entries: { id: string; sets: Partial<SetLog>[]; targetSeconds?: number }[],
  unit: Unit = 'kg',
): WorkoutSession {
  return {
    id: sid('w_'),
    name: 'Pasada',
    unit,
    startedAt,
    endedAt: startedAt + 3600_000,
    cursor: { ex: 0, set: 0 },
    rest: null,
    updatedAt: startedAt,
    exercises: entries.map((e) => ({
      id: sid('se_'),
      exerciseId: e.id,
      target: { sets: e.sets.length, repsMin: 8, repsMax: 12, restSec: 90, targetSeconds: e.targetSeconds },
      sets: e.sets.map((s, i) => ({ id: sid('s_'), weight: null, reps: null, done: true, completedAt: startedAt + i, ...s })),
    })),
  }
}

const three = () =>
  createSession(routine([item('bench'), item('row'), item('curl', { sets: 2 })]), getExercise, [], 'kg', T0)

/** Invariant: while work remains the cursor is on an undone set of a non-skipped exercise. */
function expectCursorOnWork(s: WorkoutSession) {
  const info = getCursorInfo(s)
  if (info.isFinished) return
  const se = s.exercises[s.cursor.ex]
  expect(se).toBeDefined()
  expect(se.skipped).toBeFalsy()
  expect(se.sets[s.cursor.set]).toBeDefined()
  expect(se.sets[s.cursor.set].done).toBe(false)
  if (s.rest) expect([s.rest.nextExIndex, s.rest.nextSetIndex]).toEqual([s.cursor.ex, s.cursor.set])
}

describe('cursor invariant under random edit sequences', () => {
  it('holds after many mixed operations (deterministic pseudo-random)', () => {
    let rnd = 42
    const next = (n: number) => {
      rnd = (rnd * 1103515245 + 12345) % 2 ** 31
      return rnd % n
    }
    for (let run = 0; run < 40; run++) {
      let s = startRest(three(), 60, T0)
      let t = T0
      let parked = false
      for (let step = 0; step < 40; step++) {
        const n = s.exercises.length
        const ex = n ? next(n) : 0
        const len = s.exercises[ex]?.sets.length ?? 0
        const op = next(10)
        t += 1000
        if (op === 0) s = logSet(s, { weight: 50 + next(5), reps: 8 + next(4) }, [], t).session
        else if (op === 1) s = skipExercise(s, ex)
        else if (op === 2) s = addSet(s, ex)
        else if (op === 3 && len) s = removeSet(s, ex, next(len))
        else if (op === 4) s = moveExercise(s, ex, next(Math.max(1, n)))
        else if (op === 5) s = undoLastSet(s)
        else if (op === 6) s = swapExercise(s, ex, ['bench', 'row', 'curl', 'pullup', 'plank'][next(5)], getExercise, [])
        else if (op === 7) s = addExercise(s, ['bench', 'pullup', 'plank'][next(3)], getExercise, [], 90)
        else if (op === 8) s = setCursor(s, ex)
        else s = startRest(s, 30, t)
        // setCursor may deliberately park on a finished set (review / edit); until the cursor is back
        // on pending work, only require that it points at a real set.
        const e = s.exercises[s.cursor.ex]
        const onPending = !!e && !e.skipped && e.sets[s.cursor.set]?.done === false
        if (op === 8 && !onPending) parked = true
        if (parked) {
          expect(e?.sets.length ? e.sets[s.cursor.set] : true).toBeDefined()
          if (onPending) parked = false
        } else expectCursorOnWork(s)
      }
    }
  })
})

describe('logSet edge cases', () => {
  it('a no-op (bad index, empty free workout) never reports a completed workout', () => {
    const free = createSession(null, getExercise, [], 'kg', T0)
    const res = logSet(free, {}, [], T0)
    expect(res.session).toBe(free)
    expect(res.workoutCompleted).toBe(false)
    expect(res.exerciseCompleted).toBe(false)
    expect(logSet(three(), { exIndex: 0, setIndex: -1 }, [], T0).workoutCompleted).toBe(false)
  })

  it('logging with only exIndex = cursor exercise logs the cursor set', () => {
    let s = logSet(three(), { weight: 50, reps: 10 }, [], T0).session
    s = logSet(s, { exIndex: 0, weight: 50, reps: 9 }, [], T0 + 1).session
    expect(s.exercises[0].sets.map((x) => x.done)).toEqual([true, true, false])
  })

  it('negative / NaN values are cleaned to null; rpe is clamped', () => {
    const res = logSet(three(), { weight: -5, reps: Number.NaN, rpe: 14 }, [], T0)
    expect(res.session.exercises[0].sets[0]).toMatchObject({ weight: null, reps: null, rpe: 10 })
  })

  it('propagates a weight change to undone sets only for the exercise, also from an edit of the latest set', () => {
    let s = logSet(three(), { weight: 60, reps: 10 }, [], T0).session
    // fix the weight of the set just logged (user misspoke) → remaining sets follow
    s = logSet(s, { exIndex: 0, setIndex: 0, weight: 65 }, [], T0 + 1).session
    expect(s.exercises[0].sets.map((x) => x.weight)).toEqual([65, 65, 65])
    // editing an OLDER set does not touch the plan
    s = logSet(s, { weight: 65, reps: 9 }, [], T0 + 2).session
    s = logSet(s, { exIndex: 0, setIndex: 0, weight: 40 }, [], T0 + 3).session
    expect(s.exercises[0].sets.map((x) => x.weight)).toEqual([40, 65, 65])
  })

  it('time exercises log seconds (prefill kept when omitted)', () => {
    const s = createSession(routine([item('plank', { targetSeconds: 40, repsMin: 0, repsMax: 0 })]), getExercise, [], 'kg', T0)
    const a = logSet(s, {}, [], T0).session
    expect(a.exercises[0].sets[0]).toMatchObject({ seconds: 40, reps: null, weight: null, done: true })
    const b = logSet(a, { seconds: 52 }, [], T0 + 1).session
    expect(b.exercises[0].sets[1].seconds).toBe(52)
  })

  it('time PR: longer hold than ever (not the first time)', () => {
    const h = [past(T0 - DAY, [{ id: 'plank', sets: [{ seconds: 40 }], targetSeconds: 40 }])]
    const s = createSession(routine([item('plank', { targetSeconds: 40, repsMin: 0, repsMax: 0 })]), getExercise, h, 'kg', T0)
    expect(logSet(s, { seconds: 40 }, h, T0).isPR).toBe(false)
    expect(logSet(s, { seconds: 50 }, h, T0).isPR).toBe(true)
  })

  it('editing a set to a lower value removes its PR flag', () => {
    const h = [past(T0 - DAY, [{ id: 'bench', sets: [{ weight: 80, reps: 8 }] }])]
    let s = createSession(routine([item('bench')]), getExercise, h, 'kg', T0)
    s = logSet(s, { weight: 90, reps: 8 }, h, T0).session
    expect(s.exercises[0].sets[0].isPR).toBe(true)
    s = logSet(s, { exIndex: 0, setIndex: 0, weight: 70 }, h, T0 + 1).session
    expect(s.exercises[0].sets[0].isPR).toBeUndefined()
  })
})

describe('progression edge cases', () => {
  it('deload never suggests 0 kg for very light loads', () => {
    const h = [
      past(T0 - 6 * DAY, [{ id: 'lateral', sets: [{ weight: 2, reps: 5 }] }]),
      past(T0 - 3 * DAY, [{ id: 'lateral', sets: [{ weight: 2, reps: 5 }] }]),
    ]
    const s = suggestProgression(h, 'lateral', { repsMin: 8, repsMax: 12 }, LIB.lateral, 'kg')
    expect(s.weight).toBeGreaterThan(0)
  })

  it('uses the most recent session with the exercise even if a newer session lacks it', () => {
    const h = [
      past(T0 - 6 * DAY, [{ id: 'bench', sets: [{ weight: 80, reps: 9 }] }]),
      past(T0 - 1 * DAY, [{ id: 'row', sets: [{ weight: 60, reps: 9 }] }]),
    ]
    expect(suggestProgression(h, 'bench', { repsMin: 8, repsMax: 12 }, LIB.bench, 'kg')).toMatchObject({ weight: 80, reps: 10 })
  })

  it('a reps range given in reverse order or as zeros still works', () => {
    expect(suggestProgression([], 'bench', { repsMin: 12, repsMax: 8 }, LIB.bench, 'kg').reps).toBe(10)
    expect(suggestProgression([], 'bench', { repsMin: 0, repsMax: 0 }, LIB.bench, 'kg').reps).toBe(10)
  })

  it('lb session in lb history keeps the exact logged weight (no rounding when units match)', () => {
    const h = [past(T0 - DAY, [{ id: 'bench', sets: [{ weight: 177, reps: 9 }] }], 'lb')]
    expect(suggestProgression(h, 'bench', { repsMin: 8, repsMax: 12 }, LIB.bench, 'lb').weight).toBe(177)
  })

  it('time exercise missed target: hold seconds, Spanish reason', () => {
    const h = [past(T0 - DAY, [{ id: 'plank', sets: [{ seconds: 30 }, { seconds: 20 }], targetSeconds: 30 }])]
    const t = suggestTarget(h, 'plank', { repsMin: 0, repsMax: 0, targetSeconds: 30 }, LIB.plank, 'kg')
    expect(t.seconds).toBe(30)
    expect(t.reason).toMatch(/30 s/)
  })

  it('a time exercise logged without seconds is not treated as "Primera vez"', () => {
    const h = [past(T0 - DAY, [{ id: 'plank', sets: [{ reps: 1 }], targetSeconds: 30 }])]
    const t = suggestTarget(h, 'plank', { repsMin: 0, repsMax: 0, targetSeconds: 30 }, LIB.plank, 'kg')
    expect(t.seconds).toBe(30)
    expect(t.reason).not.toMatch(/Primera vez/)
  })
})

describe('structural edits', () => {
  it('removing every set of the cursor exercise moves on to the next one', () => {
    let s = three()
    s = removeSet(s, 0, 0)
    s = removeSet(s, 0, 0)
    s = removeSet(s, 0, 0)
    expect(s.exercises[0].sets).toHaveLength(0)
    expect(s.cursor).toEqual({ ex: 1, set: 0 })
    expect(getCursorInfo(s).totalSessionSets).toBe(5)
  })

  it('skip the last unfinished exercise → finished; addSet on it brings it back', () => {
    let s = three()
    for (let i = 0; i < 6; i++) s = logSet(s, { weight: 50, reps: 10 }, [], T0 + i).session
    s = skipExercise(s, 2)
    expect(getCursorInfo(s).isFinished).toBe(true)
    s = addSet(s, 2)
    expect(s.exercises[2].skipped).toBeUndefined()
    expect(getCursorInfo(s).isFinished).toBe(false)
    expectCursorOnWork(s)
  })

  it('swap with done sets keeps the rest preview pointing at the inserted exercise', () => {
    let s = logSet(three(), { weight: 50, reps: 10 }, [], T0).session
    s = startRest(s, 60, T0)
    s = swapExercise(s, 0, 'curl', getExercise, [])
    expect(s.rest).toMatchObject({ nextExIndex: 1, nextSetIndex: 0 })
  })

  it('swap of a future exercise (no done sets) keeps the cursor where it is', () => {
    const s = logSet(three(), { weight: 50, reps: 10 }, [], T0).session
    const u = swapExercise(s, 2, 'pullup', getExercise, [])
    expect(u.cursor).toEqual({ ex: 0, set: 1 })
  })

  it('swap of a future exercise WITH done sets keeps the cursor on the current exercise', () => {
    let s = three()
    // user logs a curl set out of order, then comes back to bench
    s = logSet(s, { exIndex: 2, setIndex: 0, weight: 12, reps: 12 }, [], T0).session
    s = setCursor(s, 0)
    s = logSet(s, { weight: 50, reps: 10 }, [], T0 + 1).session
    const u = swapExercise(s, 2, 'lateral', getExercise, [])
    // the user is still on bench: swapping curls for laterals must not yank them away
    expect(u.exercises[u.cursor.ex].exerciseId).toBe('bench')
    expect(u.cursor.set).toBe(1)
  })

  it('moveExercise keeps the rest preview in sync', () => {
    let s = logSet(three(), { weight: 50, reps: 10 }, [], T0).session
    s = startRest(s, 60, T0)
    s = moveExercise(s, 2, 0)
    expect(s.exercises[s.cursor.ex].exerciseId).toBe('bench')
    expect(s.rest).toMatchObject({ nextExIndex: s.cursor.ex, nextSetIndex: s.cursor.set })
  })

  it('adjustRest durationSec stays coherent with the timestamps', () => {
    const s = startRest(three(), 60, T0)
    const a = adjustRest(s, 15, T0 + 1000).rest!
    expect(a.durationSec * 1000).toBe(a.endsAt - a.startedAt)
  })

  it('finishSession on an untouched session leaves no exercises', () => {
    expect(finishSession(three(), T0 + 1).exercises).toEqual([])
  })
})
