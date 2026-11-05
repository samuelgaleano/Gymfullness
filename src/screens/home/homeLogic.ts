/** Pure helpers for the Home screen (week strip, smart tip, weekly weight prompt). */
import type { BodyLog, Exercise, MuscleGroup, WorkoutSession } from '@/lib/types'
import { MUSCLE_LABEL } from '@/data/exercises'
import { WEEKLY_SET_TARGET } from '@/lib/recommend'
import { muscleSets, sessionEnd, startOfWeek, streak } from '@/lib/stats'
import { fromDateKey, toDateKey } from '@/lib/date'

const DAY_MS = 86_400_000
const WEEKDAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']
const WEEKDAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export interface WeekDay {
  key: string
  label: string
  name: string
  trained: boolean
  today: boolean
  future: boolean
}

/** Monday → Sunday of the week containing `now`, flagging days with a completed session. */
export function weekDays(sessions: WorkoutSession[], now: number = Date.now()): WeekDay[] {
  const start = startOfWeek(now)
  const todayKey = toDateKey(now)
  const trained = new Set(sessions.filter((s) => !s.deleted && s.endedAt).map((s) => toDateKey(s.startedAt)))
  return WEEKDAYS.map((label, i) => {
    const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = toDateKey(d)
    return { key, label, name: WEEKDAY_NAMES[i], trained: trained.has(key), today: key === todayKey, future: key > todayKey }
  })
}

export type TipKind = 'muscle' | 'comeback' | 'goal'
export interface Tip {
  kind: TipKind
  text: string
}

/** Sets under this fraction of the weekly target count as "under-trained". */
const UNDER_RATIO = 0.4
/** Don't judge balance until the user has done a meaningful amount of work this week. */
const MIN_WEEK_SETS = 6

export function smartTip(args: {
  sessions: WorkoutSession[]
  getExercise: (id: string) => Exercise | undefined
  daysPerWeek: number
  now?: number
}): Tip | null {
  const { sessions, getExercise, daysPerWeek } = args
  const now = args.now ?? Date.now()
  const done = sessions.filter((s) => !s.deleted && s.endedAt)
  if (!done.length) return null

  const { thisWeek } = streak(done, now)
  const last = Math.max(...done.map((s) => sessionEnd(s)))
  const daysAgo = Math.round((fromDateKey(toDateKey(now)).getTime() - fromDateKey(toDateKey(last)).getTime()) / DAY_MS)

  if (thisWeek === 0 && daysAgo >= 5) {
    return { kind: 'comeback', text: `Han pasado ${daysAgo} días. Una sesión corta hoy retoma el ritmo.` }
  }

  if (thisWeek >= daysPerWeek) {
    return { kind: 'goal', text: 'Meta semanal cumplida. Descansar también es progresar.' }
  }

  const sets = muscleSets(done, getExercise, 7, now)
  const total = Object.values(sets).reduce((a, b) => a + (b ?? 0), 0)
  if (total >= MIN_WEEK_SETS) {
    let worst: { m: MuscleGroup; ratio: number; n: number; target: number } | null = null
    for (const [m, target] of Object.entries(WEEKLY_SET_TARGET) as [MuscleGroup, number][]) {
      const n = sets[m] ?? 0
      const ratio = n / target
      if (ratio < UNDER_RATIO && (!worst || ratio < worst.ratio)) worst = { m, ratio, n, target }
    }
    if (worst) {
      const label = MUSCLE_LABEL[worst.m].toLowerCase()
      const n = Math.floor(worst.n)
      return {
        kind: 'muscle',
        text:
          n === 0
            ? `Aún no has trabajado ${label} esta semana. Añade un ejercicio en tu próximo entreno.`
            : `Llevas solo ${n} ${n === 1 ? 'serie' : 'series'} de ${label} esta semana. Suma un ejercicio más.`,
      }
    }
  }
  return null
}

/** True when there is no body-weight log in the last 7 days and the prompt isn't snoozed. */
export function weightPromptDue(logs: BodyLog[], now: number = Date.now(), snoozedUntil = 0): boolean {
  if (now < snoozedUntil) return false
  const limit = toDateKey(now - 7 * DAY_MS)
  return !logs.some((l) => !l.deleted && typeof l.weight === 'number' && l.date > limit)
}

const SNOOZE_KEY = 'gymfullness:home:weight-snooze'

export function readSnooze(): number {
  try {
    return Number(localStorage.getItem(SNOOZE_KEY)) || 0
  } catch {
    return 0
  }
}

export function snoozeWeightPrompt(days = 7, now: number = Date.now()): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(now + days * DAY_MS))
  } catch {
    /* storage unavailable: the prompt simply reappears next visit */
  }
}
