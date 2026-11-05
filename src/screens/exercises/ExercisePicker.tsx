/**
 * ExercisePicker — bottom sheet to choose an exercise: search box, muscle filter chips,
 * "Recomendados" section (optional), full list. Used by the routine editor and the live workout.
 * SHARED CONTRACT: owned by the home-routines-ui agent. Props are fixed; STUB until replaced.
 */
export interface ExercisePickerProps {
  open: boolean
  onClose: () => void
  onPick: (exerciseId: string) => void
  title?: string // default 'Añadir ejercicio'
  /** Exercise ids to hide (already in the routine/session). */
  excludeIds?: string[]
  /** Exercise ids shown first under "Recomendados" (e.g. alternatives or add-on suggestions). */
  recommendedIds?: string[]
}

export function ExercisePicker(_props: ExercisePickerProps) {
  return null
}
