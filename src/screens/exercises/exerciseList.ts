/** Pure filtering / grouping for the exercise library and the picker. */
import type { Equipment, EquipmentProfile, Exercise, MuscleGroup } from '@/lib/types'
import { isAvailable, searchExercises } from '@/lib/recommend'
import { MUSCLE_ORDER } from './ExerciseRow'

/** 'all' = no filter, 'mine' = doable with the profile's equipment, or one specific equipment. */
export type EquipmentFilter = 'all' | 'mine' | Equipment

export interface ExerciseFilter {
  query?: string
  muscle?: MuscleGroup | 'all'
  equipment?: EquipmentFilter
  profileEquipment?: EquipmentProfile
  excludeIds?: readonly string[]
}

export function filterExercises(all: Exercise[], f: ExerciseFilter): Exercise[] {
  const exclude = new Set(f.excludeIds ?? [])
  const eq = f.equipment ?? 'all'
  return searchExercises(f.query ?? '', all).filter((ex) => {
    if (exclude.has(ex.id)) return false
    if (f.muscle && f.muscle !== 'all' && ex.primary !== f.muscle && !ex.secondary.includes(f.muscle)) return false
    if (eq === 'mine') return isAvailable(ex, f.profileEquipment)
    if (eq !== 'all') return ex.equipment.includes(eq)
    return true
  })
}

/** Groups by primary muscle in MUSCLE_ORDER, keeping the (alphabetical) order inside each group. */
export function groupByMuscle(list: Exercise[]): { muscle: MuscleGroup; items: Exercise[] }[] {
  const map = new Map<MuscleGroup, Exercise[]>()
  for (const ex of list) {
    const arr = map.get(ex.primary)
    if (arr) arr.push(ex)
    else map.set(ex.primary, [ex])
  }
  const known = MUSCLE_ORDER.filter((m) => map.has(m))
  const rest = [...map.keys()].filter((m) => !MUSCLE_ORDER.includes(m))
  return [...known, ...rest].map((muscle) => ({ muscle, items: map.get(muscle)! }))
}
