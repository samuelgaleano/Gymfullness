/**
 * Exercise alternatives & recommendations. STUB: data agent.
 */
import type { EquipmentProfile, Exercise, MuscleGroup } from './types'

/** Best substitutes for `exerciseId` (same primary muscle & movement, available equipment), best first. */
export function alternatives(
  _exerciseId: string,
  _all: Exercise[],
  _equipment: EquipmentProfile | undefined,
  _limit?: number,
): Exercise[] {
  throw new Error('recommend.alternatives not implemented')
}

/** Exercises to add to a session to balance it (muscles under-trained this week first). */
export function suggestAddOns(
  _currentExerciseIds: string[],
  _weeklyMuscleSets: Partial<Record<MuscleGroup, number>>,
  _all: Exercise[],
  _equipment: EquipmentProfile | undefined,
  _limit?: number,
): Exercise[] {
  throw new Error('recommend.suggestAddOns not implemented')
}

/** Accent/space-insensitive search over name + aliases. */
export function searchExercises(_query: string, _all: Exercise[]): Exercise[] {
  throw new Error('recommend.searchExercises not implemented')
}
