/**
 * PlanWizard — 3-4 quick questions (goal, days/week, place/equipment, level) → generatePlan() → store.setPlan().
 * SHARED CONTRACT: owned by the home-routines-ui agent; imported by Welcome (onboarding) and Routines.
 * Props are fixed; implementation is a STUB until replaced.
 */
import type { Plan } from '@/lib/types'

export interface PlanWizardProps {
  /** Called after the plan + routines are saved to the store. */
  onDone: (plan: Plan) => void
  /** Optional "Saltar" action (onboarding). */
  onSkip?: () => void
  /** Render without its own outer card/padding (inside a Sheet or onboarding page). */
  embedded?: boolean
}

export function PlanWizard(_props: PlanWizardProps) {
  return null
}
