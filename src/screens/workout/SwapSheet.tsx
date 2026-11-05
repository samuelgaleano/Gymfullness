import { useMemo } from 'react'
import { Search } from 'lucide-react'
import { Button, Chip, Sheet } from '@/ui'
import { allExercises } from '@/store/app'
import { alternatives } from '@/lib/recommend'
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '@/data/exercises'
import type { EquipmentProfile, Exercise } from '@/lib/types'

/** Ids of the best substitutes for an exercise (also used to seed the picker's "Recomendados"). */
export function useAlternatives(exerciseId: string | undefined, equipment: EquipmentProfile | undefined, excludeIds: string[], limit = 6): Exercise[] {
  const key = excludeIds.join('|')
  return useMemo(() => {
    if (!exerciseId) return []
    const ex = new Set(excludeIds)
    return alternatives(exerciseId, allExercises(), equipment, limit + ex.size).filter((e) => !ex.has(e.id)).slice(0, limit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseId, equipment, key, limit])
}

export function SwapSheet({
  open,
  onClose,
  exerciseName,
  options,
  onPick,
  onSearch,
}: {
  open: boolean
  onClose: () => void
  exerciseName: string
  options: Exercise[]
  onPick: (id: string) => void
  onSearch: () => void
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Cambiar ejercicio"
      footer={
        <Button variant="glass" size="lg" block icon={<Search size={18} />} onClick={onSearch}>
          Buscar otro
        </Button>
      }
    >
      <p className="muted wk-swap__lead">Alternativas a {exerciseName} con tu equipo.</p>
      {options.length === 0 ? (
        <p className="muted">No encontramos alternativas directas. Busca otro ejercicio en la biblioteca.</p>
      ) : (
        <div className="wk-swap">
          {options.map((e) => (
            <button key={e.id} type="button" className="wk-swap__item glass" onClick={() => onPick(e.id)}>
              <div className="wk-swap__name">{e.name}</div>
              <div className="wk-swap__chips">
                <Chip tone="accent">{MUSCLE_LABEL[e.primary]}</Chip>
                {e.equipment.slice(0, 2).map((q) => (
                  <Chip key={q}>{EQUIPMENT_LABEL[q]}</Chip>
                ))}
              </div>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  )
}
