import { useDeferredValue, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react'
import type { Equipment, MuscleGroup } from '@/lib/types'
import { EQUIPMENT_LABEL, EXERCISES, MUSCLE_LABEL } from '@/data/exercises'
import { useApp } from '@/store/app'
import { Button, ChipButton, EmptyState, Header, IconButton, Sheet, toast } from '@/ui'
import { ExerciseRow, MUSCLE_ORDER } from './ExerciseRow'
import { CreateExerciseSheet } from './CreateExerciseSheet'
import { filterExercises, groupByMuscle, type EquipmentFilter } from './exerciseList'
import { PLACE_LABEL } from '../routines/routineUtils'
import './exercises.css'

const EQUIPMENT_CHOICES: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'smith', 'ez_bar', 'pullup_bar', 'bench']

/** `/exercises` also accepts `?pick=1`; the library simply behaves normally in that case (rows open the detail). */
export default function ExerciseLibraryScreen() {
  const [, navigate] = useLocation()
  const custom = useApp((s) => s.customExercises)
  const profileEquipment = useApp((s) => s.profile.equipment)
  const [query, setQuery] = useState('')
  const [muscle, setMuscle] = useState<MuscleGroup | 'all'>('all')
  const [equipment, setEquipment] = useState<EquipmentFilter>('all')
  const [equipOpen, setEquipOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const deferred = useDeferredValue(query)

  const all = useMemo(() => [...EXERCISES, ...custom], [custom])
  const list = useMemo(
    () => filterExercises(all, { query: deferred, muscle, equipment, profileEquipment }),
    [all, deferred, muscle, equipment, profileEquipment],
  )
  const searching = deferred.trim().length > 0
  const groups = useMemo(() => (searching || muscle !== 'all' ? null : groupByMuscle(list)), [list, searching, muscle])

  const equipLabel = equipment === 'all' ? 'Equipo' : equipment === 'mine' ? 'Mi equipo' : EQUIPMENT_LABEL[equipment]

  return (
    <main className="screen">
      <Header
        title="Ejercicios"
        eyebrow={`${all.length} en la biblioteca`}
        actions={
          <IconButton label="Crear ejercicio" variant="glass" onClick={() => setCreateOpen(true)}>
            <Plus size={22} />
          </IconButton>
        }
      />

      <div className="ex-sticky">
        <div className="ex-search">
          <Search size={20} className="ex-search__icon" aria-hidden="true" />
          <input
            className="input ex-search__input"
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Buscar por nombre o músculo"
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
        <div className="ex-chips" role="group" aria-label="Filtros">
          <ChipButton
            pressed={equipment !== 'all'}
            onClick={() => setEquipOpen(true)}
            icon={<SlidersHorizontal size={14} />}
          >
            {equipLabel}
          </ChipButton>
          <ChipButton pressed={muscle === 'all'} onClick={() => setMuscle('all')}>
            Todos
          </ChipButton>
          {MUSCLE_ORDER.map((m) => (
            <ChipButton key={m} pressed={muscle === m} onClick={() => setMuscle(muscle === m ? 'all' : m)}>
              {MUSCLE_LABEL[m]}
            </ChipButton>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Search size={28} />}
          title="Sin resultados"
          text={searching ? `No hay ejercicios que coincidan con “${query.trim()}”.` : 'Ningún ejercicio cumple estos filtros.'}
          action={
            <div className="row">
              <Button
                variant="glass"
                onClick={() => {
                  setQuery('')
                  setMuscle('all')
                  setEquipment('all')
                }}
              >
                Quitar filtros
              </Button>
              <Button variant="primary" icon={<Plus size={18} />} onClick={() => setCreateOpen(true)}>
                Crear ejercicio
              </Button>
            </div>
          }
        />
      ) : groups ? (
        groups.map((g) => (
          <section key={g.muscle} aria-label={MUSCLE_LABEL[g.muscle]}>
            <h2 className="section-title ex-group-title">
              {MUSCLE_LABEL[g.muscle]} · {g.items.length}
            </h2>
            <div className="ex-list glass">
              {g.items.map((ex) => (
                <ExerciseRow key={ex.id} ex={ex} href={`/exercises/${ex.id}`} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="stack" style={{ marginTop: 'var(--s-2)' }}>
          <div className="ex-count">
            {list.length} {list.length === 1 ? 'ejercicio' : 'ejercicios'}
          </div>
          <div className="ex-list glass">
            {list.map((ex) => (
              <ExerciseRow key={ex.id} ex={ex} href={`/exercises/${ex.id}`} />
            ))}
          </div>
        </div>
      )}

      <Sheet open={equipOpen} onClose={() => setEquipOpen(false)} title="Filtrar por equipo">
        <div className="ex-radio-list" role="radiogroup" aria-label="Equipo">
          {(
            [
              { value: 'all', label: 'Todo el equipo' },
              ...(profileEquipment ? [{ value: 'mine', label: `Mi equipo · ${PLACE_LABEL[profileEquipment]}` }] : []),
              ...EQUIPMENT_CHOICES.map((q) => ({ value: q, label: EQUIPMENT_LABEL[q] })),
            ] as { value: EquipmentFilter; label: string }[]
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={equipment === o.value}
              className="ex-radio"
              onClick={() => {
                setEquipment(o.value)
                setEquipOpen(false)
              }}
            >
              {o.label}
            </button>
          ))}
        </div>
      </Sheet>

      <CreateExerciseSheet
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(ex) => {
          toast.success(`“${ex.name}” creado`)
          navigate(`/exercises/${ex.id}`)
        }}
      />
    </main>
  )
}
