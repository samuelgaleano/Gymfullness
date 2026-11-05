import { ChevronRight } from 'lucide-react'
import { Link } from 'wouter'
import type { Exercise, MuscleGroup } from '@/lib/types'
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '@/data/exercises'

/** Display order for muscle filters and grouped lists. */
export const MUSCLE_ORDER: MuscleGroup[] = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'forearms',
  'cardio',
  'full_body',
]

export function ExerciseBadges({ ex }: { ex: Exercise }) {
  return (
    <span className="ex-badges">
      <span className="ex-badge ex-badge--muscle">{MUSCLE_LABEL[ex.primary]}</span>
      {ex.equipment.slice(0, 2).map((e) => (
        <span key={e} className="ex-badge">
          {EQUIPMENT_LABEL[e]}
        </span>
      ))}
      {ex.custom && <span className="ex-badge ex-badge--custom">Propio</span>}
    </span>
  )
}

interface RowProps {
  ex: Exercise
  href?: string
  onClick?: () => void
  hideChevron?: boolean
}

/** Large (≥ 60 px) exercise row used by the library, the picker and "alternatives". */
export function ExerciseRow({ ex, href, onClick, hideChevron }: RowProps) {
  const inner = (
    <>
      <span className="ex-row__main">
        <span className="ex-row__name truncate">{ex.name}</span>
        <ExerciseBadges ex={ex} />
      </span>
      {!hideChevron && <ChevronRight size={18} className="ex-row__chev" aria-hidden="true" />}
    </>
  )
  if (href)
    return (
      <Link href={href} className="ex-row">
        {inner}
      </Link>
    )
  return (
    <button type="button" className="ex-row" onClick={onClick}>
      {inner}
    </button>
  )
}
