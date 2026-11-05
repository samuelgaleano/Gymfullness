import { describe, expect, it, vi } from 'vitest'
import type { EquipmentProfile, Goal, Level, Plan, Routine, WorkoutSession } from './types'
import {
  DAYS_OPTIONS,
  EQUIPMENT_OPTIONS,
  GOAL_OPTIONS,
  LEVEL_OPTIONS,
  buildRoutinesFromTemplate,
  clampDays,
  daysOptionsFor,
  describePlan,
  describeScheme,
  generatePlan,
  generatePlanFromTemplate,
  nextRoutineId,
  pickTemplate,
  prescribe,
  relativeDifficulty,
  type PlanInput,
} from './planner'
import { PATTERN_OF, getBuiltinExercise } from '../data/exercises'
import { TEMPLATES, TEMPLATE_EQUIPMENT, getTemplate } from '../data/templates'

const NOW = 1_700_000_000_000
const GOALS: Goal[] = ['muscle', 'strength', 'fat_loss', 'health']
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']
const PROFILES: EquipmentProfile[] = ['gym', 'home_dumbbells', 'bodyweight']

const input = (patch: Partial<PlanInput> = {}): PlanInput => ({
  goal: 'muscle',
  level: 'intermediate',
  daysPerWeek: 3,
  equipment: 'gym',
  ...patch,
})

const ex = (id: string) => {
  const e = getBuiltinExercise(id)
  if (!e) throw new Error(`missing ${id}`)
  return e
}

describe('pickTemplate', () => {
  it('maps days per week to a split', () => {
    expect(pickTemplate(input({ daysPerWeek: 2 })).split).toBe('full_body')
    expect(pickTemplate(input({ daysPerWeek: 3 })).split).toBe('full_body')
    expect(pickTemplate(input({ daysPerWeek: 3, level: 'advanced' })).split).toBe('ppl')
    expect(pickTemplate(input({ daysPerWeek: 4 })).split).toBe('upper_lower')
    expect(pickTemplate(input({ daysPerWeek: 5 })).split).toBe('upper_lower')
    expect(pickTemplate(input({ daysPerWeek: 5, level: 'advanced' })).split).toBe('ppl')
    expect(pickTemplate(input({ daysPerWeek: 6 })).split).toBe('ppl')
  })

  it('respects the equipment profile and never auto-picks the quick template', () => {
    for (const equipment of PROFILES) {
      for (let d = 2; d <= 6; d++) {
        for (const level of LEVELS) {
          const t = pickTemplate(input({ equipment, daysPerWeek: d, level }))
          expect(t.equipment).toBe(equipment)
          expect(t.split).not.toBe('quick')
        }
      }
    }
  })

  it('clamps out-of-range days', () => {
    expect(clampDays(1)).toBe(2)
    expect(clampDays(9)).toBe(6)
    expect(clampDays(Number.NaN)).toBe(3)
    expect(clampDays(4.4)).toBe(4)
    expect(pickTemplate(input({ daysPerWeek: 0 })).split).toBe('full_body')
  })
})

describe('generatePlan', () => {
  it('returns fresh routines in rotation order with timestamps from now', () => {
    const { plan, routines } = generatePlan(input({ daysPerWeek: 4 }), NOW)
    expect(routines).toHaveLength(4)
    expect(plan.routineIds).toEqual(routines.map((r) => r.id))
    expect(plan).toMatchObject({ daysPerWeek: 4, goal: 'muscle', level: 'intermediate', equipment: 'gym', updatedAt: NOW })
    for (const r of routines) {
      expect(r.createdAt).toBe(NOW)
      expect(r.updatedAt).toBe(NOW)
      expect(r.templateId).toBe('gym-upper-lower')
      expect(r.deleted).toBeFalsy()
      expect(r.name).toMatch(/^Día [A-D] · /)
      expect(r.focus).toBeTruthy()
    }
    const itemIds = routines.flatMap((r) => r.items.map((i) => i.id))
    expect(new Set([...plan.routineIds, ...itemIds]).size).toBe(plan.routineIds.length + itemIds.length)
  })

  it('creates new ids on every call', () => {
    const a = generatePlan(input(), NOW)
    const b = generatePlan(input(), NOW)
    expect(a.plan.routineIds.some((id) => b.plan.routineIds.includes(id))).toBe(false)
  })

  it('produces valid items for every combination', () => {
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        for (const equipment of PROFILES) {
          for (let d = 2; d <= 6; d++) {
            const { routines } = generatePlan({ goal, level, equipment, daysPerWeek: d }, NOW)
            const allowed = TEMPLATE_EQUIPMENT[equipment]
            for (const r of routines) {
              expect(r.items.length).toBeGreaterThanOrEqual(4)
              expect(new Set(r.items.map((i) => i.exerciseId)).size).toBe(r.items.length)
              for (const it of r.items) {
                const e = ex(it.exerciseId)
                expect(e.equipment.every((q) => allowed.includes(q))).toBe(true)
                expect(it.sets).toBeGreaterThanOrEqual(1)
                expect(it.sets).toBeLessThanOrEqual(5)
                expect(it.restSec).toBeGreaterThanOrEqual(30)
                expect(it.restSec).toBeLessThanOrEqual(180)
                if (e.kind === 'time') {
                  expect(it.repsMin).toBe(0)
                  expect(it.repsMax).toBe(0)
                  expect(it.targetSeconds).toBeGreaterThan(0)
                } else {
                  expect(it.repsMin).toBeGreaterThan(0)
                  expect(it.repsMax).toBeGreaterThanOrEqual(it.repsMin)
                  expect(it.targetSeconds).toBeUndefined()
                }
              }
            }
          }
        }
      }
    }
  })

  it('applies the muscle scheme: 3–4 × 8–12, rest 90 / compounds 120', () => {
    const { routines } = generatePlan(input({ goal: 'muscle', level: 'intermediate' }), NOW)
    const [dayA] = routines
    const squat = dayA.items.find((i) => i.exerciseId === 'back-squat')!
    expect(squat).toMatchObject({ sets: 4, repsMin: 8, repsMax: 12, restSec: 120 })
    const lateral = dayA.items.find((i) => i.exerciseId === 'lateral-raise')!
    expect(lateral).toMatchObject({ sets: 3, repsMin: 8, repsMax: 12, restSec: 90 })
    for (const it of routines.flatMap((r) => r.items)) {
      const e = ex(it.exerciseId)
      if (e.kind !== 'weight_reps' || e.primary === 'core') continue
      expect([3, 4]).toContain(it.sets)
      expect([it.repsMin, it.repsMax]).toEqual([8, 12])
      expect(it.restSec).toBe(e.isCompound ? 120 : 90)
    }
  })

  it('applies the strength scheme: main lifts 4–5 × 4–6 with long rest, accessories 3 × 8–10', () => {
    // full body: lower + push + pull are the main lifts; the 4th compound is an accessory
    const inter = generatePlan(input({ goal: 'strength', level: 'intermediate' }), NOW).routines[0]
    expect(inter.items[0]).toMatchObject({ exerciseId: 'back-squat', sets: 4, repsMin: 4, repsMax: 6, restSec: 180 })
    expect(inter.items[1]).toMatchObject({ exerciseId: 'bench-press', sets: 4, repsMin: 4, repsMax: 6, restSec: 180 })
    expect(inter.items[2]).toMatchObject({ exerciseId: 'seated-cable-row', sets: 4, repsMin: 4, repsMax: 6, restSec: 150 })
    expect(inter.items[3]).toMatchObject({ exerciseId: 'romanian-deadlift', sets: 3, repsMin: 8, repsMax: 10, restSec: 90 })
    // split days: only the first two compounds are main lifts
    const torso = generatePlan(input({ goal: 'strength', daysPerWeek: 4 }), NOW).routines[0]
    expect(torso.items.slice(0, 3).map((i) => [i.exerciseId, i.sets, i.repsMin, i.repsMax, i.restSec])).toEqual([
      ['bench-press', 4, 4, 6, 180],
      ['barbell-row', 4, 4, 6, 180],
      ['incline-dumbbell-press', 3, 8, 10, 90],
    ])
    const adv = generatePlan(input({ goal: 'strength', level: 'advanced', daysPerWeek: 2 }), NOW).routines[0]
    expect(adv.items[0].sets).toBe(5)
    // dumbbell main lift rests a bit less than barbell
    const dayB = generatePlan(input({ goal: 'strength' }), NOW).routines[1]
    expect(dayB.items[1]).toMatchObject({ exerciseId: 'incline-dumbbell-press', repsMin: 4, repsMax: 6, restSec: 150 })
  })

  it('applies fat loss (3 × 12–15, 45–60 s) and health (2–3 × 10–12, 60–75 s) schemes', () => {
    for (const it of generatePlan(input({ goal: 'fat_loss' }), NOW).routines.flatMap((r) => r.items)) {
      const e = ex(it.exerciseId)
      expect(it.restSec).toBeLessThanOrEqual(60)
      expect(it.restSec).toBeGreaterThanOrEqual(45)
      if (e.kind === 'weight_reps') expect([it.sets, it.repsMin, it.repsMax]).toEqual([3, 12, 15])
    }
    for (const it of generatePlan(input({ goal: 'health' }), NOW).routines.flatMap((r) => r.items)) {
      const e = ex(it.exerciseId)
      expect([2, 3]).toContain(it.sets)
      expect(it.restSec).toBeLessThanOrEqual(75)
      if (e.kind === 'weight_reps') expect([it.repsMin, it.repsMax]).toEqual([10, 12])
    }
  })

  it('gives beginners one fewer set on accessories (never below 2)', () => {
    const beg = generatePlan(input({ level: 'beginner' }), NOW).routines[0]
    const int = generatePlan(input({ level: 'intermediate' }), NOW).routines[0]
    const acc = (r: Routine) => r.items.find((i) => i.exerciseId === 'lateral-raise')!.sets
    expect(acc(beg)).toBe(acc(int) - 1)
    for (const goal of GOALS) {
      for (const it of generatePlan(input({ goal, level: 'beginner' }), NOW).routines.flatMap((r) => r.items)) {
        expect(it.sets).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('sets targetSeconds for time exercises (plank 30–45 s)', () => {
    for (const level of LEVELS) {
      const plank = generatePlan(input({ level }), NOW)
        .routines.flatMap((r) => r.items)
        .find((i) => i.exerciseId === 'plank')!
      expect(plank.targetSeconds).toBeGreaterThanOrEqual(30)
      expect(plank.targetSeconds).toBeLessThanOrEqual(45)
      expect([plank.repsMin, plank.repsMax]).toEqual([0, 0])
    }
    expect(prescribe(ex('plank'), 'muscle', 'beginner').targetSeconds).toBe(30)
    expect(prescribe(ex('plank'), 'muscle', 'advanced').targetSeconds).toBe(45)
  })

  it('prescribes steady cardio as one long block (600–900 s)', () => {
    const bike = ex('stationary-bike')
    for (const goal of GOALS) {
      for (const level of LEVELS) {
        const t = prescribe(bike, goal, level)
        expect(t.sets).toBe(1)
        expect(t.targetSeconds).toBeGreaterThanOrEqual(600)
        expect(t.targetSeconds).toBeLessThanOrEqual(900)
        expect([t.repsMin, t.repsMax]).toEqual([0, 0])
      }
    }
    expect(prescribe(bike, 'fat_loss', 'beginner').targetSeconds).toBe(900)
    expect(prescribe(bike, 'muscle', 'beginner').targetSeconds).toBe(600)
  })

  it('scales bodyweight rep ranges with difficulty relative to the user', () => {
    expect(relativeDifficulty(ex('push-up'), 'beginner')).toBe('hard')
    expect(relativeDifficulty(ex('push-up'), 'advanced')).toBe('easy')
    expect(relativeDifficulty(ex('bodyweight-squat'), 'beginner')).toBe('medium')
    const pushBeg = prescribe(ex('push-up'), 'muscle', 'beginner', true)
    const pushAdv = prescribe(ex('push-up'), 'muscle', 'advanced', true)
    expect(pushBeg.repsMax).toBeLessThan(pushAdv.repsMax)
    const pull = prescribe(ex('pull-up'), 'strength', 'intermediate', true)
    expect([pull.repsMin, pull.repsMax]).toEqual([4, 8])
  })

  it('swaps exercises above the user level for a doable alternative', () => {
    const beg = generatePlan(input({ level: 'beginner', daysPerWeek: 2 }), NOW).routines[1]
    const ids = beg.items.map((i) => i.exerciseId)
    expect(ids).not.toContain('deadlift')
    expect(ids[0]).toBe('romanian-deadlift')
    // the gym upper/lower template has beginner alternatives for every exercise
    const upperLower = generatePlan(input({ level: 'beginner', daysPerWeek: 4 }), NOW).routines.flatMap((r) => r.items)
    for (const it of upperLower) expect(ex(it.exerciseId).level, it.exerciseId).toBe('beginner')
    // pull-ups become the assisted machine in a gym (bands are not assumed)
    expect(upperLower.map((i) => i.exerciseId)).toContain('assisted-pull-up-machine')
    const adv = generatePlan(input({ level: 'advanced', daysPerWeek: 2 }), NOW).routines[1]
    expect(adv.items[0].exerciseId).toBe('deadlift')
  })

  it('never leaves an exercise above the user level in any template', () => {
    const rank: Record<Level, number> = { beginner: 0, intermediate: 1, advanced: 2 }
    for (const t of TEMPLATES) {
      for (const level of LEVELS) {
        for (const r of buildRoutinesFromTemplate(t, { goal: 'muscle', level }, NOW)) {
          for (const it of r.items) expect(rank[ex(it.exerciseId).level], `${t.id} ${level}: ${it.exerciseId}`).toBeLessThanOrEqual(rank[level])
          // swaps keep the day valid: no repeats, compounds still before isolation, core last
          const exs = r.items.map((i) => ex(i.exerciseId))
          expect(new Set(exs.map((e) => e.id)).size).toBe(exs.length)
          expect(exs[exs.length - 1].primary, `${t.id} ${level} ${r.name}`).toBe('core')
          const work = exs.filter((e) => e.primary !== 'core')
          const firstIso = work.findIndex((e) => !e.isCompound)
          if (firstIso >= 0) expect(work.slice(firstIso).some((e) => e.isCompound), `${t.id} ${level} ${r.name}`).toBe(false)
        }
      }
    }
  })

  it('gives the pull of a full-body day as many sets as the push', () => {
    for (const equipment of PROFILES) {
      for (const level of LEVELS) {
        for (const goal of GOALS) {
          const { routines } = generatePlan({ goal, level, equipment, daysPerWeek: 2 }, NOW)
          for (const r of routines) {
            const setsOf = (pattern: string) => r.items.find((i) => PATTERN_OF[i.exerciseId] === pattern)?.sets
            const push = setsOf('horizontal_push') ?? setsOf('vertical_push')
            const pull = setsOf('horizontal_pull') ?? setsOf('vertical_pull')
            expect(pull, `${equipment} ${level} ${goal} ${r.name}`).toBe(push)
          }
        }
      }
    }
  })

  it('does not mutate the templates and defaults `now` to the clock', () => {
    const before = JSON.stringify(TEMPLATES)
    vi.useFakeTimers()
    vi.setSystemTime(NOW + 42)
    try {
      const { plan, routines } = generatePlan(input({ level: 'beginner', equipment: 'bodyweight', daysPerWeek: 4 }))
      expect(plan.updatedAt).toBe(NOW + 42)
      expect(routines.every((r) => r.createdAt === NOW + 42 && r.updatedAt === NOW + 42)).toBe(true)
    } finally {
      vi.useRealTimers()
    }
    expect(JSON.stringify(TEMPLATES)).toBe(before)
  })

  it('prescribes custom exercises (no movement pattern) by kind and muscle', () => {
    const base = ex('lateral-raise')
    const custom = { ...base, id: 'my-raise', custom: true }
    expect(prescribe(custom, 'muscle', 'intermediate')).toEqual(prescribe(base, 'muscle', 'intermediate'))
    const hold = { ...ex('plank'), id: 'my-hold', custom: true }
    expect(prescribe(hold, 'health', 'advanced')).toMatchObject({ repsMin: 0, repsMax: 0, targetSeconds: 45 })
    // isolation never becomes a main lift even when asked
    expect(prescribe(base, 'strength', 'advanced', true)).toMatchObject({ sets: 3, repsMin: 8, repsMax: 10, restSec: 90 })
  })

  it('caps sets and rest on the quick template', () => {
    const quick = getTemplate('gym-quick')!
    const { plan, routines } = generatePlanFromTemplate(quick, input({ goal: 'strength', level: 'advanced' }), NOW)
    expect(plan.routineIds).toHaveLength(2)
    for (const it of routines.flatMap((r) => r.items)) {
      expect(it.sets).toBeLessThanOrEqual(3)
      expect(it.restSec).toBeLessThanOrEqual(60)
    }
    expect(routines.every((r) => r.templateId === 'gym-quick')).toBe(true)
  })

  it('builds routines straight from a template', () => {
    const t = getTemplate('bw-full-body')!
    const routines = buildRoutinesFromTemplate(t, { goal: 'health', level: 'intermediate' }, NOW)
    expect(routines.map((r) => r.name)).toEqual(t.days.map((d) => d.name))
    expect(routines[0].items.map((i) => i.exerciseId)).toEqual(t.days[0].exerciseIds)
  })
})

describe('nextRoutineId', () => {
  const routine = (id: string, deleted = false): Routine => ({ id, name: id, items: [], createdAt: 0, updatedAt: 0, deleted })
  const plan = (ids: string[]): Plan => ({ routineIds: ids, daysPerWeek: 3, goal: 'muscle', level: 'beginner', equipment: 'gym', updatedAt: 0 })
  const session = (routineId: string | null, endedAt: number | null, patch: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id: `s_${routineId}_${endedAt}`,
    routineId,
    name: 'x',
    unit: 'kg',
    startedAt: (endedAt ?? 0) - 3600_000,
    endedAt,
    exercises: [],
    cursor: { ex: 0, set: 0 },
    updatedAt: 0,
    ...patch,
  })
  const R = [routine('a'), routine('b'), routine('c')]

  it('returns null without a plan or with an empty plan', () => {
    expect(nextRoutineId(null, [], R)).toBeNull()
    expect(nextRoutineId(plan([]), [], R)).toBeNull()
    expect(nextRoutineId(plan(['a']), [], [routine('a', true)])).toBeNull()
    expect(nextRoutineId(plan(['x']), [], R)).toBeNull()
  })

  it('starts with the first routine when nothing was done', () => {
    expect(nextRoutineId(plan(['a', 'b', 'c']), [], R)).toBe('a')
    expect(nextRoutineId(plan(['a', 'b', 'c']), [session('zzz', NOW), session(null, NOW)], R)).toBe('a')
  })

  it('follows the rotation after the most recent completed session', () => {
    const p = plan(['a', 'b', 'c'])
    expect(nextRoutineId(p, [session('a', NOW)], R)).toBe('b')
    expect(nextRoutineId(p, [session('a', NOW), session('b', NOW + 1)], R)).toBe('c')
    expect(nextRoutineId(p, [session('c', NOW + 5), session('a', NOW)], R)).toBe('a') // order-independent, wraps
  })

  it('ignores deleted and unfinished sessions', () => {
    const p = plan(['a', 'b', 'c'])
    const sessions = [session('a', NOW), session('b', NOW + 1, { deleted: true }), session('c', null, { startedAt: NOW + 2 })]
    expect(nextRoutineId(p, sessions, R)).toBe('b')
  })

  it('skips deleted routines but keeps the rotation position', () => {
    const p = plan(['a', 'b', 'c'])
    const routines = [routine('a'), routine('b', true), routine('c')]
    expect(nextRoutineId(p, [session('a', NOW)], routines)).toBe('c')
    expect(nextRoutineId(p, [session('b', NOW)], routines)).toBe('c')
    expect(nextRoutineId(p, [session('c', NOW)], [routine('a', true), routine('b'), routine('c')])).toBe('b')
    expect(nextRoutineId(p, [], [routine('a', true), routine('b'), routine('c')])).toBe('b')
  })

  it('breaks endedAt ties by start time and ignores array order', () => {
    const p = plan(['a', 'b', 'c'])
    const sessions = [session('b', NOW, { startedAt: NOW - 10 }), session('a', NOW, { startedAt: NOW - 5 })]
    expect(nextRoutineId(p, sessions, R)).toBe('b') // 'a' started later → it is the latest
    expect(nextRoutineId(p, [...sessions].reverse(), R)).toBe('b')
  })

  it('uses only the plan rotation, even when routines are missing from the list', () => {
    const p = plan(['a', 'b', 'c'])
    // 'b' is in the plan but not in the routines list (e.g. filtered out as deleted) → skipped
    expect(nextRoutineId(p, [session('a', NOW)], [routine('a'), routine('c')])).toBe('c')
    // sessions of routines from an older plan are ignored even when newer
    expect(nextRoutineId(p, [session('b', NOW), session('old', NOW + 99)], R)).toBe('c')
  })

  it('works with a generated plan', () => {
    const { plan: p, routines } = generatePlan(input({ daysPerWeek: 6 }), NOW)
    const [a, b] = p.routineIds
    expect(nextRoutineId(p, [], routines)).toBe(a)
    expect(nextRoutineId(p, [session(a, NOW)], routines)).toBe(b)
  })
})

describe('onboarding copy', () => {
  it('exposes Spanish option lists for every enum value', () => {
    expect(GOAL_OPTIONS.map((o) => o.value).sort()).toEqual([...GOALS].sort())
    expect(LEVEL_OPTIONS.map((o) => o.value)).toEqual(LEVELS)
    expect(EQUIPMENT_OPTIONS.map((o) => o.value)).toEqual(PROFILES)
    expect(DAYS_OPTIONS.map((o) => o.value)).toEqual([2, 3, 4, 5, 6])
    for (const o of [...GOAL_OPTIONS, ...LEVEL_OPTIONS, ...EQUIPMENT_OPTIONS, ...DAYS_OPTIONS]) {
      expect(o.label.trim()).not.toBe('')
      expect(o.description.trim()).not.toBe('')
    }
  })

  it('uses tuteo in option copy', () => {
    for (const o of [...GOAL_OPTIONS, ...LEVEL_OPTIONS, ...EQUIPMENT_OPTIONS]) {
      expect(o.description, o.label).not.toMatch(/^(Estoy|Entreno|Llevo|Tengo|Quiero)\b/)
    }
  })

  it('describes the split each day count gets, per level', () => {
    expect(DAYS_OPTIONS.map((o) => o.label)).toEqual(['2 días', '3 días', '4 días', '5 días', '6 días'])
    expect(daysOptionsFor('beginner').map((o) => o.description)).toEqual([
      'Full body',
      'Full body',
      'Torso / Pierna',
      'Torso / Pierna en rotación',
      'Empuje / Tirón / Pierna',
    ])
    const adv = daysOptionsFor('advanced')
    expect(adv[1].description).toBe('Empuje / Tirón / Pierna')
    expect(adv[3].description).toBe('Empuje / Tirón / Pierna')
    // the copy always matches what the planner picks
    for (const level of LEVELS) {
      for (const o of daysOptionsFor(level)) {
        expect(o.description).toContain(pickTemplate(input({ level, daysPerWeek: o.value })).name.replace(' A/B', ''))
      }
    }
  })

  it('describes schemes and plans', () => {
    for (const g of GOALS) expect(describeScheme(g)).toMatch(/series|×/)
    expect(describeScheme('muscle')).toContain('8–12')
    expect(describePlan(input({ daysPerWeek: 4 }))).toBe('Torso / Pierna · 4 días por semana')
  })
})
