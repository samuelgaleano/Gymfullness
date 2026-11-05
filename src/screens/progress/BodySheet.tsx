import { useMemo, useState } from 'react'
import { Button, Sheet, Stepper, toast } from '@/ui'
import { useApp } from '@/store/app'
import type { BodyLog } from '@/lib/types'
import { toDateKey } from '@/lib/date'
import { BODY_METRICS, type BodyMetric } from './progressLogic'

type Key = 'weight' | BodyMetric
type Values = Partial<Record<Key, number | null>>

const WEIGHT_START = { kg: 70, lb: 155 }

/** Latest known value per field (so steppers continue from where the user left off). */
function latest(logs: BodyLog[]): Values {
  const out: Values = {}
  for (const l of logs) {
    for (const k of ['weight', ...BODY_METRICS.map((m) => m.key)] as Key[]) {
      const v = l[k]
      if (typeof v === 'number') out[k] = v
    }
  }
  return out
}

/** Bottom sheet to log weight + optional measurements. Only touched fields are saved. */
export function BodySheet({ open, onClose, logs }: { open: boolean; onClose: () => void; logs: BodyLog[] }) {
  if (!open) return null
  return <BodySheetForm onClose={onClose} logs={logs} />
}

function BodySheetForm({ onClose, logs }: { onClose: () => void; logs: BodyLog[] }) {
  const unit = useApp((s) => s.settings.unit)
  const upsert = useApp((s) => s.upsertBodyLog)
  const ref = useMemo(() => latest(logs), [logs])
  const [date, setDate] = useState(() => toDateKey())
  const [vals, setVals] = useState<Values>({})
  const touched = Object.keys(vals).length > 0

  const startOf = (k: Key): number => (k === 'weight' ? WEIGHT_START[unit] : BODY_METRICS.find((m) => m.key === k)!.start)
  const set = (k: Key, step: number) => (v: number | null) => {
    setVals((prev) => {
      const cur = prev[k] ?? null
      let next = v
      // Stepper counts from 0 when empty; continue from the last known value instead.
      if (cur === null && v !== null) {
        const base = ref[k] ?? startOf(k)
        if (v === step) next = Math.round((base + step) * 10) / 10
        else if (v === 0) next = Math.round((base - step) * 10) / 10
      }
      const copy = { ...prev }
      if (next === null) delete copy[k]
      else copy[k] = next
      return copy
    })
  }

  const save = () => {
    const entries = Object.entries(vals).filter(([, v]) => typeof v === 'number') as [Key, number][]
    if (!entries.length) return
    upsert({ date, unit, ...Object.fromEntries(entries) })
    toast.success(vals.weight !== undefined ? 'Peso guardado' : 'Medidas guardadas')
    onClose()
  }

  const placeholder = (k: Key) => String(ref[k] ?? startOf(k))

  return (
    <Sheet
      open
      onClose={onClose}
      title="Registrar medidas"
      footer={
        <Button variant="primary" size="lg" block disabled={!touched} onClick={save}>
          Guardar
        </Button>
      }
    >
      <div className="stack-lg pg-sheet">
        <div className="pg-sheet__weight">
          <Stepper
            label="Peso"
            unit={unit}
            value={vals.weight ?? null}
            onChange={set('weight', 0.1)}
            step={0.1}
            decimals={1}
            min={0}
            max={500}
            placeholder={placeholder('weight')}
          />
        </div>
        <div className="stack">
          <h3 className="section-title">Más medidas (opcional)</h3>
          <div className="pg-sheet__grid">
            {BODY_METRICS.map((m) => (
              <Stepper
                key={m.key}
                label={m.label}
                unit={m.unit}
                value={vals[m.key] ?? null}
                onChange={set(m.key, m.step)}
                step={m.step}
                decimals={1}
                min={0}
                max={m.key === 'bodyFat' ? 70 : 300}
                placeholder={placeholder(m.key)}
              />
            ))}
          </div>
        </div>
        <div className="field">
          <label className="field__label" htmlFor="pg-body-date">
            Fecha
          </label>
          <input
            id="pg-body-date"
            className="input"
            type="date"
            value={date}
            max={toDateKey()}
            onChange={(e) => e.target.value && setDate(e.target.value)}
          />
        </div>
      </div>
    </Sheet>
  )
}
