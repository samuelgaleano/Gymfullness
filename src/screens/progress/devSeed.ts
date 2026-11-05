/**
 * Dev-only data seeding for screenshots / manual QA (never imported by app code, so it stays out of
 * the production bundle). From a Playwright page on the dev server:
 *   const m = await import('/src/screens/progress/devSeed.ts'); m.seedProgress()
 */
import { useApp, getExercise } from '@/store/app'
import { createSession } from '@/lib/workout/engine'
import { generatePlan } from '@/lib/planner'
import { e1rm } from '@/lib/stats'
import { toDateKey } from '@/lib/date'
import type { BodyLog, WorkoutSession } from '@/lib/types'

const DAY = 86_400_000

/** Small deterministic PRNG so screenshots are reproducible. */
function rng(seed: number) {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash(s: string): number {
  let h = 7
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h
}

export function seedProgressEmpty(): void {
  const st = useApp.getState()
  st.resetAll()
  useApp.setState({ profile: { onboarded: true, name: 'Ana', updatedAt: Date.now() } })
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
}

/** ~16 weeks of 3–4 sessions/week with progressive overload, a rest week, a few PRs and body logs. */
export function seedProgress(opts: { weeks?: number; goal?: 'fat_loss' | 'muscle' } = {}): void {
  seedProgressEmpty()
  const weeks = opts.weeks ?? 16
  const rand = rng(42)
  const now = Date.now()
  const { plan, routines } = generatePlan({ goal: opts.goal ?? 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym' }, now)
  const best = new Map<string, number>()
  const sessions: WorkoutSession[] = []
  let n = 0

  const today = new Date(now)
  const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7))
  for (let w = weeks - 1; w >= 0; w--) {
    if (w === 8) continue // a rest week so the heatmap has a gap
    const perWeek = w % 3 === 1 ? 3 : 4
    const days = [0, 1, 3, 4, 5].slice(0, perWeek === 4 ? 4 : 3)
    for (const [i, dow] of days.entries()) {
      const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - w * 7 + dow, 18 + Math.floor(rand() * 2), Math.floor(rand() * 50))
      if (day.getTime() > now - 3_600_000) continue
      const routine = routines[(n++) % routines.length]
      const base = createSession(routine, getExercise, [], 'kg')
      const startedAt = day.getTime()
      const progress = (weeks - w) * 0.012
      const s: WorkoutSession = {
        ...base,
        id: `seed-${n}`,
        startedAt,
        endedAt: startedAt + (48 + Math.floor(rand() * 22)) * 60_000,
        updatedAt: startedAt,
        rest: null,
        exercises: base.exercises.map((e, ei) => {
          const ex = getExercise(e.exerciseId)
          const compound = ex?.isCompound ?? true
          const start = (compound ? 38 : 12) + (hash(e.exerciseId) % 24)
          const raw = start * (1 + progress) + (rand() - 0.5) * 2
          const weight = Math.max(2.5, Math.round(raw / (ex?.increment ?? 2.5)) * (ex?.increment ?? 2.5))
          return {
            ...e,
            sets: e.sets.map((x, si) => {
              const reps = Math.max(4, e.target.repsMax - (si > 1 ? 1 : 0) - (rand() < 0.2 ? 1 : 0))
              const noWeight = ex?.kind !== 'weight_reps'
              const est = noWeight ? null : e1rm(weight, reps)
              const prev = best.get(e.exerciseId) ?? 0
              const isPR = est !== null && est > prev + 0.01 && prev > 0 && si === 0
              if (est !== null && est > prev) best.set(e.exerciseId, est)
              return {
                ...x,
                weight: noWeight ? null : weight,
                reps: ex?.kind === 'time' ? null : reps,
                seconds: ex?.kind === 'time' ? 30 + Math.round(progress * 60) : x.seconds,
                done: true,
                completedAt: startedAt + (ei * 6 + si * 2 + 1) * 60_000,
                isPR,
              }
            }),
          }
        }),
      }
      sessions.push(s)
      void i
    }
  }

  // Body: weekly weight (slow downward trend) + measurements every ~2 weeks.
  const bodyLogs: BodyLog[] = []
  for (let w = weeks - 1; w >= 0; w--) {
    const d = now - w * 7 * DAY - Math.floor(rand() * 2) * DAY
    const t = (weeks - 1 - w) / (weeks - 1)
    const log: BodyLog = {
      id: `body-${w}`,
      date: toDateKey(d),
      weight: Math.round((78.4 - 2.6 * t + (rand() - 0.5) * 0.9) * 10) / 10,
      unit: 'kg',
      updatedAt: d,
    }
    if (w % 2 === 0) {
      log.bodyFat = Math.round((19.6 - 1.5 * t + (rand() - 0.5) * 0.3) * 10) / 10
      log.waist = Math.round((87 - 3 * t) * 2) / 2
      log.arm = Math.round((34.5 + 1.2 * t) * 2) / 2
      log.chest = Math.round((99 + 1.5 * t) * 2) / 2
      if (w % 4 === 0) {
        log.thigh = Math.round((57 + 1 * t) * 2) / 2
        log.hips = Math.round((97 - 1 * t) * 2) / 2
        log.neck = 37
      }
    }
    bodyLogs.push(log)
  }

  useApp.setState({
    profile: { name: 'Ana', goal: opts.goal ?? 'muscle', level: 'intermediate', daysPerWeek: 4, equipment: 'gym', onboarded: true, updatedAt: now },
    plan,
    routines,
    sessions,
    bodyLogs,
  })
}
