import { Check, ListOrdered, Plus } from 'lucide-react'
import { EmptyState } from '@/ui'
import { formatDuration } from '@/lib/date'
import { plural } from './helpers'

/** Calm "all done" state: one obvious next step (Ver resumen, in the bottom bar). */
export function CompleteView({
  logged,
  durationSec,
  onAdd,
  onOverview,
}: {
  logged: number
  durationSec: number
  onAdd: () => void
  onOverview: () => void
}) {
  return (
    <section className="wk-done" aria-live="polite">
      <div className="wk-done__badge" aria-hidden="true">
        <Check size={44} strokeWidth={3} />
      </div>
      <h1 className="wk-done__title">Entreno completo</h1>
      <p className="wk-done__text">
        {plural(logged, 'serie', 'series')} en {formatDuration(durationSec)}. Buen trabajo.
      </p>
      <div className="wk-done__links">
        <button type="button" className="wk-pillbtn" onClick={onAdd}>
          <Plus size={18} aria-hidden="true" /> Añadir ejercicio
        </button>
        <button type="button" className="wk-pillbtn" onClick={onOverview}>
          <ListOrdered size={18} aria-hidden="true" /> Ver series
        </button>
      </div>
    </section>
  )
}

export function NothingToDo({ onAdd, onDiscard }: { onAdd: () => void; onDiscard: () => void }) {
  return (
    <EmptyState
      icon={<Plus size={28} />}
      title="No hay nada pendiente"
      text="Añade un ejercicio para empezar a registrar series, o descarta este entreno."
      action={
        <div className="wk-done__links">
          <button type="button" className="wk-pillbtn" onClick={onAdd}>
            <Plus size={18} aria-hidden="true" /> Añadir ejercicio
          </button>
          <button type="button" className="wk-pillbtn" onClick={onDiscard}>
            Descartar
          </button>
        </div>
      }
    />
  )
}
