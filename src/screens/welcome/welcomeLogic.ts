import { generatePlan } from '@/lib/planner'
import { useApp } from '@/store/app'

/** Onboarding defaults used when the user skips the questions. */
export const DEFAULT_SETUP = { goal: 'muscle', level: 'beginner', daysPerWeek: 3, equipment: 'gym' } as const

/** True when the store already holds something worth keeping (restored from cloud or a backup). */
export function hasUserData(): boolean {
  const s = useApp.getState()
  return s.plan !== null || s.sessions.some((x) => !x.deleted) || s.routines.some((r) => !r.deleted)
}

/** Creates the default full-body-ish plan unless a plan already exists, so Home always has a routine. */
export function ensureDefaultPlan(): void {
  const st = useApp.getState()
  if (st.plan && st.routines.some((r) => !r.deleted && st.plan?.routineIds.includes(r.id))) return
  const { plan, routines } = generatePlan({ ...DEFAULT_SETUP })
  st.setPlan(plan, routines)
  if (!st.profile.goal) st.updateProfile({ ...DEFAULT_SETUP })
}

/** Marks onboarding done (name optional) so the router lets the user into Home. */
export function finishOnboarding(name: string): void {
  const n = name.trim().slice(0, 40)
  useApp.getState().updateProfile(n ? { onboarded: true, name: n } : { onboarded: true })
}

/**
 * After a Google sign-in the cloud sync pulls data asynchronously. Resolves true as soon as user data
 * shows up in the store, false when the sync finished empty or the wait timed out.
 */
export async function waitForRemoteData(opts: {
  isSyncing: () => boolean
  lastSyncAt: () => number | null
  since: number
  timeoutMs?: number
  intervalMs?: number
}): Promise<boolean> {
  const { timeoutMs = 7000, intervalMs = 250 } = opts
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (hasUserData() || useApp.getState().profile.onboarded) return true
    const done = (opts.lastSyncAt() ?? 0) >= opts.since && !opts.isSyncing()
    if (done && Date.now() - t0 > 800) return hasUserData() || useApp.getState().profile.onboarded
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  return hasUserData()
}
