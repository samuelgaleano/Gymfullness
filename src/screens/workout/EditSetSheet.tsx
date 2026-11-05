import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { Button, Sheet, Stepper } from '@/ui'
import { loadStep } from '@/lib/workout/engine'
import { getExercise } from '@/store/app'
import type { SetLog, WorkoutSession } from '@/lib/types'
import { kindOfExercise } from './helpers'

export function EditSetSheet({
  session,
  exIndex,
  setIndex,
  onClose,
  onSave,
  onDelete,
}: {
  session: WorkoutSession
  exIndex: number
  setIndex: number | null
  onClose: () => void
  onSave: (exIndex: number, setIndex: number, patch: Partial<SetLog>) => void
  onDelete: (exIndex: number, setIndex: number) => void
}) {
  const se = session.exercises[exIndex]
  const set = setIndex !== null ? se?.sets[setIndex] : undefined
  return (
    <Sheet open={setIndex !== null && !!set} onClose={onClose} title={set ? `Editar serie ${(setIndex ?? 0) + 1}` : 'Editar serie'}>
      {se && set && setIndex !== null && (
        <Body
          key={set.id}
          session={session}
          exIndex={exIndex}
          setIndex={setIndex}
          onSave={(patch) => {
            onSave(exIndex, setIndex, patch)
            onClose()
          }}
          onDelete={() => {
            onDelete(exIndex, setIndex)
            onClose()
          }}
        />
      )}
    </Sheet>
  )
}

function Body({
  session,
  exIndex,
  setIndex,
  onSave,
  onDelete,
}: {
  session: WorkoutSession
  exIndex: number
  setIndex: number
  onSave: (patch: Partial<SetLog>) => void
  onDelete: () => void
}) {
  const se = session.exercises[exIndex]
  const set = se.sets[setIndex]
  const ex = getExercise(se.exerciseId)
  const kind = kindOfExercise(ex, se)
  const [weight, setWeight] = useState<number | null>(set.weight)
  const [reps, setReps] = useState<number | null>(set.reps)
  const [seconds, setSeconds] = useState<number | null>(set.seconds ?? null)
  const step = loadStep(ex, session.unit)

  const save = () => {
    if (kind === 'time') onSave({ seconds })
    else if (kind === 'reps') onSave({ reps })
    else onSave({ weight, reps })
  }

  return (
    <div className="wk-edit">
      <p className="muted wk-edit__name">{ex?.name}</p>
      <div className={`wk-steppers ${kind === 'weight_reps' ? 'wk-steppers--two' : ''}`}>
        {kind === 'time' ? (
          <Stepper label="Tiempo" unit="segundos" value={seconds} onChange={setSeconds} step={5} max={3600} />
        ) : (
          <>
            {kind === 'weight_reps' && (
              <Stepper label="Peso" unit={session.unit} value={weight} onChange={setWeight} step={step} max={1000} decimals={step % 1 ? 1 : 0} />
            )}
            <Stepper label="Reps" unit="repeticiones" value={reps} onChange={setReps} max={100} />
          </>
        )}
      </div>
      <div className="wk-edit__actions">
        <Button variant="primary" size="lg" block onClick={save}>
          Guardar
        </Button>
        <Button variant="danger" size="lg" block icon={<Trash2 size={18} />} onClick={onDelete}>
          Eliminar serie
        </Button>
      </div>
    </div>
  )
}
