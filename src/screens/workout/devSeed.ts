/**
 * DEV ONLY: realistic data for screenshots and manual testing, exposed as `window.__seed`.
 * Imported dynamically by ActiveWorkoutPill under `import.meta.env.DEV`, so it never ships.
 *
 *   await __seed.start()      // routine + 3 past sessions + a fresh workout
 *   await __seed.midRest()    // 2 sets logged, rest running
 *   await __seed.nearlyDone() // all but the last 2 sets logged
 *   await __seed.finished()   // everything logged and saved → returns the session id
 */
import { getExercise, useApp } from '@/store/app'
import * as engine from '@/lib/workout/engine'
import { useAuthStore } from '@/store/auth'
import type { Routine, WorkoutSession } from '@/lib/types'

const DAY = 86_400_000
const NOW = () => Date.now()

const ITEMS = [
  { exerciseId: 'bench-press', sets: 4, repsMin: 8, repsMax: 12, restSec: 90, w: 70, reps: 10 },
  { exerciseId: 'incline-dumbbell-press', sets: 3, repsMin: 10, repsMax: 12, restSec: 75, w: 24, reps: 11 },
  { exerciseId: 'overhead-press', sets: 3, repsMin: 8, repsMax: 10, restSec: 90, w: 40, reps: 9 },
  { exerciseId: 'triceps-pushdown', sets: 3, repsMin: 12, repsMax: 15, restSec: 60, w: 30, reps: 13 },
  { exerciseId: 'plank', sets: 3, repsMin: 0, repsMax: 0, restSec: 45, targetSeconds: 45, w: 0, reps: 0 },
]

function routine(): Routine {
  const t = NOW()
  return {
    id: 'r_dev_push',
    name: 'Día A · Empuje',
    focus: 'Pecho · Hombros · Tríceps',
    createdAt: t,
    updatedAt: t,
    items: ITEMS.map((it, i) => ({
      id: `ri_${i}`,
      exerciseId: it.exerciseId,
      sets: it.sets,
      repsMin: it.repsMin,
      repsMax: it.repsMax,
      restSec: it.restSec,
      ...(it.targetSeconds ? { targetSeconds: it.targetSeconds } : {}),
    })),
  }
}

function pastSession(r: Routine, daysAgo: number, bump: number, history: WorkoutSession[]): WorkoutSession {
  const start = NOW() - daysAgo * DAY
  let s = engine.createSession(r, getExercise, history, 'kg', start)
  let t = start
  s.exercises.forEach((se, ei) => {
    const it = ITEMS.find((x) => x.exerciseId === se.exerciseId)!
    se.sets.forEach((_, si) => {
      t += 150_000
      const input =
        it.targetSeconds !== undefined
          ? { exIndex: ei, setIndex: si, seconds: 40 + bump * 5 }
          : { exIndex: ei, setIndex: si, weight: it.w + bump * 2.5, reps: it.reps - (si > 1 ? 1 : 0) }
      s = engine.logSet(s, input, history, t).session
    })
  })
  return engine.finishSession(s, t + 60_000)
}

function base(): Routine {
  const r = routine()
  const history: WorkoutSession[] = []
  for (const [days, bump] of [
    [14, 0],
    [8, 1],
    [3, 2],
  ] as const) {
    history.push(pastSession(r, days, bump, history))
  }
  const t = NOW()
  useApp.setState({
    profile: { onboarded: true, name: 'Alejo', goal: 'muscle', level: 'intermediate', daysPerWeek: 3, equipment: 'gym', updatedAt: t },
    routines: [r],
    plan: { routineIds: [r.id], daysPerWeek: 3, goal: 'muscle', level: 'intermediate', equipment: 'gym', updatedAt: t },
    sessions: history,
    bodyLogs: [],
    activeSession: null,
  })
  return r
}

function start(): WorkoutSession {
  const r = base()
  return useApp.getState().startWorkout(r.id)
}

/** Log up to `count` sets (null = all) using the prefilled values, optionally bumping the first weight for a PR. */
function logSome(count: number | null, opts: { pr?: boolean } = {}): void {
  const st = useApp.getState()
  let n = 0
  for (;;) {
    const s = useApp.getState().activeSession
    if (!s) return
    const info = engine.getCursorInfo(s)
    if (info.isFinished || (count !== null && n >= count)) return
    const input = opts.pr && n === 0 ? { weight: (info.exercise?.sets[info.setIndex]?.weight ?? 0) + 5 } : {}
    const res = st.logSet(input)
    if (!res) return
    n++
  }
}

const api = {
  /** Pretend cloud login is configured and this is a guest (shows the summary sign-in prompt). */
  guest: () => useAuthStore.setState({ cloudEnabled: true, status: 'guest' }),
  jump: (ex: number, set?: number) => useApp.getState().setCursor(ex, set),
  active: () => useApp.getState().activeSession,
  sessions: () => useApp.getState().sessions,
  reset: () => useApp.getState().resetAll(),
  base: () => base(),
  start: () => start(),
  midRest: () => {
    start()
    logSome(2)
    const s = useApp.getState().activeSession
    if (s && !s.rest) useApp.getState().startRest(90)
    return useApp.getState().activeSession
  },
  nearlyDone: () => {
    start()
    const total = useApp.getState().activeSession!.exercises.reduce((a, e) => a + e.sets.length, 0)
    logSome(total - 2)
    useApp.getState().endRest()
  },
  allDone: () => {
    start()
    logSome(null)
    useApp.getState().endRest()
  },
  finished: (): string | null => {
    start()
    logSome(null, { pr: true })
    const done = useApp.getState().finishWorkout()
    return done?.id ?? null
  },
}

declare global {
  interface Window {
    __seed?: typeof api
  }
}

if (import.meta.env.DEV && typeof window !== 'undefined') window.__seed = api

export default api
