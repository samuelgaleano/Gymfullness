/**
 * Stats — PURE functions over completed sessions & body logs.
 * STUB: implemented by the engine agent. Keep signatures stable.
 */
import type { BodyLog, Exercise, MuscleGroup, SessionSummary, Unit, WorkoutSession } from './types'

const TODO = (name: string): never => {
  throw new Error(`stats.${name} not implemented`)
}

/** Epley estimated 1RM; reps 1 → weight; null when not computable. */
export function e1rm(_weight: number | null | undefined, _reps: number | null | undefined): number | null {
  return TODO('e1rm')
}

export function summarizeSession(
  _session: WorkoutSession,
  _getExercise: (id: string) => Exercise | undefined,
): SessionSummary {
  return TODO('summarizeSession')
}

export interface ExercisePoint {
  date: number
  bestWeight: number | null
  bestReps: number | null
  bestE1rm: number | null
  volume: number
  sets: number
}

/** One point per session that contains the exercise, oldest → newest, converted to `unit`. */
export function exerciseHistory(_sessions: WorkoutSession[], _exerciseId: string, _unit: Unit): ExercisePoint[] {
  return TODO('exerciseHistory')
}

export interface PersonalRecord {
  exerciseId: string
  bestE1rm: number | null
  bestWeight: number | null
  bestReps: number | null
  date: number
}

export function personalRecords(_sessions: WorkoutSession[], _unit: Unit): PersonalRecord[] {
  return TODO('personalRecords')
}

export interface WeekStat {
  weekStart: string // YYYY-MM-DD (Monday)
  sessions: number
  sets: number
  volume: number
  minutes: number
}

/** Last `weeks` weeks including the current one, oldest → newest. */
export function weeklyStats(_sessions: WorkoutSession[], _weeks: number, _unit: Unit, _now?: number): WeekStat[] {
  return TODO('weeklyStats')
}

/** Consecutive weeks (ending this week or last week) with ≥1 session; and sessions this week. */
export function streak(_sessions: WorkoutSession[], _now?: number): { weeks: number; thisWeek: number; total: number } {
  return TODO('streak')
}

/** Working sets per muscle in the last `days` days (primary = 1, secondary = 0.5). */
export function muscleSets(
  _sessions: WorkoutSession[],
  _getExercise: (id: string) => Exercise | undefined,
  _days: number,
  _now?: number,
): Partial<Record<MuscleGroup, number>> {
  return TODO('muscleSets')
}

/** Body metric series (oldest → newest), skipping null values, weight converted to `unit`. */
export function bodySeries(
  _logs: BodyLog[],
  _metric: 'weight' | 'bodyFat' | 'waist' | 'chest' | 'arm' | 'thigh' | 'hips' | 'neck',
  _unit: Unit,
): { date: string; value: number }[] {
  return TODO('bodySeries')
}
