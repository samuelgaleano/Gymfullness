import { generatePlan } from '@/lib/planner'
import { useApp } from '@/store/app'
import { planInputFromProfile } from './settingsHelpers'

/**
 * Rebuilds the plan from the profile answers. Routines that were generated from a template for the
 * previous plan are retired (tombstoned) so Rutinas does not fill up with duplicates; routines the
 * user created by hand are kept.
 */
export function regeneratePlanFromProfile(): void {
  const st = useApp.getState()
  const input = planInputFromProfile(st.profile)
  const { plan, routines } = generatePlan(input)
  const old = new Set(st.plan?.routineIds ?? [])
  for (const r of st.routines) {
    if (old.has(r.id) && r.templateId && !r.deleted) st.deleteRoutine(r.id)
  }
  useApp.getState().setPlan(plan, routines)
}
