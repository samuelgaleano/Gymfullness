/**
 * Stats — PURE functions over completed sessions & body logs.
 * Inputs are never mutated. `now` defaults to Date.now(); weeks start on Monday (local time).
 * "Working set" = done && !isWarmup (warm-ups never count for volume, PRs or muscle balance).
 */
import type { BodyLog, Exercise, MuscleGroup, SessionExercise, SessionSummary, SetLog, Unit, WorkoutSession } from './types'
import { convertWeight } from './units'
import { toDateKey } from './date'

const DAY_MS = 86_400_000
const EPS = 1e-9

const round1 = (n: number) => Math.round(n * 10) / 10
const isPos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Epley estimated 1RM; reps 1 → weight; null when not computable. */
export function e1rm(weight: number | null | undefined, reps: number | null | undefined): number | null {
  if (!isPos(weight) || !isPos(reps)) return null
  if (reps === 1) return weight
  return weight * (1 + reps / 30)
}

/** Done, non-warm-up set. */
export function isWorkingSet(set: SetLog): boolean {
  return set.done && !set.isWarmup
}

/** Weight of a set expressed in `to` (null when the set has no weight). */
function weightIn(set: SetLog, from: Unit, to: Unit): number | null {
  if (set.weight === null || set.weight === undefined || !Number.isFinite(set.weight)) return null
  return from === to ? set.weight : convertWeight(set.weight, from, to)
}

/** Volume contribution of one set (weight × reps), 0 for time sets or missing values. */
function setVolume(weight: number | null, reps: number | null | undefined): number {
  return isPos(weight) && isPos(reps) ? weight * reps : 0
}

const maxOrNull = (a: number | null, b: number | null): number | null => {
  if (a === null) return b
  if (b === null) return a
  return b > a ? b : a
}

/** Effective end of a session: endedAt, else last completed set, else updatedAt/startedAt. */
export function sessionEnd(session: WorkoutSession): number {
  if (typeof session.endedAt === 'number') return session.endedAt
  let last = 0
  for (const se of session.exercises) for (const s of se.sets) if (s.done && s.completedAt && s.completedAt > last) last = s.completedAt
  return Math.max(session.startedAt, last || session.updatedAt || session.startedAt)
}

/** Session duration in seconds (never negative). */
export function sessionDurationSec(session: WorkoutSession): number {
  return Math.max(0, Math.round((sessionEnd(session) - session.startedAt) / 1000))
}

/** 'bench-press' → 'Bench press' (fallback name for unknown/deleted exercises). */
function humanize(id: string): string {
  const s = id.replace(/[-_]+/g, ' ').trim()
  return s ? s[0].toUpperCase() + s.slice(1) : 'Ejercicio'
}

const live = (sessions: WorkoutSession[]) => sessions.filter((s) => !s.deleted)

function addMuscles(
  acc: Partial<Record<MuscleGroup, number>>,
  ex: Exercise | undefined,
  sets: number,
): void {
  if (!ex || sets <= 0) return
  acc[ex.primary] = (acc[ex.primary] ?? 0) + sets
  for (const m of ex.secondary) {
    if (m === ex.primary) continue
    acc[m] = (acc[m] ?? 0) + sets * 0.5
  }
}

/* ------------------------------------------------------------------ */
/* Session summary                                                     */
/* ------------------------------------------------------------------ */

export function summarizeSession(
  session: WorkoutSession,
  getExercise: (id: string) => Exercise | undefined,
): SessionSummary {
  const endedAt = sessionEnd(session)
  let totalSets = 0
  let totalReps = 0
  let volume = 0
  const muscles: Partial<Record<MuscleGroup, number>> = {}
  const exercises: SessionSummary['exercises'] = []
  const prByExercise = new Map<string, SessionSummary['prs'][number]>()

  for (const se of session.exercises) {
    const working = se.sets.filter(isWorkingSet)
    if (!working.length) continue
    const ex = getExercise(se.exerciseId)
    const name = ex?.name ?? humanize(se.exerciseId)
    const timeKind = ex?.kind === 'time'
    let exVolume = 0
    let best: number | null = null
    const sets: SessionSummary['exercises'][number]['sets'] = []

    for (const s of working) {
      const reps = isPos(s.reps) ? s.reps : 0
      totalSets++
      totalReps += reps
      const v = timeKind ? 0 : setVolume(s.weight, s.reps)
      exVolume += v
      const est = e1rm(s.weight, s.reps)
      best = maxOrNull(best, est)
      const row: SessionSummary['exercises'][number]['sets'][number] = { weight: s.weight, reps: s.reps }
      if (s.seconds !== undefined) row.seconds = s.seconds
      if (s.isPR) row.isPR = true
      sets.push(row)

      if (s.isPR) {
        const prev = prByExercise.get(se.exerciseId)
        const better =
          !prev ||
          (est ?? -1) > (prev.e1rm ?? -1) + EPS ||
          ((est ?? -1) === (prev.e1rm ?? -1) && (s.reps ?? 0) > (prev.reps ?? 0))
        if (better) {
          prByExercise.set(se.exerciseId, {
            exerciseId: se.exerciseId,
            name,
            weight: s.weight,
            reps: s.reps,
            e1rm: est === null ? null : round1(est),
          })
        }
      }
    }

    volume += exVolume
    addMuscles(muscles, ex, working.length)
    exercises.push({
      exerciseId: se.exerciseId,
      name,
      sets,
      volume: round1(exVolume),
      bestE1rm: best === null ? null : round1(best),
    })
  }

  return {
    sessionId: session.id,
    name: session.name,
    startedAt: session.startedAt,
    endedAt,
    durationSec: Math.max(0, Math.round((endedAt - session.startedAt) / 1000)),
    totalSets,
    totalReps,
    volume: round1(volume),
    unit: session.unit,
    prs: [...prByExercise.values()],
    exercises,
    muscles,
  }
}

/* ------------------------------------------------------------------ */
/* Per-exercise history & records                                      */
/* ------------------------------------------------------------------ */

export interface ExercisePoint {
  date: number
  bestWeight: number | null
  bestReps: number | null
  bestE1rm: number | null
  volume: number
  sets: number
}

interface Agg {
  bestWeight: number | null
  bestReps: number | null
  bestE1rm: number | null
  volume: number
  sets: number
}

function aggregate(entries: SessionExercise[], from: Unit, to: Unit): Agg {
  const agg: Agg = { bestWeight: null, bestReps: null, bestE1rm: null, volume: 0, sets: 0 }
  for (const se of entries) {
    for (const s of se.sets) {
      if (!isWorkingSet(s)) continue
      agg.sets++
      const w = weightIn(s, from, to)
      if (isPos(w)) agg.bestWeight = maxOrNull(agg.bestWeight, w)
      if (isPos(s.reps)) agg.bestReps = maxOrNull(agg.bestReps, s.reps)
      agg.bestE1rm = maxOrNull(agg.bestE1rm, e1rm(w, s.reps))
      agg.volume += setVolume(w, s.reps)
    }
  }
  return agg
}

const byStart = (a: WorkoutSession, b: WorkoutSession) => a.startedAt - b.startedAt

/** One point per session that contains the exercise, oldest → newest, converted to `unit`. */
export function exerciseHistory(sessions: WorkoutSession[], exerciseId: string, unit: Unit): ExercisePoint[] {
  const points: ExercisePoint[] = []
  for (const s of live(sessions).sort(byStart)) {
    const entries = s.exercises.filter((e) => e.exerciseId === exerciseId)
    if (!entries.length) continue
    const agg = aggregate(entries, s.unit, unit)
    if (!agg.sets) continue
    points.push({
      date: s.startedAt,
      bestWeight: agg.bestWeight === null ? null : round1(agg.bestWeight),
      bestReps: agg.bestReps,
      bestE1rm: agg.bestE1rm === null ? null : round1(agg.bestE1rm),
      volume: round1(agg.volume),
      sets: agg.sets,
    })
  }
  return points
}

export interface PersonalRecord {
  exerciseId: string
  bestE1rm: number | null
  bestWeight: number | null
  bestReps: number | null
  date: number
}

/**
 * Best marks per exercise across all sessions (converted to `unit`), newest record first.
 * `date` is the session where the headline record (best e1RM, else best reps) was first reached.
 * Exercises with only time-based sets are left out.
 */
export function personalRecords(sessions: WorkoutSession[], unit: Unit): PersonalRecord[] {
  const map = new Map<string, PersonalRecord>()
  for (const s of live(sessions).sort(byStart)) {
    const ids = new Set(s.exercises.map((e) => e.exerciseId))
    for (const id of ids) {
      const agg = aggregate(
        s.exercises.filter((e) => e.exerciseId === id),
        s.unit,
        unit,
      )
      if (!agg.sets || (agg.bestE1rm === null && agg.bestReps === null)) continue
      const cur = map.get(id)
      if (!cur) {
        map.set(id, { exerciseId: id, bestE1rm: agg.bestE1rm, bestWeight: agg.bestWeight, bestReps: agg.bestReps, date: s.startedAt })
        continue
      }
      const headlineImproved =
        agg.bestE1rm !== null
          ? cur.bestE1rm === null || agg.bestE1rm > cur.bestE1rm + EPS
          : cur.bestE1rm === null && agg.bestReps !== null && (cur.bestReps === null || agg.bestReps > cur.bestReps)
      map.set(id, {
        exerciseId: id,
        bestE1rm: maxOrNull(cur.bestE1rm, agg.bestE1rm),
        bestWeight: maxOrNull(cur.bestWeight, agg.bestWeight),
        bestReps: maxOrNull(cur.bestReps, agg.bestReps),
        date: headlineImproved ? s.startedAt : cur.date,
      })
    }
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      bestE1rm: r.bestE1rm === null ? null : round1(r.bestE1rm),
      bestWeight: r.bestWeight === null ? null : round1(r.bestWeight),
    }))
    .sort((a, b) => b.date - a.date)
}

/* ------------------------------------------------------------------ */
/* Weeks & streaks                                                     */
/* ------------------------------------------------------------------ */

export interface WeekStat {
  weekStart: string // YYYY-MM-DD (Monday)
  sessions: number
  sets: number
  volume: number
  minutes: number
}

/** Local midnight of the Monday of the week containing `ts`. */
export function startOfWeek(ts: number): Date {
  const d = new Date(ts)
  const offset = (d.getDay() + 6) % 7 // Monday = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - offset)
}

const addDays = (d: Date, days: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + days)
const weekKey = (ts: number) => toDateKey(startOfWeek(ts))

function workingSetsAndVolume(s: WorkoutSession, unit: Unit): { sets: number; volume: number } {
  let sets = 0
  let volume = 0
  for (const se of s.exercises) {
    for (const set of se.sets) {
      if (!isWorkingSet(set)) continue
      sets++
      volume += setVolume(weightIn(set, s.unit, unit), set.reps)
    }
  }
  return { sets, volume }
}

/** Last `weeks` weeks including the current one, oldest → newest. */
export function weeklyStats(sessions: WorkoutSession[], weeks: number, unit: Unit, now: number = Date.now()): WeekStat[] {
  const n = Math.max(0, Math.floor(weeks))
  if (!n) return []
  const current = startOfWeek(now)
  const buckets = new Map<string, WeekStat & { seconds: number }>()
  const order: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const key = toDateKey(addDays(current, -7 * i))
    order.push(key)
    buckets.set(key, { weekStart: key, sessions: 0, sets: 0, volume: 0, minutes: 0, seconds: 0 })
  }
  for (const s of live(sessions)) {
    const b = buckets.get(weekKey(s.startedAt))
    if (!b) continue
    const { sets, volume } = workingSetsAndVolume(s, unit)
    b.sessions++
    b.sets += sets
    b.volume += volume
    b.seconds += sessionDurationSec(s)
  }
  return order.map((key) => {
    const { seconds, ...stat } = buckets.get(key)!
    return { ...stat, volume: round1(stat.volume), minutes: Math.round(seconds / 60) }
  })
}

/** Consecutive weeks (ending this week or last week) with ≥1 session; and sessions this week. */
export function streak(sessions: WorkoutSession[], now: number = Date.now()): { weeks: number; thisWeek: number; total: number } {
  const list = live(sessions)
  const keys = new Set(list.map((s) => weekKey(s.startedAt)))
  const current = startOfWeek(now)
  const currentKey = toDateKey(current)
  const thisWeek = list.filter((s) => weekKey(s.startedAt) === currentKey).length
  let cursor = keys.has(currentKey) ? current : addDays(current, -7)
  let weeks = 0
  while (keys.has(toDateKey(cursor))) {
    weeks++
    cursor = addDays(cursor, -7)
  }
  return { weeks, thisWeek, total: list.length }
}

/** Working sets per muscle in the last `days` days (primary = 1, secondary = 0.5). */
export function muscleSets(
  sessions: WorkoutSession[],
  getExercise: (id: string) => Exercise | undefined,
  days: number,
  now: number = Date.now(),
): Partial<Record<MuscleGroup, number>> {
  const since = now - Math.max(0, days) * DAY_MS
  const acc: Partial<Record<MuscleGroup, number>> = {}
  for (const s of live(sessions)) {
    if (s.startedAt < since) continue
    for (const se of s.exercises) addMuscles(acc, getExercise(se.exerciseId), se.sets.filter(isWorkingSet).length)
  }
  return acc
}

/* ------------------------------------------------------------------ */
/* Body                                                                */
/* ------------------------------------------------------------------ */

/** Body metric series (oldest → newest), skipping null values, weight converted to `unit`. */
export function bodySeries(
  logs: BodyLog[],
  metric: 'weight' | 'bodyFat' | 'waist' | 'chest' | 'arm' | 'thigh' | 'hips' | 'neck',
  unit: Unit,
): { date: string; value: number }[] {
  return logs
    .filter((l) => !l.deleted)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date) || a.updatedAt - b.updatedAt)
    .flatMap((l) => {
      const raw = l[metric]
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return []
      const from: Unit | undefined = l.unit
      const value = metric === 'weight' && from && from !== unit ? round1(convertWeight(raw, from, unit)) : raw
      return [{ date: l.date, value }]
    })
}
