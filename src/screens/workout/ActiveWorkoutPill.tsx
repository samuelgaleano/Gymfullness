import { Link } from 'wouter'
import { useApp } from '@/store/app'

/** Floating "resume workout" pill shown above the tab bar while a session is active. STUB — workout agent refines. */
export function ActiveWorkoutPill() {
  const active = useApp((s) => s.activeSession)
  if (!active) return null
  return (
    <Link
      href="/workout"
      className="glass"
      style={{
        position: 'fixed',
        left: '50%',
        transform: 'translateX(-50%)',
        bottom: 'calc(var(--safe-bottom) + var(--tabbar-h) + 20px)',
        padding: '10px 18px',
        borderRadius: 999,
        fontWeight: 600,
        zIndex: 41,
      }}
    >
      Entreno en curso · {active.name}
    </Link>
  )
}
