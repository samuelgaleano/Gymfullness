import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import type { Equipment, Exercise, ExerciseKind, MuscleGroup } from '@/lib/types'
import { EQUIPMENT_LABEL, MUSCLE_LABEL } from '@/data/exercises'
import { uid } from '@/lib/id'
import { useApp } from '@/store/app'
import { Button, ChipButton, Field, Segmented, Sheet } from '@/ui'
import { MUSCLE_ORDER } from './ExerciseRow'
import './exercises.css'

const EQUIPMENT_CHOICES: Equipment[] = ['barbell', 'dumbbell', 'machine', 'cable', 'bodyweight', 'kettlebell', 'band', 'smith', 'ez_bar', 'pullup_bar', 'bench']
const KIND_OPTIONS: { value: ExerciseKind; label: string }[] = [
  { value: 'weight_reps', label: 'Peso y reps' },
  { value: 'reps', label: 'Solo reps' },
  { value: 'time', label: 'Tiempo' },
]

/** Builds the Exercise object for a user-made exercise (exported for tests). */
export function buildCustomExercise(input: { name: string; primary: MuscleGroup; equipment: Equipment; kind: ExerciseKind }): Exercise {
  const name = input.name.trim().replace(/\s+/g, ' ')
  return {
    id: `custom-${uid()}`,
    name,
    aliases: [],
    primary: input.primary,
    secondary: [],
    equipment: [input.equipment],
    kind: input.kind,
    level: 'beginner',
    isCompound: false,
    defaultRestSec: input.kind === 'time' ? 45 : 75,
    increment: input.kind === 'weight_reps' ? (input.equipment === 'barbell' ? 2.5 : 2) : 0,
    setup: [],
    cues: [],
    mistakes: [],
    custom: true,
  }
}

export function CreateExerciseSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (ex: Exercise) => void }) {
  const upsert = useApp((s) => s.upsertCustomExercise)
  const [name, setName] = useState('')
  const [primary, setPrimary] = useState<MuscleGroup | null>(null)
  const [equipment, setEquipment] = useState<Equipment>('dumbbell')
  const [kind, setKind] = useState<ExerciseKind>('weight_reps')

  useEffect(() => {
    if (open) {
      setName('')
      setPrimary(null)
      setEquipment('dumbbell')
      setKind('weight_reps')
    }
  }, [open])

  const valid = name.trim().length >= 2 && primary !== null

  const save = () => {
    if (!valid || !primary) return
    const ex = buildCustomExercise({ name, primary, equipment, kind })
    upsert(ex)
    onCreated(ex)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Crear ejercicio"
      footer={
        <Button variant="primary" size="lg" block icon={<Check size={20} />} disabled={!valid} onClick={save}>
          Guardar ejercicio
        </Button>
      }
    >
      <form
        className="ex-form"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <Field label="Nombre" htmlFor="ex-new-name">
          <input
            id="ex-new-name"
            className="input"
            placeholder="Ej. Remo con banda"
            maxLength={60}
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <div className="field">
          <span className="field__label" id="ex-new-muscle">
            Músculo principal
          </span>
          <div className="ex-choices" role="group" aria-labelledby="ex-new-muscle">
            {MUSCLE_ORDER.map((m) => (
              <ChipButton key={m} pressed={primary === m} onClick={() => setPrimary(m)}>
                {MUSCLE_LABEL[m]}
              </ChipButton>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field__label" id="ex-new-equipment">
            Equipo
          </span>
          <div className="ex-choices" role="group" aria-labelledby="ex-new-equipment">
            {EQUIPMENT_CHOICES.map((q) => (
              <ChipButton key={q} pressed={equipment === q} onClick={() => setEquipment(q)}>
                {EQUIPMENT_LABEL[q]}
              </ChipButton>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="field__label">¿Cómo se mide?</span>
          <Segmented label="Tipo de medición" value={kind} options={KIND_OPTIONS} onChange={setKind} />
        </div>
      </form>
    </Sheet>
  )
}
