import { describe, expect, it } from 'vitest'
import type { Equipment, EquipmentProfile, ExerciseKind, Level, MuscleGroup } from '../lib/types'
import { EQUIPMENT_LABEL, EXERCISES, EXERCISE_BY_ID, getBuiltinExercise, MUSCLE_LABEL, PATTERN_OF } from './exercises'
import { TEMPLATES, TEMPLATE_EQUIPMENT, getTemplate, templatesFor, type TemplateSplit } from './templates'

const MUSCLES = Object.keys(MUSCLE_LABEL) as MuscleGroup[]
const EQUIPMENT = Object.keys(EQUIPMENT_LABEL) as Equipment[]
const KINDS: ExerciseKind[] = ['weight_reps', 'reps', 'time']
const LEVELS: Level[] = ['beginner', 'intermediate', 'advanced']
const PROFILES: EquipmentProfile[] = ['gym', 'home_dumbbells', 'bodyweight']
const ALLOWED_INCREMENTS = [1, 1.25, 2, 2.5, 4, 5]

describe('exercise library integrity', () => {
  it('has at least 80 exercises with unique kebab-case ids', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(80)
    const ids = EXERCISES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })

  it('has unique Spanish names', () => {
    const names = EXERCISES.map((e) => e.name.toLowerCase())
    expect(new Set(names).size).toBe(names.length)
  })

  it('uses only valid enums', () => {
    for (const e of EXERCISES) {
      expect(MUSCLES, e.id).toContain(e.primary)
      for (const m of e.secondary) expect(MUSCLES, e.id).toContain(m)
      expect(e.secondary, `${e.id} lists its primary as secondary`).not.toContain(e.primary)
      expect(e.equipment.length, e.id).toBeGreaterThan(0)
      for (const eq of e.equipment) expect(EQUIPMENT, e.id).toContain(eq)
      expect(new Set(e.equipment).size, e.id).toBe(e.equipment.length)
      expect(KINDS, e.id).toContain(e.kind)
      expect(LEVELS, e.id).toContain(e.level)
    }
  })

  it('gives every exercise a movement pattern', () => {
    for (const e of EXERCISES) expect(PATTERN_OF[e.id], e.id).toBeTruthy()
    expect(Object.keys(PATTERN_OF).sort()).toEqual(EXERCISES.map((e) => e.id).sort())
  })

  it('has complete technique content', () => {
    for (const e of EXERCISES) {
      expect(e.name.trim(), e.id).not.toBe('')
      expect(e.aliases.length, `${e.id} aliases`).toBeGreaterThanOrEqual(2)
      expect(e.setup.length, `${e.id} setup`).toBeGreaterThanOrEqual(1)
      expect(e.setup.length, `${e.id} setup`).toBeLessThanOrEqual(3)
      expect(e.cues.length, `${e.id} cues`).toBeGreaterThanOrEqual(3)
      expect(e.cues.length, `${e.id} cues`).toBeLessThanOrEqual(5)
      expect(e.mistakes.length, `${e.id} mistakes`).toBeGreaterThanOrEqual(2)
      expect(e.mistakes.length, `${e.id} mistakes`).toBeLessThanOrEqual(4)
      expect(e.breathing?.trim(), `${e.id} breathing`).toBeTruthy()
      for (const line of [...e.setup, ...e.cues, ...e.mistakes]) {
        expect(line.trim(), e.id).not.toBe('')
        expect(line.length, `${e.id}: "${line}"`).toBeLessThanOrEqual(110)
        expect(line.endsWith('.'), `${e.id}: bullets have no trailing period`).toBe(false)
      }
    }
  })

  it('derives the technique-video query from the name', () => {
    for (const e of EXERCISES) {
      expect(e.videoQuery, e.id).toBe(`como hacer ${e.name.toLowerCase()} tecnica correcta`)
    }
  })

  it('has sane increments for each kind', () => {
    for (const e of EXERCISES) {
      if (e.kind === 'weight_reps') {
        expect(ALLOWED_INCREMENTS, `${e.id} increment`).toContain(e.increment)
        if (e.equipment.includes('barbell')) expect(e.increment, e.id).toBe(2.5)
        if (e.equipment.length === 1 && e.equipment[0] === 'dumbbell') expect(e.increment, e.id).toBe(2)
        if (e.equipment.includes('machine') || e.equipment.includes('cable')) expect([2.5, 5], e.id).toContain(e.increment)
      } else {
        expect(e.increment, `${e.id} (${e.kind}) increment`).toBe(0)
      }
    }
  })

  it('has rest defaults that match the exercise type', () => {
    for (const e of EXERCISES) {
      const pattern = PATTERN_OF[e.id]
      const [lo, hi] =
        e.primary === 'core'
          ? [45, 60]
          : pattern === 'cardio' || pattern === 'conditioning' || e.primary === 'full_body'
            ? [30, 90]
            : e.isCompound
              ? [120, 180]
              : [60, 90]
      expect(e.defaultRestSec, `${e.id} rest`).toBeGreaterThanOrEqual(lo)
      expect(e.defaultRestSec, `${e.id} rest`).toBeLessThanOrEqual(hi)
    }
  })

  it('only bodyweight-style exercises use the reps kind, and cardio uses time', () => {
    for (const e of EXERCISES) {
      if (e.kind === 'reps') {
        const loadFree = e.equipment.every((eq) => ['bodyweight', 'pullup_bar', 'band', 'machine'].includes(eq))
        expect(loadFree, `${e.id} is 'reps' but needs external load`).toBe(true)
      }
      if (PATTERN_OF[e.id] === 'cardio') expect(e.kind, e.id).toBe('time')
    }
  })

  it('covers every muscle group', () => {
    for (const m of MUSCLES) expect(EXERCISES.some((e) => e.primary === m), m).toBe(true)
  })

  it('covers the major muscles for every equipment profile', () => {
    const major: MuscleGroup[] = ['chest', 'back', 'shoulders', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core']
    for (const p of PROFILES) {
      const allowed = TEMPLATE_EQUIPMENT[p]
      const doable = EXERCISES.filter((e) => e.equipment.every((eq) => allowed.includes(eq)))
      for (const m of major) expect(doable.some((e) => e.primary === m), `${p}: ${m}`).toBe(true)
    }
  })

  it('includes the LatAm gym staples', () => {
    const staples = [
      'bench-press', 'dumbbell-bench-press', 'incline-bench-press', 'decline-bench-press', 'overhead-press',
      'back-squat', 'goblet-squat', 'bulgarian-split-squat', 'hack-squat', 'smith-squat', 'deadlift',
      'romanian-deadlift', 'hip-thrust', 'leg-press', 'leg-extension', 'lying-leg-curl', 'dumbbell-lunge',
      'standing-calf-raise', 'pull-up', 'lat-pulldown', 'barbell-row', 'dumbbell-row', 'seated-cable-row',
      'machine-row', 'dumbbell-pullover', 'face-pull', 'lateral-raise', 'front-raise', 'rear-delt-fly',
      'barbell-curl', 'dumbbell-curl', 'hammer-curl', 'preacher-curl', 'cable-curl', 'triceps-pushdown',
      'skull-crusher', 'dips', 'triceps-kickback', 'push-up', 'plank', 'crunch', 'lying-leg-raise',
      'ab-wheel-rollout', 'pallof-press', 'mountain-climber', 'burpee', 'kettlebell-swing', 'farmer-walk',
      'stationary-bike', 'treadmill', 'elliptical', 'rowing-machine',
    ]
    for (const id of staples) expect(getBuiltinExercise(id), id).toBeDefined()
    expect(getBuiltinExercise('bench-press')?.name).toBe('Press de banca')
    expect(EXERCISE_BY_ID.size).toBe(EXERCISES.length)
    expect(getBuiltinExercise('does-not-exist')).toBeUndefined()
  })

  it('keeps aliases searchable (English name included, no duplicates within an exercise)', () => {
    for (const e of EXERCISES) {
      const lower = e.aliases.map((a) => a.toLowerCase())
      expect(new Set(lower).size, e.id).toBe(lower.length)
      expect(/[a-z]/.test(lower.join(' ')), e.id).toBe(true)
    }
  })
})

describe('routine templates', () => {
  const SPLITS: TemplateSplit[] = ['full_body', 'upper_lower', 'ppl', 'quick']

  it('has unique ids and every split for every profile', () => {
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length)
    for (const p of PROFILES) {
      for (const s of SPLITS) expect(TEMPLATES.some((t) => t.equipment === p && t.split === s), `${p}/${s}`).toBe(true)
    }
  })

  it('references only existing exercises', () => {
    for (const t of TEMPLATES) {
      for (const d of t.days) for (const id of d.exerciseIds) expect(getBuiltinExercise(id), `${t.id}: ${id}`).toBeDefined()
    }
  })

  it('has 4–8 items per day, no repeats within a day, core included', () => {
    for (const t of TEMPLATES) {
      for (const d of t.days) {
        expect(d.exerciseIds.length, `${t.id} / ${d.name}`).toBeGreaterThanOrEqual(4)
        expect(d.exerciseIds.length, `${t.id} / ${d.name}`).toBeLessThanOrEqual(8)
        expect(new Set(d.exerciseIds).size, `${t.id} / ${d.name} repeats`).toBe(d.exerciseIds.length)
        const last = getBuiltinExercise(d.exerciseIds[d.exerciseIds.length - 1])
        expect(last?.primary, `${t.id} / ${d.name} ends with core`).toBe('core')
        // 5–7 exercises + core
        const work = d.exerciseIds.filter((id) => getBuiltinExercise(id)?.primary !== 'core')
        expect(work.length, `${t.id} / ${d.name} work exercises`).toBeGreaterThanOrEqual(5)
        expect(work.length, `${t.id} / ${d.name} work exercises`).toBeLessThanOrEqual(7)
      }
    }
  })

  it('trains every big muscle across each template week', () => {
    for (const t of TEMPLATES) {
      const exs = t.days.flatMap((d) => d.exerciseIds.map((id) => getBuiltinExercise(id)!))
      const primary = new Set(exs.map((e) => e.primary))
      const any = new Set(exs.flatMap((e) => [e.primary, ...e.secondary]))
      for (const m of ['chest', 'back', 'shoulders', 'quads', 'core'] as MuscleGroup[]) {
        expect(primary.has(m), `${t.id} misses ${m}`).toBe(true)
      }
      // glutes/hamstrings are often trained by squats, lunges and hinges
      for (const m of ['hamstrings', 'glutes'] as MuscleGroup[]) expect(any.has(m), `${t.id} misses ${m}`).toBe(true)
    }
  })

  it('names focus muscles that the day actually trains', () => {
    const LABEL_TO_MUSCLE: Record<string, MuscleGroup[]> = {
      Piernas: ['quads', 'hamstrings', 'glutes', 'calves'],
      Brazos: ['biceps', 'triceps'],
      'Hombro posterior': ['shoulders'],
    }
    for (const [m, label] of Object.entries(MUSCLE_LABEL) as [MuscleGroup, string][]) LABEL_TO_MUSCLE[label] = [m]
    for (const t of TEMPLATES) {
      for (const d of t.days) {
        const exs = d.exerciseIds.map((id) => getBuiltinExercise(id)!)
        for (const label of d.focus.split(' · ')) {
          const muscles = LABEL_TO_MUSCLE[label]
          expect(muscles, `${t.id} / ${d.name}: unknown focus "${label}"`).toBeDefined()
          const hit = exs.some((e) => muscles.includes(e.primary) || muscles.some((m) => e.secondary.includes(m)))
          expect(hit, `${t.id} / ${d.name}: focus "${label}"`).toBe(true)
        }
      }
    }
  })

  it('orders compounds before isolation (core last)', () => {
    for (const t of TEMPLATES) {
      for (const d of t.days) {
        const work = d.exerciseIds.map((id) => getBuiltinExercise(id)!).filter((e) => e.primary !== 'core')
        const firstIso = work.findIndex((e) => !e.isCompound)
        if (firstIso === -1) continue
        const lateCompound = work.slice(firstIso).find((e) => e.isCompound)
        expect(lateCompound?.id, `${t.id} / ${d.name}`).toBeUndefined()
      }
    }
  })

  it('only uses equipment available in its profile', () => {
    for (const t of TEMPLATES) {
      const allowed = TEMPLATE_EQUIPMENT[t.equipment]
      for (const d of t.days) {
        for (const id of d.exerciseIds) {
          const ex = getBuiltinExercise(id)!
          expect(ex.equipment.every((eq) => allowed.includes(eq)), `${t.id}: ${id} needs ${ex.equipment.join('+')}`).toBe(true)
        }
      }
    }
  })

  it('has Spanish copy and sensible day counts', () => {
    for (const t of TEMPLATES) {
      expect(t.description.length, t.id).toBeGreaterThan(20)
      expect(t.days.length, t.id).toBeGreaterThanOrEqual(2)
      expect(t.daysPerWeek.every((n) => n >= 2 && n <= 6), t.id).toBe(true)
      for (const d of t.days) {
        expect(d.name, t.id).toMatch(/^(Día|Rápido) [A-D] · /)
        expect(d.focus, t.id).toMatch(/ · /)
      }
    }
    expect(TEMPLATES.find((t) => t.split === 'quick')?.name).toBe('Rápido 30 min')
  })

  it('looks templates up by id and profile', () => {
    expect(getTemplate('gym-ppl')?.split).toBe('ppl')
    expect(getTemplate('nope')).toBeUndefined()
    expect(templatesFor('bodyweight').every((t) => t.equipment === 'bodyweight')).toBe(true)
    expect(templatesFor().length).toBe(TEMPLATES.length)
  })
})
