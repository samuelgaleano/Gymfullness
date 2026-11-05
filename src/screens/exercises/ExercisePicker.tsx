/**
 * ExercisePicker — bottom sheet to choose an exercise: search box, muscle filter chips,
 * "Recomendados" section (optional), full list. Used by the routine editor and the live workout.
 * SHARED CONTRACT: owned by the home-routines-ui agent. Props are fixed.
 */
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { Exercise, MuscleGroup } from '@/lib/types'
import { EXERCISES, MUSCLE_LABEL } from '@/data/exercises'
import { useApp } from '@/store/app'
import { ChipButton, IconButton, Sheet } from '@/ui'
import { ExerciseRow, MUSCLE_ORDER } from './ExerciseRow'
import { filterExercises } from './exerciseList'
import './exercises.css'

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

export function ExercisePicker({ open, onClose, onPick, title = 'Añadir ejercicio', excludeIds, recommendedIds }: ExercisePickerProps) {
  const custom = useApp((s) => s.customExercises)
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all')
  const deferred = useDeferredValue(query)

  // Fresh state each time the sheet opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setMuscle('all')
    }
  }, [open])

  const all = useMemo(() => [...EXERCISES, ...custom], [custom])
  const list = useMemo(
    () => filterExercises(all, { query: deferred, muscle, excludeIds }),
    [all, deferred, muscle, excludeIds],
  )

  const recommended = useMemo(() => {
    if (!recommendedIds?.length || deferred.trim() || muscle !== 'all') return []
    const hidden = new Set(excludeIds ?? [])
    const byId = new Map(all.map((e) => [e.id, e]))
    return recommendedIds.flatMap((id) => (byId.has(id) && !hidden.has(id) ? [byId.get(id) as Exercise] : []))
  }, [recommendedIds, excludeIds, all, deferred, muscle])

  const recSet = useMemo(() => new Set(recommended.map((e) => e.id)), [recommended])
  const rest = recommended.length ? list.filter((e) => !recSet.has(e.id)) : list

  const pick = (id: string) => {
    onPick(id)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="ex-pick">
        <div className="ex-pick__head">
          <div className="ex-search">
            <Search size={20} className="ex-search__icon" aria-hidden="true" />
            <input
              className="input ex-search__input"
              type="search"
              inputMode="search"
              enterKeyHint="search"
              autoFocus
              autoComplete="off"
              placeholder="Buscar ejercicio"
              aria-label="Buscar ejercicio"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <IconButton label="Borrar búsqueda" className="ex-search__clear" onClick={() => setQuery('')}>
                <X size={18} />
              </IconButton>
            )}
          </div>
          <div className="ex-chips" role="group" aria-label="Filtrar por músculo">
            <ChipButton pressed={muscle === 'all'} onClick={() => setMuscle('all')}>
              Todos
            </ChipButton>
            {MUSCLE_ORDER.map((m) => (
              <ChipButton key={m} pressed={muscle === m} onClick={() => setMuscle(m)}>
                {MUSCLE_LABEL[m]}
              </ChipButton>
            ))}
          </div>
        </div>

        <div className="ex-pick__list">
          {recommended.length > 0 && (
            <>
              <h3 className="section-title ex-group-title" style={{ marginTop: 0 }}>
                Recomendados
              </h3>
              <div className="ex-list glass">
                {recommended.map((ex) => (
                  <ExerciseRow key={ex.id} ex={ex} onClick={() => pick(ex.id)} hideChevron />
                ))}
              </div>
              <h3 className="section-title ex-group-title">Todos</h3>
            </>
          )}
          {rest.length > 0 ? (
            <div className="ex-list glass">
              {rest.map((ex) => (
                <ExerciseRow key={ex.id} ex={ex} onClick={() => pick(ex.id)} hideChevron />
              ))}
            </div>
          ) : (
            recommended.length === 0 && (
              <p className="ex-hint ex-pick__empty" style={{ textAlign: 'center' }}>
                No encontramos ejercicios con “{query.trim()}”. Prueba con otro nombre o músculo.
              </p>
            )
          )}
        </div>
      </div>
    </Sheet>
  )
}
