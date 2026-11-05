/**
 * Workout engine — PURE functions over WorkoutSession (no React, no store, no Date.now()
 * unless `now` is defaulted). The store calls these and persists the result.
 *
 * Invariants kept by every transform:
 * - Inputs are never mutated; a new session object is returned (or the same one for no-ops).
 * - `cursor` points at the next set to do (an undone set of a non-skipped exercise) while the
 *   workout has work left; once everything is done it stays on the last logged set.
 * - When a rest is running, `rest.nextExIndex/nextSetIndex` mirror the cursor (the rest leads
 *   into the cursor), so structural edits re-sync it.
 */
import type {
  CursorInfo,
  Exercise,
  ExerciseKind,
  LogSetInput,
  LogSetResult,
  ProgressionSuggestion,
  Routine,
  RoutineItem,
  SessionExercise,
  SessionTarget,
  SetLog,
  Unit,
  WorkoutSession,
} from '../types'
import { uid } from '../id'
import { convertWeight, formatWeight } from '../units'
import { e1rm } from '../stats'

export const FREE_WORKOUT_NAME = 'Entreno libre'

/** Default rep range for exercises added on the fly (weight_reps & reps kinds). */
export const DEFAULT_REPS: Readonly<{ min: number; max: number }> = { min: 8, max: 12 }
/** Default hold for 'time' exercises (plancha, wall sit…) and for steady cardio machines. */
export const DEFAULT_HOLD_SEC = 30
export const DEFAULT_CARDIO_SEC = 600

const EPS = 1e-6

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

const round2 = (n: number) => Math.round(n * 100) / 100
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const isPos = (v: number | null | undefined): v is number => isNum(v) && v > 0
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const toIndex = (n: number) => (isNum(n) ? Math.trunc(n) : 0)
const sameNum = (a: number | null | undefined, b: number | null | undefined) =>
  (a ?? null) === (b ?? null) || (isNum(a) && isNum(b) && Math.abs(a - b) < EPS)

/** Clean a user-entered number: null when missing/invalid/negative. */
function cleanNum(v: number | null | undefined, integer: boolean): number | null {
  if (!isNum(v) || v < 0) return null
  return integer ? Math.round(v) : round2(v)
}

/** "30 s", "1 min 30 s", "10 min". */
export function formatSeconds(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m} min ${r} s` : `${m} min`
}

const fmtLoad = (w: number, unit: Unit) => `${formatWeight(w)} ${unit}`

function kindOf(exercise: Exercise | undefined, targetSeconds?: number): ExerciseKind {
  if (exercise) return exercise.kind
  return isPos(targetSeconds) ? 'time' : 'weight_reps'
}

/** Treadmill, bike, rower… (minutes, one long set). */
function isSteadyCardio(exercise: Exercise | undefined): boolean {
  return !!exercise && exercise.kind === 'time' && exercise.primary === 'cardio' && exercise.equipment.includes('machine')
}

/**
 * Smallest load jump you can really put on the bar/machine, also used as the progression step.
 * kg → the exercise increment (2.5 barbell, 2 dumbbells, 5 machines); lb → 5 lb.
 */
export function loadStep(exercise: Exercise | undefined, unit: Unit): number {
  if (unit === 'lb') return 5
  return exercise && exercise.increment > 0 ? exercise.increment : 2.5
}

const roundToStep = (v: number, step: number) => round2(Math.round(v / step) * step)

/** A set's weight expressed in `to` — rounded to a loadable step when it had to be converted. */
function weightIn(set: SetLog, from: Unit, to: Unit, step: number | null): number | null {
  if (!isNum(set.weight)) return null
  if (from === to) return set.weight
  const v = convertWeight(set.weight, from, to)
  return step ? roundToStep(v, step) : v
}

const isWorking = (s: SetLog) => s.done && !s.isWarmup
const firstUndone = (se: SessionExercise) => se.sets.findIndex((s) => !s.done)

function sessionFinished(exercises: SessionExercise[]): boolean {
  return exercises.every((se) => se.skipped || se.sets.every((s) => s.done))
}

/** True when no undone sets remain in non-skipped exercises (an empty session counts as finished). */
export function isSessionFinished(session: WorkoutSession): boolean {
  return sessionFinished(session.exercises)
}

interface Pos {
  ex: number
  set: number
}

/**
 * Next undone set starting from (ex, set): the same exercise first (after `set`, then wrapping
 * to earlier sets), then the following exercises, wrapping to earlier unfinished ones.
 * `inclusive` also accepts (ex, set) itself.
 */
function findNext(exercises: SessionExercise[], ex: number, set: number, inclusive: boolean): Pos | null {
  const n = exercises.length
  if (!n) return null
  const cur = exercises[ex]
  if (cur && !cur.skipped) {
    const len = cur.sets.length
    const start = inclusive ? set : set + 1
    for (let i = Math.max(0, start); i < len; i++) if (!cur.sets[i].done) return { ex, set: i }
    for (let i = 0; i < Math.min(len, set); i++) if (!cur.sets[i].done) return { ex, set: i }
  }
  for (let k = 1; k <= n; k++) {
    const j = (((ex + k) % n) + n) % n
    if (j === ex && cur) break
    const se = exercises[j]
    if (se.skipped) continue
    const f = firstUndone(se)
    if (f >= 0) return { ex: j, set: f }
  }
  return null
}

/** Keep the cursor valid: on an undone set if any work is left, else clamped in range. */
function normalizeCursor(exercises: SessionExercise[], cursor: Pos): Pos {
  const n = exercises.length
  if (!n) return { ex: 0, set: 0 }
  const ex = clamp(toIndex(cursor.ex), 0, n - 1)
  const len = exercises[ex].sets.length
  const set = len ? clamp(toIndex(cursor.set), 0, len - 1) : 0
  const here = exercises[ex]
  if (!here.skipped && here.sets[set] && !here.sets[set].done) return { ex, set }
  const next = findNext(exercises, ex, set, true)
  return next ?? { ex, set }
}

/** Rest always leads into the cursor: keep its "next" in sync after structural edits. */
function withCursor(session: WorkoutSession, exercises: SessionExercise[], cursor: Pos): WorkoutSession {
  const rest = session.rest ? { ...session.rest, nextExIndex: cursor.ex, nextSetIndex: cursor.set } : session.rest
  return { ...session, exercises, cursor, rest }
}

function replaceAt<T>(list: T[], index: number, item: T): T[] {
  const copy = list.slice()
  copy[index] = item
  return copy
}

/* ------------------------------------------------------------------ */
/* Progression                                                         */
/* ------------------------------------------------------------------ */

interface Performance {
  session: WorkoutSession
  entries: SessionExercise[]
  /** Done, non-warm-up sets of the exercise in that session. */
  sets: SetLog[]
}

/** Past sessions with ≥1 working set of the exercise, newest first. */
function pastPerformances(history: WorkoutSession[], exerciseId: string, excludeId?: string): Performance[] {
  const out: Performance[] = []
  for (const session of history) {
    if (session.deleted || session.id === excludeId) continue
    const entries = session.exercises.filter((e) => e.exerciseId === exerciseId)
    const sets = entries.flatMap((e) => e.sets.filter(isWorking))
    if (sets.length) out.push({ session, entries, sets })
  }
  return out.sort(
    (a, b) => b.session.startedAt - a.session.startedAt || (b.session.endedAt ?? 0) - (a.session.endedAt ?? 0),
  )
}

/** A progression suggestion that also carries the suggested seconds for 'time' exercises. */
export interface TargetSuggestion extends ProgressionSuggestion {
  seconds: number | null
}

export type TargetItem = Pick<RoutineItem, 'repsMin' | 'repsMax'> & { targetSeconds?: number }

function repRange(item: Pick<RoutineItem, 'repsMin' | 'repsMax'>): { lo: number; hi: number } {
  if (!isPos(item.repsMax) && !isPos(item.repsMin)) return { lo: DEFAULT_REPS.min, hi: DEFAULT_REPS.max }
  const a = isPos(item.repsMin) ? Math.round(item.repsMin) : 1
  const b = isPos(item.repsMax) ? Math.round(item.repsMax) : a
  const lo = Math.max(1, Math.min(a, b))
  return { lo, hi: Math.max(lo, a, b) }
}

/** Best (max-reps) set at the top weight of a performance, all in `unit`. */
function topOf(perf: Performance, step: number, unit: Unit): { top: number | null; topReps: number | null } {
  let top: number | null = null
  let topReps: number | null = null
  for (const s of perf.sets) {
    const w = weightIn(s, perf.session.unit, unit, step)
    if (!isPos(w) || !isPos(s.reps)) continue
    if (top === null || w > top + EPS) {
      top = w
      topReps = s.reps
    } else if (Math.abs(w - top) < EPS && s.reps > (topReps ?? 0)) {
      topReps = s.reps
    }
  }
  return { top, topReps }
}

function suggestReps(perf: Performance, lo: number, hi: number): TargetSuggestion {
  const weight = null
  const reps = perf.sets.map((s) => s.reps).filter(isPos)
  if (!reps.length) {
    return { weight, reps: Math.round((lo + hi) / 2), seconds: null, reason: 'Busca el rango de reps con buena técnica' }
  }
  const best = Math.max(...reps)
  if (best < lo) return { weight, reps: lo, seconds: null, reason: `Busca ${lo} reps con buena técnica` }
  if (reps.every((r) => r >= hi)) {
    return { weight, reps: best + 1, seconds: null, reason: `Hiciste ${hi} reps en todas: intenta ${best + 1}` }
  }
  if (best >= hi) return { weight, reps: hi, seconds: null, reason: `Completa ${hi} reps en todas las series` }
  return { weight, reps: best + 1, seconds: null, reason: 'Intenta 1 rep más que la última vez' }
}

function suggestWeighted(
  perfs: Performance[],
  lo: number,
  hi: number,
  exercise: Exercise | undefined,
  unit: Unit,
): TargetSuggestion {
  const step = loadStep(exercise, unit)
  const last = perfs[0]
  const { top, topReps } = topOf(last, step, unit)
  if (top === null || topReps === null) return suggestReps(last, lo, hi)

  const repSets = last.sets.filter((s) => isPos(s.reps))
  const allMaxAtTop = repSets.every((s) => {
    const w = weightIn(s, last.session.unit, unit, step)
    return isPos(w) && Math.abs(w - top) < EPS && (s.reps ?? 0) >= hi
  })
  if (allMaxAtTop) {
    const weight = round2(top + step)
    return { weight, reps: lo, seconds: null, reason: `Hiciste ${hi} reps en todas: sube a ${fmtLoad(weight, unit)}` }
  }

  if (topReps < lo) {
    const prev = perfs[1]
    if (prev) {
      const p = topOf(prev, step, unit)
      if (p.top !== null && p.topReps !== null && Math.abs(p.top - top) < EPS && p.topReps < lo) {
        let weight = roundToStep(top * 0.9, step)
        if (weight >= top - EPS) weight = round2(top - step)
        weight = Math.max(0, weight)
        return { weight, reps: lo, seconds: null, reason: `Baja un poco y recupera técnica: ${fmtLoad(weight, unit)}` }
      }
    }
    return { weight: top, reps: lo, seconds: null, reason: `Mantén ${fmtLoad(top, unit)} y busca ${lo} reps` }
  }

  if (topReps >= hi) {
    return { weight: top, reps: hi, seconds: null, reason: `Mantén ${fmtLoad(top, unit)} y completa ${hi} reps en todas` }
  }
  return { weight: top, reps: Math.min(hi, topReps + 1), seconds: null, reason: 'Intenta 1 rep más que la última vez' }
}

function suggestTime(perfs: Performance[], item: TargetItem, exercise: Exercise | undefined): TargetSuggestion {
  const cardio = isSteadyCardio(exercise)
  const base = isPos(item.targetSeconds) ? Math.round(item.targetSeconds) : null
  const fallback = base ?? (cardio ? DEFAULT_CARDIO_SEC : DEFAULT_HOLD_SEC)
  const last = perfs[0]
  const secs = last ? last.sets.map((s) => s.seconds).filter(isPos) : []
  if (!last || !secs.length) {
    // With history but no recorded seconds it is not really the first time.
    const lead = last ? 'Apunta a' : 'Primera vez:'
    const reason = cardio
      ? `${lead} ${formatSeconds(fallback)} a ritmo cómodo`
      : `${lead} ${last ? '' : 'aguanta '}${formatSeconds(fallback)} con buena técnica`
    return { weight: null, reps: null, seconds: fallback, reason }
  }
  const lastTarget = last.entries.map((e) => e.target.targetSeconds).find(isPos) ?? fallback
  const step = Math.max(lastTarget, fallback) >= 300 ? 60 : 5
  const worst = Math.min(...secs)
  if (worst >= lastTarget) {
    const seconds = Math.max(base ?? 0, Math.round(worst) + step)
    return {
      weight: null,
      reps: null,
      seconds,
      reason: `Completaste ${formatSeconds(lastTarget)} en todas: intenta ${formatSeconds(seconds)}`,
    }
  }
  const seconds = Math.max(base ?? 0, Math.round(lastTarget))
  return { weight: null, reps: null, seconds, reason: `Mantén ${formatSeconds(seconds)} y complétalo en todas las series` }
}

function suggestFor(
  history: WorkoutSession[],
  exerciseId: string,
  item: TargetItem,
  exercise: Exercise | undefined,
  unit: Unit,
  excludeId?: string,
): TargetSuggestion {
  const kind = kindOf(exercise, item.targetSeconds)
  const perfs = pastPerformances(history, exerciseId, excludeId)
  if (kind === 'time') return suggestTime(perfs, item, exercise)
  const { lo, hi } = repRange(item)
  if (!perfs.length) {
    const reason =
      kind === 'reps' ? 'Primera vez: quédate a 2 reps del fallo' : 'Primera vez: elige un peso que te deje 2 reps en reserva'
    return { weight: null, reps: Math.round((lo + hi) / 2), seconds: null, reason }
  }
  if (kind === 'reps') return suggestReps(perfs[0], lo, hi)
  return suggestWeighted(perfs, lo, hi, exercise, unit)
}

/**
 * Full suggestion (weight, reps AND seconds for 'time' exercises). `item.targetSeconds` is the
 * planned hold; for time exercises the suggested seconds progress +5 s (+60 s for cardio ≥ 5 min).
 */
export function suggestTarget(
  history: WorkoutSession[],
  exerciseId: string,
  item: TargetItem,
  exercise: Exercise | undefined,
  unit: Unit,
): TargetSuggestion {
  return suggestFor(history, exerciseId, item, exercise, unit)
}

/** Double-progression suggestion for an exercise based on the most recent sessions. */
export function suggestProgression(
  history: WorkoutSession[],
  exerciseId: string,
  item: Pick<RoutineItem, 'repsMin' | 'repsMax'>,
  exercise: Exercise | undefined,
  unit: Unit,
): ProgressionSuggestion {
  const targetSeconds = 'targetSeconds' in item && isNum(item.targetSeconds) ? item.targetSeconds : undefined
  const { weight, reps, reason } = suggestFor(history, exerciseId, { ...item, targetSeconds }, exercise, unit)
  return { weight, reps, reason }
}

/* ------------------------------------------------------------------ */
/* Building exercises                                                  */
/* ------------------------------------------------------------------ */

interface ExerciseSpec {
  exerciseId: string
  sets: number
  repsMin: number
  repsMax: number
  restSec: number
  targetSeconds?: number
}

/** Sets/reps/rest for an exercise added on the fly (not from a routine). */
export function defaultTargetFor(exercise: Exercise | undefined, defaultRestSec: number): Omit<ExerciseSpec, 'exerciseId'> {
  const restSec = exercise?.defaultRestSec ?? defaultRestSec
  if (exercise?.kind === 'time') {
    return isSteadyCardio(exercise)
      ? { sets: 1, repsMin: 0, repsMax: 0, restSec, targetSeconds: DEFAULT_CARDIO_SEC }
      : { sets: 3, repsMin: 0, repsMax: 0, restSec, targetSeconds: DEFAULT_HOLD_SEC }
  }
  return { sets: 3, repsMin: DEFAULT_REPS.min, repsMax: DEFAULT_REPS.max, restSec }
}

/** Make a target coherent with the exercise kind (e.g. after swapping a hold for a lift). */
function normalizeTarget(spec: Omit<ExerciseSpec, 'exerciseId'>, kind: ExerciseKind, exercise: Exercise | undefined): SessionTarget {
  const sets = isPos(spec.sets) ? Math.max(1, Math.round(spec.sets)) : 3
  const restSec = isNum(spec.restSec) && spec.restSec >= 0 ? Math.round(spec.restSec) : (exercise?.defaultRestSec ?? 90)
  if (kind === 'time') {
    const targetSeconds = isPos(spec.targetSeconds)
      ? Math.round(spec.targetSeconds)
      : isSteadyCardio(exercise)
        ? DEFAULT_CARDIO_SEC
        : DEFAULT_HOLD_SEC
    return {
      sets,
      repsMin: isNum(spec.repsMin) ? spec.repsMin : 0,
      repsMax: isNum(spec.repsMax) ? spec.repsMax : 0,
      restSec,
      targetSeconds,
    }
  }
  const { lo, hi } = repRange(spec)
  return { sets, repsMin: lo, repsMax: hi, restSec }
}

function prefillSet(kind: ExerciseKind, sug: TargetSuggestion, target: SessionTarget, id: string = uid('s_')): SetLog {
  if (kind === 'time') return { id, weight: null, reps: null, seconds: target.targetSeconds ?? null, done: false }
  return { id, weight: kind === 'weight_reps' ? sug.weight : null, reps: sug.reps, done: false }
}

function targetWith(base: SessionTarget, kind: ExerciseKind, sug: TargetSuggestion): SessionTarget {
  const target: SessionTarget = { ...base, weight: kind === 'weight_reps' ? sug.weight : null, reason: sug.reason }
  if (kind === 'time' && isPos(sug.seconds)) target.targetSeconds = sug.seconds
  return target
}

function buildExercise(
  spec: ExerciseSpec,
  exercise: Exercise | undefined,
  history: WorkoutSession[],
  unit: Unit,
  extra: Partial<Pick<SessionExercise, 'routineItemId' | 'note' | 'swappedFrom'>> = {},
  excludeId?: string,
): SessionExercise {
  const kind = kindOf(exercise, spec.targetSeconds)
  const base = normalizeTarget(spec, kind, exercise)
  const sug = suggestFor(history, spec.exerciseId, base, exercise, unit, excludeId)
  const target = targetWith(base, kind, sug)
  const se: SessionExercise = {
    id: uid('se_'),
    exerciseId: spec.exerciseId,
    target,
    sets: Array.from({ length: target.sets }, () => prefillSet(kind, sug, target)),
  }
  if (extra.routineItemId) se.routineItemId = extra.routineItemId
  if (extra.note) se.note = extra.note
  if (extra.swappedFrom) se.swappedFrom = extra.swappedFrom
  return se
}

/* ------------------------------------------------------------------ */
/* Session lifecycle                                                   */
/* ------------------------------------------------------------------ */

/** Build a new in-progress session from a routine (or empty for a free workout).
 *  Pre-creates target.sets SetLogs per exercise, prefilled with the progression suggestion. */
export function createSession(
  routine: Routine | null,
  getExercise: (id: string) => Exercise | undefined,
  history: WorkoutSession[],
  unit: Unit,
  now: number = Date.now(),
): WorkoutSession {
  const exercises = (routine?.items ?? []).map((item) =>
    buildExercise(
      {
        exerciseId: item.exerciseId,
        sets: item.sets,
        repsMin: item.repsMin,
        repsMax: item.repsMax,
        restSec: item.restSec,
        targetSeconds: item.targetSeconds,
      },
      getExercise(item.exerciseId),
      history,
      unit,
      { routineItemId: item.id, note: item.note },
    ),
  )
  return {
    id: uid('w_'),
    routineId: routine?.id ?? null,
    name: routine?.name?.trim() || FREE_WORKOUT_NAME,
    unit,
    startedAt: now,
    endedAt: null,
    exercises,
    cursor: { ex: 0, set: 0 },
    rest: null,
    updatedAt: now,
  }
}

/** New undone set for an exercise: copies the last set's values (or the target when empty). */
function cloneForNewSet(se: SessionExercise): SetLog {
  const last = se.sets[se.sets.length - 1]
  const id = uid('s_')
  if (last) {
    const set: SetLog = { id, weight: last.weight, reps: last.reps, done: false }
    if (last.seconds !== undefined) set.seconds = last.seconds
    return set
  }
  const t = se.target
  if (isPos(t.targetSeconds)) return { id, weight: null, reps: null, seconds: t.targetSeconds, done: false }
  const { lo, hi } = repRange(t)
  return { id, weight: t.weight ?? null, reps: Math.round((lo + hi) / 2), done: false }
}

/* ---------- PR detection ---------- */

interface PoolSet {
  set: SetLog
  unit: Unit
}

function detectPR(
  set: SetLog,
  session: WorkoutSession,
  exercises: SessionExercise[],
  exIndex: number,
  setIndex: number,
  history: WorkoutSession[],
): boolean {
  if (set.isWarmup) return false
  const exerciseId = exercises[exIndex].exerciseId
  const prior = pastPerformances(history, exerciseId, session.id)
  if (!prior.length) return false // first time ever is never a PR
  const pool: PoolSet[] = prior.flatMap((p) => p.sets.map((s) => ({ set: s, unit: p.session.unit })))
  exercises.forEach((se, i) => {
    if (se.exerciseId !== exerciseId) return
    se.sets.forEach((s, j) => {
      if ((i !== exIndex || j !== setIndex) && isWorking(s)) pool.push({ set: s, unit: session.unit })
    })
  })

  const unit = session.unit
  if (isPos(set.weight) && isPos(set.reps)) {
    const current = e1rm(set.weight, set.reps)
    let best: number | null = null
    for (const p of pool) {
      const v = e1rm(weightIn(p.set, p.unit, unit, null), p.set.reps)
      if (v !== null && (best === null || v > best)) best = v
    }
    return current !== null && best !== null && current > best + 0.01
  }
  if (isPos(set.reps)) {
    let best: number | null = null
    for (const p of pool) {
      if (isPos(p.set.weight) || !isPos(p.set.reps)) continue
      if (best === null || p.set.reps > best) best = p.set.reps
    }
    return best !== null && set.reps > best
  }
  if (isPos(set.seconds)) {
    let best: number | null = null
    for (const p of pool) {
      if (!isPos(p.set.seconds)) continue
      if (best === null || p.set.seconds > best) best = p.set.seconds
    }
    return best !== null && set.seconds > best
  }
  return false
}

export function logSet(
  session: WorkoutSession,
  input: LogSetInput,
  history: WorkoutSession[],
  now: number = Date.now(),
): LogSetResult {
  const exercises = session.exercises
  // Nothing was logged, so nothing was completed (an empty free workout must not "finish").
  const noop = (): LogSetResult => ({ session, isPR: false, exerciseCompleted: false, workoutCompleted: false, restSec: 0 })

  const exIndex = input.exIndex ?? session.cursor.ex
  const se = Number.isInteger(exIndex) ? exercises[exIndex] : undefined
  if (!se) return noop()

  // Explicit setIndex → that set (editing it if already done). Implicit → the cursor set while it
  // is undone, else the exercise's first undone set, else ONE MORE set: "Serie hecha" / a voice
  // note never silently overwrites a logged set (e.g. after finishing, or on a completed exercise).
  let setIndex: number
  if (input.setIndex !== undefined) setIndex = input.setIndex
  else {
    const atCursor = exIndex === session.cursor.ex ? se.sets[session.cursor.set] : undefined
    if (atCursor && !atCursor.done) setIndex = session.cursor.set
    else {
      const f = firstUndone(se)
      setIndex = f >= 0 ? f : se.sets.length
    }
  }
  if (!Number.isInteger(setIndex) || setIndex < 0) return noop()

  let sets = se.sets
  if (setIndex >= sets.length) {
    sets = [...sets, cloneForNewSet(se)]
    setIndex = sets.length - 1
  }

  const prev = sets[setIndex]
  const wasDone = prev.done
  const weight = input.weight !== undefined ? cleanNum(input.weight, false) : prev.weight
  const reps = input.reps !== undefined ? cleanNum(input.reps, true) : prev.reps

  const logged: SetLog = {
    ...prev,
    weight,
    reps,
    done: true,
    completedAt: wasDone ? (prev.completedAt ?? now) : now,
    source: input.source ?? (wasDone ? prev.source : undefined) ?? 'tap',
  }
  if (input.seconds !== undefined) logged.seconds = cleanNum(input.seconds, true)
  if (input.rpe !== undefined) logged.rpe = isNum(input.rpe) ? clamp(input.rpe, 1, 10) : null
  delete logged.isPR

  // The user only says the weight when it changes: carry it to the remaining sets.
  const latestDone =
    !wasDone ||
    sets.every((s, i) => i === setIndex || !s.done || (s.completedAt ?? 0) <= (prev.completedAt ?? 0))
  const propagate = input.weight !== undefined && !sameNum(weight, prev.weight) && latestDone
  let newSets = sets.map((s, i) => {
    if (i === setIndex) return logged
    return propagate && !s.done ? { ...s, weight } : s
  })

  const draft: SessionExercise = { ...se, sets: newSets }
  if (draft.skipped) delete draft.skipped
  let newExercises = replaceAt(exercises, exIndex, draft)

  const isPR = detectPR(logged, session, newExercises, exIndex, setIndex, history)
  if (isPR) {
    newSets = replaceAt(newSets, setIndex, { ...logged, isPR: true })
    newExercises = replaceAt(newExercises, exIndex, { ...draft, sets: newSets })
  }

  const exerciseCompleted = newSets.every((s) => s.done)
  const workoutCompleted = sessionFinished(newExercises)
  const cursor: Pos = wasDone
    ? session.cursor
    : (findNext(newExercises, exIndex, setIndex, false) ?? { ex: exIndex, set: setIndex })

  return {
    session: {
      ...session,
      exercises: newExercises,
      cursor,
      rest: wasDone ? session.rest : null,
      updatedAt: now,
    },
    isPR,
    exerciseCompleted,
    workoutCompleted,
    restSec: !wasDone && !workoutCompleted ? Math.max(0, se.target.restSec) : 0,
  }
}

export function undoLastSet(session: WorkoutSession): WorkoutSession {
  let best: (Pos & { t: number }) | null = null
  session.exercises.forEach((se, ex) =>
    se.sets.forEach((s, set) => {
      if (!s.done) return
      const t = s.completedAt ?? 0
      if (!best || t >= best.t) best = { ex, set, t }
    }),
  )
  const found = best as (Pos & { t: number }) | null
  if (!found) return session
  const se = session.exercises[found.ex]
  const reverted: SetLog = { ...se.sets[found.set], done: false }
  delete reverted.completedAt
  delete reverted.source
  delete reverted.isPR
  const updated: SessionExercise = { ...se, sets: replaceAt(se.sets, found.set, reverted) }
  if (updated.skipped) delete updated.skipped
  return {
    ...session,
    exercises: replaceAt(session.exercises, found.ex, updated),
    cursor: { ex: found.ex, set: found.set },
    rest: null,
  }
}

export function updateSet(
  session: WorkoutSession,
  exIndex: number,
  setIndex: number,
  patch: Partial<SetLog>,
  history?: WorkoutSession[],
): WorkoutSession {
  const se = session.exercises[exIndex]
  const set = se?.sets[setIndex]
  if (!se || !set) return session
  const updated: SetLog = { ...set, ...patch, id: set.id }
  let exercises = replaceAt(session.exercises, exIndex, { ...se, sets: replaceAt(se.sets, setIndex, updated) })
  // Editing a logged set's numbers must re-run PR detection (a stale gold badge is a lie).
  const touchesPR = 'weight' in patch || 'reps' in patch || 'seconds' in patch || 'isWarmup' in patch || 'done' in patch
  if (history && touchesPR) {
    delete updated.isPR
    if (updated.done && detectPR(updated, session, exercises, exIndex, setIndex, history)) updated.isPR = true
    exercises = replaceAt(session.exercises, exIndex, { ...se, sets: replaceAt(se.sets, setIndex, updated) })
  }
  return { ...session, exercises }
}

export function addSet(session: WorkoutSession, exIndex: number): WorkoutSession {
  const se = session.exercises[exIndex]
  if (!se) return session
  const wasFinished = sessionFinished(session.exercises)
  const updated: SessionExercise = { ...se, sets: [...se.sets, cloneForNewSet(se)] }
  if (updated.skipped) delete updated.skipped
  const exercises = replaceAt(session.exercises, exIndex, updated)
  const cursor = wasFinished ? { ex: exIndex, set: updated.sets.length - 1 } : normalizeCursor(exercises, session.cursor)
  return withCursor(session, exercises, cursor)
}

export function removeSet(session: WorkoutSession, exIndex: number, setIndex: number): WorkoutSession {
  const se = session.exercises[exIndex]
  if (!se || !se.sets[setIndex]) return session
  const updated: SessionExercise = { ...se, sets: se.sets.filter((_, i) => i !== setIndex) }
  const exercises = replaceAt(session.exercises, exIndex, updated)
  let { ex, set } = session.cursor
  if (ex === exIndex && setIndex < set) set -= 1
  return withCursor(session, exercises, normalizeCursor(exercises, { ex, set }))
}

export function skipExercise(session: WorkoutSession, exIndex: number): WorkoutSession {
  const se = session.exercises[exIndex]
  if (!se) return session
  const exercises = replaceAt(session.exercises, exIndex, { ...se, skipped: true })
  const cursor =
    session.cursor.ex === exIndex
      ? (findNext(exercises, exIndex, session.cursor.set, false) ?? session.cursor)
      : normalizeCursor(exercises, session.cursor)
  return withCursor(session, exercises, cursor)
}

export function swapExercise(
  session: WorkoutSession,
  exIndex: number,
  newExerciseId: string,
  getExercise: (id: string) => Exercise | undefined,
  history: WorkoutSession[],
): WorkoutSession {
  const se = session.exercises[exIndex]
  if (!se || !newExerciseId || se.exerciseId === newExerciseId) return session
  const exercise = getExercise(newExerciseId)
  const kind = kindOf(exercise)
  const original = se.swappedFrom ?? se.exerciseId
  const hasDone = se.sets.some((s) => s.done)

  if (!hasDone) {
    // Replace in place: same slot, same number of sets, re-prefilled for the new exercise.
    const base = normalizeTarget(se.target, kind, exercise)
    const sug = suggestFor(history, newExerciseId, base, exercise, session.unit, session.id)
    const target = targetWith(base, kind, sug)
    const updated: SessionExercise = {
      ...se,
      exerciseId: newExerciseId,
      target,
      sets: se.sets.map((s) => prefillSet(kind, sug, target, s.id)),
    }
    if (original === newExerciseId) delete updated.swappedFrom
    else updated.swappedFrom = original
    if (updated.skipped) delete updated.skipped
    const exercises = replaceAt(session.exercises, exIndex, updated)
    const cursor =
      session.cursor.ex === exIndex
        ? { ex: exIndex, set: Math.max(0, firstUndone(updated)) }
        : normalizeCursor(exercises, session.cursor)
    return withCursor(session, exercises, cursor)
  }

  // Some sets are done: keep them, and do the remaining sets with the new exercise right after.
  const remaining = se.sets.filter((s) => !s.done).length
  const kept: SessionExercise = { ...se, sets: se.sets.filter((s) => s.done) }
  const inserted = buildExercise(
    {
      exerciseId: newExerciseId,
      sets: remaining > 0 ? remaining : Math.max(1, se.target.sets),
      repsMin: se.target.repsMin,
      repsMax: se.target.repsMax,
      restSec: se.target.restSec,
      targetSeconds: se.target.targetSeconds,
    },
    exercise,
    history,
    session.unit,
    original === newExerciseId ? {} : { swappedFrom: original },
    session.id,
  )
  const exercises = [...session.exercises.slice(0, exIndex), kept, inserted, ...session.exercises.slice(exIndex + 1)]
  if (session.cursor.ex === exIndex) return withCursor(session, exercises, { ex: exIndex + 1, set: 0 })
  // Swapping another exercise (e.g. from the list) must not pull the user away from the current one.
  const cursorId = session.exercises[session.cursor.ex]?.id
  const at = exercises.findIndex((e) => e.id === cursorId)
  return withCursor(session, exercises, normalizeCursor(exercises, { ex: at >= 0 ? at : session.cursor.ex, set: session.cursor.set }))
}

export function addExercise(
  session: WorkoutSession,
  exerciseId: string,
  getExercise: (id: string) => Exercise | undefined,
  history: WorkoutSession[],
  defaultRestSec: number,
): WorkoutSession {
  if (!exerciseId) return session
  const exercise = getExercise(exerciseId)
  const se = buildExercise(
    { exerciseId, ...defaultTargetFor(exercise, defaultRestSec) },
    exercise,
    history,
    session.unit,
    {},
    session.id,
  )
  const wasFinished = sessionFinished(session.exercises)
  const exercises = [...session.exercises, se]
  const cursor = wasFinished ? { ex: exercises.length - 1, set: 0 } : session.cursor
  return withCursor(session, exercises, cursor)
}

export function moveExercise(session: WorkoutSession, from: number, to: number): WorkoutSession {
  const n = session.exercises.length
  if (!n) return session
  const f = clamp(toIndex(from), 0, n - 1)
  const t = clamp(toIndex(to), 0, n - 1)
  if (f === t) return session
  const cursorId = session.exercises[session.cursor.ex]?.id
  const list = session.exercises.slice()
  const [moved] = list.splice(f, 1)
  list.splice(t, 0, moved)
  const ex = list.findIndex((e) => e.id === cursorId)
  const cursor = { ex: ex >= 0 ? ex : clamp(session.cursor.ex, 0, n - 1), set: session.cursor.set }
  return withCursor(session, list, cursor)
}

export function setCursor(session: WorkoutSession, exIndex: number, setIndex?: number): WorkoutSession {
  const n = session.exercises.length
  if (!n) return session
  const ex = clamp(toIndex(exIndex), 0, n - 1)
  let se = session.exercises[ex]
  let exercises = session.exercises
  if (se.skipped) {
    se = { ...se }
    delete se.skipped
    exercises = replaceAt(exercises, ex, se)
  }
  const len = se.sets.length
  let set: number
  if (setIndex === undefined) {
    const f = firstUndone(se)
    set = f >= 0 ? f : Math.max(0, len - 1)
  } else {
    set = len ? clamp(toIndex(setIndex), 0, len - 1) : 0
  }
  return withCursor(session, exercises, { ex, set })
}

export function startRest(session: WorkoutSession, durationSec: number, now: number = Date.now()): WorkoutSession {
  if (!isPos(durationSec)) return session.rest ? { ...session, rest: null } : session
  const sec = Math.max(1, Math.round(durationSec))
  return {
    ...session,
    rest: {
      startedAt: now,
      endsAt: now + sec * 1000,
      durationSec: sec,
      nextExIndex: session.cursor.ex,
      nextSetIndex: session.cursor.set,
    },
  }
}

export function adjustRest(session: WorkoutSession, deltaSec: number, now: number = Date.now()): WorkoutSession {
  const rest = session.rest
  if (!rest || !isNum(deltaSec) || deltaSec === 0) return session
  // "+15 s" after the rest already ran out means 15 s from now, not from the past end.
  const base = deltaSec > 0 ? Math.max(rest.endsAt, now) : rest.endsAt
  const endsAt = Math.max(base + deltaSec * 1000, now + 1000)
  return { ...session, rest: { ...rest, endsAt, durationSec: Math.max(1, Math.round(rest.durationSec + deltaSec)) } }
}

export function endRest(session: WorkoutSession): WorkoutSession {
  return session.rest ? { ...session, rest: null } : session
}

/** Mark ended, drop never-done empty sets, keep done sets. */
export function finishSession(session: WorkoutSession, now: number = Date.now()): WorkoutSession {
  const exercises = session.exercises
    .map((se) => ({ ...se, sets: se.sets.filter((s) => s.done) }))
    .filter((se) => se.sets.length > 0)
  return { ...session, exercises, endedAt: now, rest: null, cursor: { ex: 0, set: 0 }, updatedAt: now }
}

export function getCursorInfo(session: WorkoutSession): CursorInfo {
  const exercises = session.exercises
  const n = exercises.length
  const exIndex = n ? clamp(toIndex(session.cursor.ex), 0, n - 1) : 0
  const exercise = exercises[exIndex] ?? null
  const len = exercise?.sets.length ?? 0
  const setIndex = len ? clamp(toIndex(session.cursor.set), 0, len - 1) : 0

  let doneSets = 0
  let totalSessionSets = 0
  for (const se of exercises) {
    const d = se.sets.filter((s) => s.done).length
    doneSets += d
    totalSessionSets += se.skipped ? d : se.sets.length
  }

  const nextPos = exercise ? findNext(exercises, exIndex, setIndex, false) : null
  return {
    exIndex,
    setIndex,
    exercise,
    setNumber: len ? setIndex + 1 : 0,
    totalSets: len,
    next: nextPos ? { exIndex: nextPos.ex, setIndex: nextPos.set, exercise: exercises[nextPos.ex] } : null,
    progress: totalSessionSets ? doneSets / totalSessionSets : 0,
    doneSets,
    totalSessionSets,
    isLastSetOfExercise: !!exercise && len > 0 && exercise.sets.every((s, i) => i === setIndex || s.done),
    isFinished: sessionFinished(exercises),
  }
}
