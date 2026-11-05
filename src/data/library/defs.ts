/**
 * Internal definition shape for the built-in exercise library.
 * Each definition is an `Exercise` (minus the derived `videoQuery`) plus its movement pattern.
 */
import type { Exercise } from '../../lib/types'

/** Biomechanical movement pattern — drives alternatives ("Cambiar") and plan adaptation. */
export type MovementPattern =
  | 'horizontal_push'
  | 'vertical_push'
  | 'horizontal_pull'
  | 'vertical_pull'
  | 'shoulder_extension'
  | 'chest_fly'
  | 'lateral_raise'
  | 'front_raise'
  | 'rear_delt'
  | 'biceps'
  | 'triceps'
  | 'grip'
  | 'carry'
  | 'squat'
  | 'lunge'
  | 'hinge'
  | 'hip_extension'
  | 'hip_abduction'
  | 'knee_flexion'
  | 'knee_extension'
  | 'calf'
  | 'core_flexion'
  | 'core_stability'
  | 'core_rotation'
  | 'cardio' // steady-state machine cardio (minutes)
  | 'conditioning' // short bodyweight intervals (seconds)
  | 'full_body'

export type ExerciseDef = Omit<Exercise, 'videoQuery' | 'custom'> & { pattern: MovementPattern }
