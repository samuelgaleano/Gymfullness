import { Link } from 'wouter'
import { Dumbbell, Timer } from 'lucide-react'
import { useApp } from '@/store/app'
import { useElapsed } from '@/lib/workout/useElapsed'
import { useRestWithCues } from './useRestWithCues'
import { formatClock } from '@/lib/date'
import type { WorkoutSession } from '@/lib/types'
import './pill.css'

if (import.meta.env.DEV) void import('./devSeed')

/** Floating "resume workout" glass pill above the tab bar while a session is active. */
export function ActiveWorkoutPill() {
  const active = useApp((s) => s.activeSession)
  if (!active) return null
  return <Pill session={active} />
}

function Pill({ session }: { session: WorkoutSession }) {
  const elapsed = useElapsed(session.startedAt)
  const rest = useRestWithCues(session.rest)
  const resting = rest.active
  const done = session.exercises.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0)

  return (
    <Link
      href="/workout"
      className={`pill glass ${resting ? 'pill--rest' : ''}`}
      aria-label={`Volver al entreno ${session.name}. ${resting ? `Descanso, quedan ${formatClock(rest.remainingSec)}.` : `${formatClock(elapsed)} transcurridos.`}`}
    >
      <span className="pill__icon" aria-hidden="true">
        {resting ? <Timer size={20} /> : <Dumbbell size={20} />}
      </span>
      <span className="pill__text">
        <span className="pill__name truncate">{session.name}</span>
        <span className="pill__sub num">
          {resting ? 'Descanso' : `${done} ${done === 1 ? 'serie' : 'series'} hechas`}
        </span>
      </span>
      <span className="pill__time num">{resting ? formatClock(rest.remainingSec) : formatClock(elapsed)}</span>
      {resting && <span className="pill__bar" style={{ width: `${Math.round(rest.fraction * 100)}%` }} aria-hidden="true" />}
    </Link>
  )
}
