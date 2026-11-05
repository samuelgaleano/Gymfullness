/**
 * Dev-only data seeding for screenshots / manual QA. Never imported by app code, so it is
 * not part of the production bundle. From a Playwright page on the dev server:
 *   const m = await import('/src/screens/home/devSeed.ts'); await m.seedPopulated()
 */
import { useApp, getExercise } from '@/store/app'
import { createSession } from '@/lib/workout/engine'
import { generatePlan } from '@/lib/planner'
import type { WorkoutSession } from '@/lib/types'
import { toDateKey } from '@/lib/date'

const DAY = 86_400_000

export function seedEmpty(opts: { onboarded?: boolean } = {}): void {
  const st = useApp.getState()
  st.resetAll()
  useApp.setState({ profile: { onboarded: opts.onboarded ?? true, updatedAt: Date.now() } })
  try {
    localStorage.clear()
  } catch {
    /* ignore */
  }
}

/** A plan, 8 completed sessions (some PRs), old body weight. */
export function seedPopulated(opts: { daysAgo?: number[]; name?: string } = {}): void {
  seedEmpty()
  const now = Date.now()
  const { plan, routines } = generatePlan({ goal: 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym' }, now)
  const sessions: WorkoutSession[] = []
  const offsets = opts.daysAgo ?? [20, 17, 13, 10, 6, 4, 2]
  offsets.forEach((d, i) => {
    const routine = routines[i % routines.length]
    const base = createSession(routine, getExercise, [], 'kg')
    const startedAt = now - d * DAY - 3_600_000
    const s: WorkoutSession = {
      ...base,
      id: `seed-${i}`,
      startedAt,
      endedAt: startedAt + 52 * 60_000,
      updatedAt: startedAt,
      rest: null,
      exercises: base.exercises.map((e, ei) => ({
        ...e,
        sets: e.sets.map((x, si) => ({
          ...x,
          weight: e.target.weight ?? 20 + ei * 5 + i * 2.5,
          reps: e.target.repsMax - (si === 2 ? 2 : 0),
          done: true,
          completedAt: startedAt + (ei * 5 + si) * 60_000,
          isPR: i === offsets.length - 1 && ei < 2 && si === 0,
        })),
      })),
    }
    sessions.push(s)
  })
  useApp.setState({
    profile: { name: opts.name ?? 'Ana', goal: 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym', onboarded: true, updatedAt: now },
    plan,
    routines,
    sessions,
    bodyLogs: [{ id: 'b1', date: toDateKey(now - 12 * DAY), weight: 68.4, unit: 'kg', updatedAt: now - 12 * DAY }],
  })
}

/** Starts the next routine so Home shows the "Continuar entreno" hero. */
export function seedActive(): void {
  const st = useApp.getState()
  st.startWorkout(st.plan?.routineIds[0] ?? null)
}
