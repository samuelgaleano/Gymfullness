/** Pure helpers for the live workout screen (no React, no store). */
import type { Exercise, ExerciseKind, SessionExercise, SetLog, Unit, WorkoutSession } from '@/lib/types'
import { convertWeight, formatWeight, roundWeight } from '@/lib/units'
import { e1rm } from '@/lib/stats'

export interface SetValues {
  weight: number | null
  reps: number | null
  seconds: number | null
}

const isPos = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

export function kindOfExercise(ex: Exercise | undefined, se?: SessionExercise): ExerciseKind {
  if (ex) return ex.kind
  return isPos(se?.target.targetSeconds) ? 'time' : 'weight_reps'
}

/** '80 kg × 10', '12 reps', '45 s' — what a set looks like in lists. */
export function formatSetValues(v: Partial<SetValues>, kind: ExerciseKind, unit: Unit): string {
  if (kind === 'time') return isPos(v.seconds) ? formatSecondsShort(v.seconds) : '–'
  if (kind === 'reps') return isPos(v.reps) ? `${v.reps} ${v.reps === 1 ? 'rep' : 'reps'}` : '–'
  if (isPos(v.weight) && isPos(v.reps)) return `${formatWeight(v.weight)} ${unit} × ${v.reps}`
  if (isPos(v.reps)) return `${v.reps} ${v.reps === 1 ? 'rep' : 'reps'}`
  if (isPos(v.weight)) return `${formatWeight(v.weight)} ${unit}`
  return '–'
}

/** Compact version for chips: '80×10', '12', '45 s'. */
export function formatSetCompact(v: Partial<SetValues>, kind: ExerciseKind): string {
  if (kind === 'time') return isPos(v.seconds) ? formatSecondsShort(v.seconds) : '–'
  if (kind === 'reps') return isPos(v.reps) ? String(v.reps) : '–'
  if (isPos(v.weight) && isPos(v.reps)) return `${formatWeight(v.weight)}×${v.reps}`
  if (isPos(v.reps)) return String(v.reps)
  return '–'
}

/** 45 → '45 s', 90 → '1:30 min', 120 → '2 min' */
export function formatSecondsShort(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m}:${String(r).padStart(2, '0')} min` : `${m} min`
}

/** 'mm:ss' for big countdowns. */
export function clock(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** '8–12 reps · Descanso 90 s' / '30 s · Descanso 60 s' */
export function targetLine(se: SessionExercise, kind: ExerciseKind): string {
  const t = se.target
  const rest = `Descanso ${t.restSec < 120 ? `${t.restSec} s` : formatSecondsShort(t.restSec)}`
  if (kind === 'time') {
    const sec = t.targetSeconds
    return [isPos(sec) ? formatSecondsShort(sec) : null, rest].filter(Boolean).join(' · ')
  }
  const range = t.repsMin === t.repsMax ? `${t.repsMax}` : `${t.repsMin}–${t.repsMax}`
  return `${range} reps · ${rest}`
}

/** Heaviest/best working set of the most recent past session with this exercise, in `unit`. */
export function lastPerformance(
  history: WorkoutSession[],
  exerciseId: string,
  unit: Unit,
  excludeSessionId?: string,
): (SetValues & { at: number }) | null {
  let latest: WorkoutSession | null = null
  let latestSets: SetLog[] = []
  for (const s of history) {
    if (s.deleted || s.id === excludeSessionId) continue
    const sets = s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets.filter((x) => x.done && !x.isWarmup))
    if (!sets.length) continue
    if (!latest || s.startedAt > latest.startedAt) {
      latest = s
      latestSets = sets
    }
  }
  if (!latest) return null
  const from = latest.unit
  const conv = (w: number | null) => (w === null ? null : from === unit ? w : roundWeight(convertWeight(w, from, unit), unit))
  let best = latestSets[0]
  let bestScore = -1
  for (const s of latestSets) {
    const score = e1rm(s.weight, s.reps) ?? (s.reps ?? 0) + (s.seconds ?? 0) / 100
    if (score > bestScore) {
      best = s
      bestScore = score
    }
  }
  return { weight: conv(best.weight), reps: best.reps, seconds: best.seconds ?? null, at: latest.startedAt }
}

/** Number of sets still to do in non-skipped exercises. */
export function remainingSets(session: WorkoutSession): number {
  let n = 0
  for (const se of session.exercises) if (!se.skipped) n += se.sets.filter((s) => !s.done).length
  return n
}

export function loggedSets(session: WorkoutSession): number {
  return session.exercises.reduce((a, se) => a + se.sets.filter((s) => s.done).length, 0)
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/** Per-exercise progress for the segmented bar: fill 0..1 and state. */
export function segments(session: WorkoutSession): { fill: number; skipped: boolean; current: boolean }[] {
  return session.exercises.map((se, i) => {
    const total = se.sets.length
    const done = se.sets.filter((s) => s.done).length
    return {
      fill: total ? done / total : se.skipped ? 0 : 0,
      skipped: !!se.skipped && done < total,
      current: i === session.cursor.ex,
    }
  })
}

/** The set values used to prefill after "repite / igual": last done set of the exercise, else the set at cursor. */
export function lastDoneSet(se: SessionExercise): SetLog | null {
  let best: SetLog | null = null
  for (const s of se.sets) if (s.done && (!best || (s.completedAt ?? 0) >= (best.completedAt ?? 0))) best = s
  return best
}

/** What the voice assistant says when a rest ends. */
export function restEndAnnouncement(session: WorkoutSession, exName: (id: string) => string): string {
  const rest = session.rest
  const exIndex = rest?.nextExIndex ?? session.cursor.ex
  const setIndex = rest?.nextSetIndex ?? session.cursor.set
  const se = session.exercises[exIndex]
  if (!se) return 'Descanso terminado.'
  const where = `serie ${setIndex + 1} de ${se.sets.length}`
  if (setIndex === 0) return `Descanso terminado. Siguiente: ${exName(se.exerciseId)}, ${where}.`
  return `Descanso terminado. ${where[0].toUpperCase()}${where.slice(1)}.`
}

/** YouTube search link for the exercise technique. */
export function videoUrl(ex: Exercise): string {
  const q = ex.videoQuery?.trim() || `como hacer ${ex.name} tecnica correcta`
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`
}

/** Short recent-history line given to the coach. */
export function recentSummaryFor(last: ReturnType<typeof lastPerformance>, ex: Exercise | undefined, unit: Unit): string | undefined {
  if (!last || !ex) return undefined
  return `Última vez: ${formatSetValues(last, ex.kind, unit)}`
}
