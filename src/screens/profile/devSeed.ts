/**
 * Dev-only helpers for screenshots / manual QA (never imported by app code):
 *   const m = await import('/src/screens/profile/devSeed.ts'); m.seedProfile()
 */
import { useApp, getExercise } from '@/store/app'
import { useAuthStore } from '@/store/auth'
import { createSession } from '@/lib/workout/engine'
import { generatePlan } from '@/lib/planner'
import type { WorkoutSession } from '@/lib/types'

export function seedFirstRun(): void {
  useApp.getState().resetAll()
}

export function seedProfile(opts: { signedIn?: boolean } = {}): void {
  const st = useApp.getState()
  st.resetAll()
  const now = Date.now()
  const { plan, routines } = generatePlan({ goal: 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym' }, now)
  st.setPlan(plan, routines)
  st.updateProfile({ onboarded: true, name: 'Camila Ríos', goal: 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym', heightCm: 168, birthYear: 1994, sex: 'female' })
  const sessions: WorkoutSession[] = [0, 1, 2].map((i) => {
    const base = createSession(routines[i % routines.length], getExercise, [], 'kg')
    const startedAt = now - (i + 1) * 2 * 86_400_000
    return {
      ...base,
      id: `seed-${i}`,
      startedAt,
      endedAt: startedAt + 50 * 60_000,
      exercises: base.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, weight: s.weight ?? 40, reps: s.reps ?? 10, done: true })) })),
    }
  })
  useApp.setState({ sessions })
  if (opts.signedIn) {
    useAuthStore.setState({
      status: 'signed_in',
      cloudEnabled: true,
      user: { uid: 'u1', name: 'Camila Ríos', email: 'camila@example.com', photoURL: null },
      lastSyncAt: now - 2 * 60_000,
    })
  }
}

export function seedCloudGuest(): void {
  useAuthStore.setState({ cloudEnabled: true, status: 'guest' })
}
