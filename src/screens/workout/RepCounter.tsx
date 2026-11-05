import { useState } from 'react'
import { Check, Minus, X } from 'lucide-react'
import { Button, IconButton } from '@/ui'
import { haptic } from '@/lib/audio'

/** Full-screen tap-anywhere rep counter. The total fills the reps stepper when done. */
export function RepCounter({
  title,
  subtitle,
  vibration,
  onDone,
  onClose,
}: {
  title: string
  subtitle: string
  vibration: boolean
  onDone: (reps: number) => void
  onClose: () => void
}) {
  const [count, setCount] = useState(0)

  const add = () => {
    setCount((c) => Math.min(100, c + 1))
    haptic('tick', vibration)
  }
  const sub = () => setCount((c) => Math.max(0, c - 1))

  return (
    <div className="wk-counter" role="dialog" aria-modal="true" aria-label="Contador de repeticiones">
      <button type="button" className="wk-counter__tap" onClick={add} aria-label="Sumar una repetición" />
      <div className="wk-counter__head">
        <div className="wk-counter__titles">
          <div className="wk-counter__title truncate">{title}</div>
          <div className="wk-counter__sub">{subtitle}</div>
        </div>
        <IconButton label="Cerrar contador" variant="glass" onClick={onClose}>
          <X size={22} />
        </IconButton>
      </div>
      <div className="wk-counter__center" aria-live="polite">
        <div className="wk-counter__num num">{count}</div>
        <div className="wk-counter__hint">Toca en cualquier parte para contar</div>
      </div>
      <div className="wk-counter__foot">
        <IconButton label="Restar una repetición" variant="glass" size="lg" onClick={sub}>
          <Minus size={26} />
        </IconButton>
        <Button
          variant="primary"
          size="xl"
          className="wk-counter__done"
          disabled={count === 0}
          icon={<Check size={26} />}
          onClick={() => onDone(count)}
        >
          Usar {count} {count === 1 ? 'rep' : 'reps'}
        </Button>
      </div>
    </div>
  )
}
