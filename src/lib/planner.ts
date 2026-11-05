/**
 * Plan generation from onboarding answers + "what's next" logic. Pure (ids via uid, time via `now`).
 */
import type { EquipmentProfile, Exercise, Goal, Level, Plan, Routine, RoutineItem, WorkoutSession } from './types'
import { uid } from './id'
import { EXERCISES, getBuiltinExercise, patternOf } from '../data/exercises'
import { SPLIT_LABEL, TEMPLATES, TEMPLATE_EQUIPMENT, type RoutineTemplate, type TemplateSplit } from '../data/templates'
import { alternatives, LEVEL_RANK } from './recommend'

export interface PlanInput {
  goal: Goal
  level: Level
  daysPerWeek: number // 2..6
  equipment: EquipmentProfile
}

/* ------------------------------------------------------------------ */
/* Onboarding options (Spanish copy)                                   */
/* ------------------------------------------------------------------ */

export interface Option<T> {
  value: T
  label: string
  description: string
}

export const GOAL_OPTIONS: Option<Goal>[] = [
  { value: 'muscle', label: 'Ganar músculo', description: 'Más masa muscular con series de 8–12 repeticiones.' },
  { value: 'strength', label: 'Ganar fuerza', description: 'Levantar más peso con series pesadas y descansos largos.' },
  { value: 'fat_loss', label: 'Perder grasa', description: 'Entrenos ágiles con descansos cortos para gastar más energía.' },
  { value: 'health', label: 'Salud y bienestar', description: 'Moverte mejor y sentirte bien, sin complicarte.' },
]

export const LEVEL_OPTIONS: Option<Level>[] = [
  { value: 'beginner', label: 'Principiante', description: 'Estás empezando o vuelves después de un tiempo sin entrenar.' },
  { value: 'intermediate', label: 'Intermedio', description: 'Entrenas de forma constante desde hace más de 6 meses.' },
  { value: 'advanced', label: 'Avanzado', description: 'Llevas años entrenando y dominas la técnica.' },
]

export const EQUIPMENT_OPTIONS: Option<EquipmentProfile>[] = [
  { value: 'gym', label: 'Gimnasio', description: 'Barras, mancuernas, máquinas y poleas.' },
  { value: 'home_dumbbells', label: 'Casa con mancuernas', description: 'Mancuernas y un banco o superficie firme.' },
  { value: 'bodyweight', label: 'Sin equipo', description: 'Solo tu peso corporal, en casa o en el parque.' },
]

const DAYS = [2, 3, 4, 5, 6] as const

/**
 * Days-per-week choices; the description names the split the planner will pick for that level
 * (advanced lifters get Empuje / Tirón / Pierna at 3 and 5 days).
 */
export function daysOptionsFor(level: Level): Option<number>[] {
  return DAYS.map((value) => {
    const split = preferredSplit(value, level)
    const description = split === 'upper_lower' && value === 5 ? `${SPLIT_LABEL[split]} en rotación` : SPLIT_LABEL[split]
    return { value, label: `${value} días`, description }
  })
}

/** Days-per-week choices for beginners and intermediates (see daysOptionsFor for a level-aware list). */
export const DAYS_OPTIONS: Option<number>[] = daysOptionsFor('intermediate')

const SCHEME_COPY: Record<Goal, string> = {
  muscle: '3–4 series de 8–12 reps · descanso de 90–120 s',
  strength: 'Básicos 4–5 × 4–6 reps (descanso de 2:30–3 min) · accesorios 3 × 8–10',
  fat_loss: '3 series de 12–15 reps · descansos cortos de 45–60 s',
  health: '2–3 series de 10–12 reps · descanso de 60–75 s',
}

/** One-line description of the sets/reps/rest scheme a goal uses, for UI copy. */
export function describeScheme(goal: Goal): string {
  return SCHEME_COPY[goal]
}

/* ------------------------------------------------------------------ */
/* Template selection                                                  */
/* ------------------------------------------------------------------ */

export function clampDays(days: number): number {
  if (!Number.isFinite(days)) return 3
  return Math.min(6, Math.max(2, Math.round(days)))
}

function preferredSplit(days: number, level: Level): TemplateSplit {
  if (days <= 2) return 'full_body'
  if (days === 3) return level === 'advanced' ? 'ppl' : 'full_body'
  if (days === 4) return 'upper_lower'
  if (days === 5) return level === 'advanced' ? 'ppl' : 'upper_lower'
  return 'ppl'
}

/** Best template for the answers (never the 'quick' one — that is a manual choice). */
export function pickTemplate(input: PlanInput): RoutineTemplate {
  const days = clampDays(input.daysPerWeek)
  const split = preferredSplit(days, input.level)
  const pool = TEMPLATES.filter((t) => t.equipment === input.equipment && t.split !== 'quick')
  const found =
    pool.find((t) => t.split === split) ?? pool.find((t) => t.daysPerWeek.includes(days)) ?? pool[0] ?? TEMPLATES[0]
  return found
}

/** Short summary for a confirmation screen, e.g. 'Torso / Pierna · 4 días por semana'. */
export function describePlan(input: PlanInput): string {
  const days = clampDays(input.daysPerWeek)
  return `${pickTemplate(input).name} · ${days} días por semana`
}

/* ------------------------------------------------------------------ */
/* Goal scheme                                                         */
/* ------------------------------------------------------------------ */

export type ItemRole = 'main' | 'accessory' | 'core' | 'hold' | 'conditioning' | 'cardio'

export type ItemTargets = Pick<RoutineItem, 'sets' | 'repsMin' | 'repsMax' | 'restSec' | 'targetSeconds'>

/** Role of an exercise inside a routine. `mainSlot` = one of the day's first big compound lifts (2, or 3 on full-body days). */
export function roleOf(ex: Exercise, mainSlot = false): ItemRole {
  const pattern = patternOf(ex.id)
  if (pattern === 'cardio') return 'cardio'
  if (pattern === 'conditioning') return 'conditioning'
  if (ex.primary === 'core') return ex.kind === 'time' ? 'hold' : 'core'
  if (ex.kind === 'time') return ex.primary === 'cardio' ? 'conditioning' : 'hold'
  return mainSlot ? 'main' : 'accessory'
}

function canBeMain(ex: Exercise): boolean {
  return ex.isCompound && ex.kind !== 'time' && ex.primary !== 'core' && ex.primary !== 'cardio' && ex.primary !== 'full_body'
}

function setsFor(role: ItemRole, goal: Goal, level: Level): number {
  if (role === 'cardio') return 1
  if (role === 'main') {
    if (goal === 'muscle') return level === 'beginner' ? 3 : 4
    if (goal === 'strength') return level === 'advanced' ? 5 : 4
    return 3
  }
  const base = goal === 'health' ? 2 : 3
  return Math.max(2, level === 'beginner' ? base - 1 : base)
}

const WEIGHTED_REPS: Record<Goal, { main: [number, number]; accessory: [number, number] }> = {
  muscle: { main: [8, 12], accessory: [8, 12] },
  strength: { main: [4, 6], accessory: [8, 10] },
  fat_loss: { main: [12, 15], accessory: [12, 15] },
  health: { main: [10, 12], accessory: [10, 12] },
}

type Difficulty = 'hard' | 'medium' | 'easy'

/** Bodyweight/band exercises can't add load, so rep ranges scale with relative difficulty instead. */
const BODYWEIGHT_REPS: Record<Goal, Record<Difficulty, [number, number]>> = {
  muscle: { hard: [6, 12], medium: [10, 15], easy: [12, 20] },
  strength: { hard: [4, 8], medium: [6, 10], easy: [8, 12] },
  fat_loss: { hard: [8, 12], medium: [12, 15], easy: [15, 20] },
  health: { hard: [5, 10], medium: [8, 12], easy: [10, 15] },
}

const UPPER_BODY = new Set(['chest', 'back', 'shoulders', 'biceps', 'triceps'])

/**
 * How hard a no-load exercise is for this user: exercise level minus user level, where lower-body,
 * core and band work count one step easier (you can do many more squats than push-ups).
 */
export function relativeDifficulty(ex: Exercise, level: Level): Difficulty {
  const intrinsic = LEVEL_RANK[ex.level] - (UPPER_BODY.has(ex.primary) ? 0 : 1) - (ex.equipment.includes('band') ? 1 : 0)
  const d = intrinsic - LEVEL_RANK[level]
  return d >= 0 ? 'hard' : d === -1 ? 'medium' : 'easy'
}

function repsFor(ex: Exercise, role: ItemRole, goal: Goal, level: Level): [number, number] {
  if (ex.kind === 'reps') return BODYWEIGHT_REPS[goal][relativeDifficulty(ex, level)]
  return WEIGHTED_REPS[goal][role === 'main' ? 'main' : 'accessory']
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function restFor(ex: Exercise, role: ItemRole, goal: Goal): number {
  switch (role) {
    case 'cardio':
      return 60
    case 'conditioning':
      return goal === 'fat_loss' ? 30 : clamp(ex.defaultRestSec, 30, 60)
    case 'core':
    case 'hold':
      return goal === 'fat_loss' ? 45 : clamp(ex.defaultRestSec, 45, 60)
    case 'main':
    case 'accessory': {
      if (goal === 'strength') {
        if (role === 'accessory') return 90
        return ex.equipment.includes('barbell') || ex.equipment.includes('smith') ? 180 : 150
      }
      if (goal === 'muscle') return ex.isCompound ? 120 : 90
      if (goal === 'fat_loss') return ex.isCompound ? 60 : 45
      return ex.isCompound ? 75 : 60
    }
  }
}

function secondsFor(role: ItemRole, goal: Goal, level: Level): number | undefined {
  if (role === 'cardio') return goal === 'fat_loss' || level === 'advanced' ? 900 : level === 'beginner' ? 600 : 750
  if (role === 'hold' || role === 'conditioning') return level === 'beginner' ? 30 : level === 'intermediate' ? 40 : 45
  return undefined
}

/**
 * Sets/reps/rest for one exercise under a goal + level. Use it too when the user adds an exercise
 * to a routine by hand (`mainSlot` false). 'time' exercises get `targetSeconds` and reps 0.
 */
export function prescribe(ex: Exercise, goal: Goal, level: Level, mainSlot = false): ItemTargets {
  const role = roleOf(ex, mainSlot && canBeMain(ex))
  const sets = setsFor(role, goal, level)
  const restSec = restFor(ex, role, goal)
  if (ex.kind === 'time') {
    return { sets, repsMin: 0, repsMax: 0, restSec, targetSeconds: secondsFor(role, goal, level) ?? 30 }
  }
  const [repsMin, repsMax] = repsFor(ex, role, goal, level)
  return { sets, repsMin, repsMax, restSec }
}

/* ------------------------------------------------------------------ */
/* Routine building                                                    */
/* ------------------------------------------------------------------ */

/**
 * How many of a day's first compound lifts get the main-lift scheme. Full-body days train a lower,
 * a push and a pull pattern, so all three are main lifts (otherwise the pull always gets fewer sets).
 */
function mainSlotsFor(split: TemplateSplit): number {
  return split === 'full_body' || split === 'quick' ? 3 : 2
}

/** Replace exercises above the user's level with the closest doable alternative (same profile). */
function adaptForLevel(ids: string[], level: Level, profile: EquipmentProfile): string[] {
  const allowed = TEMPLATE_EQUIPMENT[profile]
  const out: string[] = []
  ids.forEach((id, i) => {
    const ex = getBuiltinExercise(id)
    if (!ex || LEVEL_RANK[ex.level] <= LEVEL_RANK[level]) {
      out.push(id)
      return
    }
    const taken = new Set([...out, ...ids.slice(i + 1)])
    const swap = alternatives(id, EXERCISES, undefined, EXERCISES.length).find(
      (c) => LEVEL_RANK[c.level] <= LEVEL_RANK[level] && !taken.has(c.id) && c.equipment.every((e) => allowed.includes(e)),
    )
    out.push(swap ? swap.id : id)
  })
  return out
}

/** Turn a template into fresh routines with the goal scheme applied. */
export function buildRoutinesFromTemplate(
  template: RoutineTemplate,
  input: Pick<PlanInput, 'goal' | 'level'>,
  now: number = Date.now(),
): Routine[] {
  const quick = template.split === 'quick'
  return template.days.map((day) => {
    const ids = adaptForLevel(day.exerciseIds, input.level, template.equipment)
    let mainSlots = mainSlotsFor(template.split)
    const items: RoutineItem[] = []
    for (const exerciseId of ids) {
      const ex = getBuiltinExercise(exerciseId)
      if (!ex) continue
      const isMain = mainSlots > 0 && canBeMain(ex)
      if (isMain) mainSlots--
      const t = prescribe(ex, input.goal, input.level, isMain)
      const item: RoutineItem = {
        id: uid('ri_'),
        exerciseId,
        sets: quick ? Math.min(t.sets, 3) : t.sets,
        repsMin: t.repsMin,
        repsMax: t.repsMax,
        restSec: quick ? Math.min(t.restSec, 60) : t.restSec,
      }
      if (t.targetSeconds !== undefined) item.targetSeconds = t.targetSeconds
      items.push(item)
    }
    return {
      id: uid('r_'),
      name: day.name,
      focus: day.focus,
      items,
      templateId: template.id,
      createdAt: now,
      updatedAt: now,
    }
  })
}

/** Plan + routines from an explicit template (e.g. "Usar esta plantilla" in Rutinas). */
export function generatePlanFromTemplate(
  template: RoutineTemplate,
  input: PlanInput,
  now: number = Date.now(),
): { plan: Plan; routines: Routine[] } {
  const routines = buildRoutinesFromTemplate(template, input, now)
  const plan: Plan = {
    routineIds: routines.map((r) => r.id),
    daysPerWeek: clampDays(input.daysPerWeek),
    goal: input.goal,
    level: input.level,
    equipment: template.equipment,
    updatedAt: now,
  }
  return { plan, routines }
}

export function generatePlan(input: PlanInput, now?: number): { plan: Plan; routines: Routine[] } {
  return generatePlanFromTemplate(pickTemplate(input), input, now ?? Date.now())
}

/* ------------------------------------------------------------------ */
/* Rotation                                                            */
/* ------------------------------------------------------------------ */

/** Next routine in the rotation after the most recent completed session of this plan. */
export function nextRoutineId(plan: Plan | null, sessions: WorkoutSession[], routines: Routine[]): string | null {
  if (!plan || plan.routineIds.length === 0) return null
  const order = plan.routineIds
  const alive = new Set(routines.filter((r) => !r.deleted).map((r) => r.id))
  if (!order.some((id) => alive.has(id))) return null

  const inPlan = new Set(order)
  let last: WorkoutSession | null = null
  for (const s of sessions) {
    if (s.deleted || !s.endedAt || !s.routineId || !inPlan.has(s.routineId)) continue
    if (!last || s.endedAt > (last.endedAt ?? 0) || (s.endedAt === last.endedAt && s.startedAt > last.startedAt)) last = s
  }

  const start = last?.routineId ? order.indexOf(last.routineId) + 1 : 0
  for (let k = 0; k < order.length; k++) {
    const id = order[(start + k) % order.length]
    if (alive.has(id)) return id
  }
  return null
}
