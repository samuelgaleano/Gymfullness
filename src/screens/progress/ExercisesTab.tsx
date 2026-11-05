import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { Dumbbell, Search, X } from 'lucide-react'
import { Button, EmptyState, IconButton } from '@/ui'
import { Sparkline } from '@/ui/charts'
import { getExercise, useApp } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'
import { exerciseRows, filterExerciseRows, formatMetric, METRIC_LABEL } from './progressLogic'

export function ExercisesTab({ sessions, onOpenExercise }: { sessions: WorkoutSession[]; onOpenExercise: (id: string) => void }) {
  const [, navigate] = useLocation()
  const unit = useApp((s) => s.settings.unit)
  const customCount = useApp((s) => s.customExercises.length)
  const [query, setQuery] = useState('')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => exerciseRows(sessions, unit, getExercise), [sessions, unit, customCount])
  const filtered = useMemo(() => filterExerciseRows(rows, query), [rows, query])

  if (rows.length === 0) {
    return (
      <EmptyState
        icon={<Dumbbell size={30} />}
        title="Aún no hay ejercicios"
        text="Cuando completes series verás aquí la evolución de cada ejercicio."
        action={
          <Button variant="primary" size="lg" onClick={() => navigate('/')}>
            Empezar entreno
          </Button>
        }
      />
    )
  }

  return (
    <div className="stack">
      <div className="pg-search">
        <Search size={18} aria-hidden="true" />
        <input
          className="pg-search__input"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          placeholder="Buscar ejercicio"
          aria-label="Buscar ejercicio"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <IconButton label="Borrar búsqueda" size="sm" onClick={() => setQuery('')}>
            <X size={16} />
          </IconButton>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="Sin resultados" text={`No encontramos "${query.trim()}" entre tus ejercicios.`} />
      ) : (
        <div className="list glass">
          {filtered.map((r) => (
            <button key={r.id} type="button" className="list-row pg-ex" onClick={() => onOpenExercise(r.id)}>
              <div className="grow">
                <div className="list-row__title pg-wrap">{r.name}</div>
                <div className="list-row__sub">
                  {r.sessions} {r.sessions === 1 ? 'sesión' : 'sesiones'}
                </div>
              </div>
              <Sparkline values={r.spark} width={64} height={28} color="var(--accent)" />
              <div className="pg-ex__val">
                <div className="pg-ex__last num">{r.last !== null ? formatMetric(r.metric, r.last, unit) : '–'}</div>
                <div className="pg-ex__best num">
                  {r.best !== null && r.best !== r.last ? `Mejor ${formatMetric(r.metric, r.best, unit)}` : METRIC_LABEL[r.metric]}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
