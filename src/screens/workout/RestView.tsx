import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { Chip, ProgressRing } from '@/ui'
import { loadStep } from '@/lib/workout/engine'
import { formatWeight } from '@/lib/units'
import { getExercise, useApp } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'
import { clock, formatSetValues, kindOfExercise } from './helpers'
import { useRestWithCues } from './useRestWithCues'

function useRingSize(): number {
  const calc = () => {
    if (typeof window === 'undefined') return 260
    return Math.round(Math.min(300, Math.max(190, Math.min(window.innerWidth * 0.7, window.innerHeight * 0.34))))
  }
  const [size, setSize] = useState(calc)
  useEffect(() => {
    const on = () => setSize(calc())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  return size
}

export function RestView({ session }: { session: WorkoutSession }) {
  const rest = session.rest
  const size = useRingSize()

  const timer = useRestWithCues(rest)

  const adjust = (d: number) => useApp.getState().adjustRest(d)

  if (!rest) return null
  const exIndex = Math.min(rest.nextExIndex, session.exercises.length - 1)
  const nextEx = session.exercises[exIndex]
  const nextSet = nextEx?.sets[rest.nextSetIndex]
  const exercise = nextEx ? getExercise(nextEx.exerciseId) : undefined
  const kind = kindOfExercise(exercise, nextEx)
  const newExercise = !!nextEx && rest.nextSetIndex === 0 && exIndex !== 0
  const last = timer.remainingSec <= 5

  return (
    <section className="wk-rest" aria-label="Descanso">
      <div className="wk-rest__ring">
        <ProgressRing value={1 - timer.fraction} size={size} stroke={14} color="var(--rest)">
          <div className="wk-rest__center">
            <div className="wk-rest__label">Descanso</div>
            <div className={`wk-rest__time num ${last ? 'wk-rest__time--last' : ''}`} role="timer" aria-live="off">
              {clock(timer.remainingSec)}
            </div>
            <div className="wk-rest__of num">de {clock(rest.durationSec)}</div>
          </div>
        </ProgressRing>
      </div>
      <span className="sr-only" aria-live="polite">
        {timer.remainingSec <= 3 && timer.remainingSec > 0 ? timer.remainingSec : ''}
      </span>

      <div className="wk-rest__adjust">
        <button type="button" className="wk-pillbtn" onClick={() => adjust(-15)} aria-label="Restar 15 segundos">
          <Minus size={18} aria-hidden="true" /> 15 s
        </button>
        <button type="button" className="wk-pillbtn" onClick={() => adjust(15)} aria-label="Sumar 15 segundos">
          <Plus size={18} aria-hidden="true" /> 15 s
        </button>
      </div>

      {nextEx && nextSet && (
        <div className="wk-next glass">
          <div className="wk-next__top">
            <span className="wk-next__eyebrow">Siguiente</span>
            {newExercise && <Chip tone="rest">Nuevo ejercicio</Chip>}
          </div>
          <div className="wk-next__name truncate">{exercise?.name ?? 'Ejercicio'}</div>
          <div className="wk-next__row">
            <div className="wk-next__set num">
              Serie {rest.nextSetIndex + 1} de {nextEx.sets.length}
              <span className="wk-next__vals"> · {formatSetValues(nextSet, kind, session.unit)}</span>
            </div>
            {kind === 'weight_reps' && <NextWeight session={session} exIndex={exIndex} setIndex={rest.nextSetIndex} />}
          </div>
        </div>
      )}
    </section>
  )
}

/** Quick −/+ of the next set's load; carries to the remaining sets of that exercise. */
function NextWeight({ session, exIndex, setIndex }: { session: WorkoutSession; exIndex: number; setIndex: number }) {
  const se = session.exercises[exIndex]
  const set = se?.sets[setIndex]
  if (!se || !set) return null
  const step = loadStep(getExercise(se.exerciseId), session.unit)
  const bump = (dir: 1 | -1) => {
    const base = set.weight ?? 0
    const w = Math.max(0, Math.round((base + dir * step) * 100) / 100)
    const st = useApp.getState()
    se.sets.forEach((x, i) => {
      if (i >= setIndex && !x.done) st.updateActiveSet(exIndex, i, { weight: w })
    })
    if (navigator.vibrate) navigator.vibrate(8)
  }
  return (
    <div className="wk-nextw" role="group" aria-label="Peso de la siguiente serie">
      <button type="button" className="wk-nextw__btn" onClick={() => bump(-1)} aria-label="Menos peso">
        <Minus size={18} />
      </button>
      <span className="wk-nextw__val num">
        {formatWeight(set.weight)} <small>{session.unit}</small>
      </span>
      <button type="button" className="wk-nextw__btn" onClick={() => bump(1)} aria-label="Más peso">
        <Plus size={18} />
      </button>
    </div>
  )
}
