import { ArrowDown, ArrowUp, Check, Plus, SkipForward } from 'lucide-react'
import { Button, Sheet } from '@/ui'
import { getExercise } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'

export function OverviewSheet({
  open,
  onClose,
  session,
  onJump,
  onMove,
  onSkip,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  session: WorkoutSession
  onJump: (i: number) => void
  onMove: (from: number, to: number) => void
  onSkip: (i: number) => void
  onAdd: () => void
}) {
  const n = session.exercises.length
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Tu entreno"
      footer={
        <Button variant="glass" size="lg" block icon={<Plus size={18} />} onClick={onAdd}>
          Añadir ejercicio
        </Button>
      }
    >
      <ol className="wk-ov">
        {session.exercises.map((se, i) => {
          const done = se.sets.filter((s) => s.done).length
          const total = se.sets.length
          const complete = total > 0 && done === total
          const current = i === session.cursor.ex
          const name = getExercise(se.exerciseId)?.name ?? 'Ejercicio'
          return (
            <li key={se.id} className={`wk-ov__row glass ${current ? 'wk-ov__row--cur' : ''} ${se.skipped ? 'wk-ov__row--skip' : ''}`}>
              <button type="button" className="wk-ov__main" onClick={() => onJump(i)} aria-label={`Ir a ${name}`}>
                <span className={`wk-ov__badge ${complete ? 'wk-ov__badge--done' : ''}`}>
                  {complete ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>
                <span className="wk-ov__text">
                  <span className="wk-ov__name truncate">{name}</span>
                  <span className="wk-ov__sub num">
                    {se.skipped && done < total ? 'Saltado' : `${done} de ${total} series`}
                    {current && !se.skipped ? ' · ahora' : ''}
                  </span>
                </span>
              </button>
              <div className="wk-ov__tools">
                <button type="button" className="wk-ov__btn" disabled={i === 0} onClick={() => onMove(i, i - 1)} aria-label={`Subir ${name}`}>
                  <ArrowUp size={18} />
                </button>
                <button type="button" className="wk-ov__btn" disabled={i === n - 1} onClick={() => onMove(i, i + 1)} aria-label={`Bajar ${name}`}>
                  <ArrowDown size={18} />
                </button>
                <button type="button" className="wk-ov__btn" disabled={complete || !!se.skipped} onClick={() => onSkip(i)} aria-label={`Saltar ${name}`}>
                  <SkipForward size={18} />
                </button>
              </div>
            </li>
          )
        })}
      </ol>
      {n === 0 && <p className="muted">Todavía no hay ejercicios en este entreno.</p>}
    </Sheet>
  )
}
