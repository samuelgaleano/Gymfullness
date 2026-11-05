import { Suspense, lazy } from 'react'
import { useLocation } from 'wouter'
import { Sparkles } from 'lucide-react'
import { useApp } from '@/store/app'
import { openAssistant, useAssistantUi } from './assistantStore'
import './assistant.css'

const AssistantSheet = lazy(() => import('./AssistantSheet'))

/** Routes where a floating button would be in the way (home and workout have their own entries). */
const NO_FAB = [/^\/$/, /^\/welcome/, /^\/workout/, /^\/summary/]

/** Global mount: the sheet (loaded on first use) + a route-aware floating entry button. */
export function AssistantHost() {
  const [path] = useLocation()
  const everOpened = useAssistantUi((s) => s.everOpened)
  const open = useAssistantUi((s) => s.open)
  const hasActive = useApp((s) => s.activeSession !== null)
  const onboarded = useApp((s) => s.profile.onboarded)
  const showFab = onboarded && !open && !NO_FAB.some((r) => r.test(path))
  return (
    <>
      {showFab && (
        <button type="button" className={`as-fab ${hasActive ? 'as-fab--up' : ''}`} aria-label="Abrir asistente" onClick={() => openAssistant()}>
          <Sparkles size={22} />
        </button>
      )}
      {everOpened && (
        <Suspense fallback={null}>
          <AssistantSheet />
        </Suspense>
      )}
    </>
  )
}

/** Home: glass pill "Pregúntale a tu entrenador". */
export function AssistantPill() {
  return (
    <button type="button" className="as-pill glass" onClick={() => openAssistant()}>
      <span className="as-pill__icon" aria-hidden="true">
        <Sparkles size={18} />
      </span>
      <span className="as-pill__text">
        <span className="as-pill__title">Pregúntale a tu entrenador</span>
        <span className="as-pill__sub">Habla o escribe: «80 por 10», «¿cómo voy?»</span>
      </span>
    </button>
  )
}

/** Workout: small button next to the primary action, right by the mic. */
export function AssistantWorkoutButton() {
  return (
    <button type="button" className="as-wkbtn" aria-label="Abrir asistente" onClick={() => openAssistant()}>
      <Sparkles size={22} />
    </button>
  )
}
