/**
 * Workout engine — PURE functions over WorkoutSession (no React, no store, no Date.now()
 * unless `now` is defaulted). The store calls these and persists the result.
 * STUB: implemented by the engine agent. Keep signatures stable.
 */
import type {
  CursorInfo,
  Exercise,
  LogSetInput,
  LogSetResult,
  ProgressionSuggestion,
  Routine,
  RoutineItem,
  SetLog,
  Unit,
  WorkoutSession,
} from '../types'

const TODO = (name: string): never => {
  throw new Error(`engine.${name} not implemented`)
}

/** Build a new in-progress session from a routine (or empty for a free workout).
 *  Pre-creates target.sets SetLogs per exercise, prefilled with the progression suggestion. */
export function createSession(
  _routine: Routine | null,
  _getExercise: (id: string) => Exercise | undefined,
  _history: WorkoutSession[],
  _unit: Unit,
  _now?: number,
): WorkoutSession {
  return TODO('createSession')
}

/** Double-progression suggestion for an exercise based on the most recent sessions. */
export function suggestProgression(
  _history: WorkoutSession[],
  _exerciseId: string,
  _item: Pick<RoutineItem, 'repsMin' | 'repsMax'>,
  _exercise: Exercise | undefined,
  _unit: Unit,
): ProgressionSuggestion {
  return TODO('suggestProgression')
}

export function logSet(
  _session: WorkoutSession,
  _input: LogSetInput,
  _history: WorkoutSession[],
  _now?: number,
): LogSetResult {
  return TODO('logSet')
}

export function undoLastSet(_session: WorkoutSession): WorkoutSession {
  return TODO('undoLastSet')
}

export function updateSet(
  _session: WorkoutSession,
  _exIndex: number,
  _setIndex: number,
  _patch: Partial<SetLog>,
): WorkoutSession {
  return TODO('updateSet')
}

export function addSet(_session: WorkoutSession, _exIndex: number): WorkoutSession {
  return TODO('addSet')
}

export function removeSet(_session: WorkoutSession, _exIndex: number, _setIndex: number): WorkoutSession {
  return TODO('removeSet')
}

export function skipExercise(_session: WorkoutSession, _exIndex: number): WorkoutSession {
  return TODO('skipExercise')
}

export function swapExercise(
  _session: WorkoutSession,
  _exIndex: number,
  _newExerciseId: string,
  _getExercise: (id: string) => Exercise | undefined,
  _history: WorkoutSession[],
): WorkoutSession {
  return TODO('swapExercise')
}

export function addExercise(
  _session: WorkoutSession,
  _exerciseId: string,
  _getExercise: (id: string) => Exercise | undefined,
  _history: WorkoutSession[],
  _defaultRestSec: number,
): WorkoutSession {
  return TODO('addExercise')
}

export function moveExercise(_session: WorkoutSession, _from: number, _to: number): WorkoutSession {
  return TODO('moveExercise')
}

export function setCursor(_session: WorkoutSession, _exIndex: number, _setIndex?: number): WorkoutSession {
  return TODO('setCursor')
}

export function startRest(_session: WorkoutSession, _durationSec: number, _now?: number): WorkoutSession {
  return TODO('startRest')
}

export function adjustRest(_session: WorkoutSession, _deltaSec: number, _now?: number): WorkoutSession {
  return TODO('adjustRest')
}

export function endRest(_session: WorkoutSession): WorkoutSession {
  return TODO('endRest')
}

/** Mark ended, drop never-done empty sets, keep done sets. */
export function finishSession(_session: WorkoutSession, _now?: number): WorkoutSession {
  return TODO('finishSession')
}

export function getCursorInfo(_session: WorkoutSession): CursorInfo {
  return TODO('getCursorInfo')
}
