import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'

export interface StepperProps {
  label: string
  value: number | null
  onChange: (v: number | null) => void
  step?: number
  min?: number
  max?: number
  unit?: string
  /** Decimal places allowed when typing. */
  decimals?: number
  placeholder?: string
  id?: string
}

/** Big glanceable number with −/+ buttons; tap the number to type. */
export function Stepper({ label, value, onChange, step = 1, min = 0, max = 9999, unit, decimals = 0, placeholder = '0', id }: StepperProps) {
  const [draft, setDraft] = useState<string>(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])

  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const round = (n: number) => Number(n.toFixed(Math.max(decimals, String(step).split('.')[1]?.length ?? 0)))
  const bump = (dir: 1 | -1) => {
    const base = value ?? 0
    onChange(round(clamp(base + dir * step)))
    if (navigator.vibrate) navigator.vibrate(8)
  }
  const commit = () => {
    const t = draft.replace(',', '.').trim()
    if (t === '') return onChange(null)
    const n = Number(t)
    if (Number.isFinite(n)) onChange(round(clamp(n)))
    else setDraft(value === null ? '' : String(value))
  }

  return (
    <div className="stepper">
      <label className="stepper__label" htmlFor={id}>
        {label}
      </label>
      <div className="stepper__ctrl glass">
        <button type="button" className="stepper__btn" aria-label={`Menos ${label}`} onClick={() => bump(-1)}>
          <Minus size={22} />
        </button>
        <input
          id={id}
          className="stepper__value num"
          inputMode={decimals > 0 || String(step).includes('.') ? 'decimal' : 'numeric'}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          onFocus={(e) => e.target.select()}
          aria-label={label}
        />
        <button type="button" className="stepper__btn" aria-label={`Más ${label}`} onClick={() => bump(1)}>
          <Plus size={22} />
        </button>
      </div>
      {unit && <div className="stepper__unit">{unit}</div>}
    </div>
  )
}
