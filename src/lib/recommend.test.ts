import { describe, expect, it } from 'vitest'
import type { EquipmentProfile, Exercise } from './types'
import { EXERCISES, PATTERN_OF, getBuiltinExercise } from '../data/exercises'
import { PROFILE_EQUIPMENT, alternatives, isAvailable, normalizeText, searchExercises, suggestAddOns } from './recommend'

const ids = (list: Exercise[]) => list.map((e) => e.id)
const ex = (id: string) => getBuiltinExercise(id)!
const PROFILES: EquipmentProfile[] = ['gym', 'home_dumbbells', 'bodyweight']

describe('isAvailable', () => {
  it('filters by the equipment of each profile', () => {
    expect(isAvailable(ex('bench-press'), 'gym')).toBe(true)
    expect(isAvailable(ex('bench-press'), 'home_dumbbells')).toBe(false)
    expect(isAvailable(ex('dumbbell-bench-press'), 'home_dumbbells')).toBe(true)
    expect(isAvailable(ex('kettlebell-swing'), 'home_dumbbells')).toBe(true)
    expect(isAvailable(ex('dumbbell-row'), 'bodyweight')).toBe(false)
    expect(isAvailable(ex('pull-up'), 'bodyweight')).toBe(true)
    expect(isAvailable(ex('band-row'), 'bodyweight')).toBe(true)
    expect(isAvailable(ex('lat-pulldown'), undefined)).toBe(true)
    expect(PROFILE_EQUIPMENT.gym).toBeNull()
  })
})

describe('alternatives', () => {
  it('ranks same pattern + same primary first, then same primary, then same pattern', () => {
    const target = ex('bench-press')
    const list = alternatives('bench-press', EXERCISES, 'gym', 50)
    const tier = (e: Exercise) =>
      PATTERN_OF[e.id] === PATTERN_OF[target.id] && e.primary === target.primary ? 0 : e.primary === target.primary ? 1 : 2
    const tiers = list.map(tier)
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b))
    expect(tiers[0]).toBe(0)
    expect(tiers).toContain(1) // flyes
    expect(tiers).toContain(2) // close-grip / dips (triceps-primary horizontal pushes)
    for (const e of list) {
      expect(e.primary === target.primary || PATTERN_OF[e.id] === PATTERN_OF[target.id]).toBe(true)
    }
  })

  it('suggests sensible swaps', () => {
    expect(alternatives('bench-press', EXERCISES, 'gym')[0].id).toBe('dumbbell-bench-press')
    expect(alternatives('deadlift', EXERCISES, 'gym')[0].id).toBe('romanian-deadlift')
    expect(alternatives('back-squat', EXERCISES, 'home_dumbbells')[0].id).toBe('goblet-squat')
    expect(ids(alternatives('bench-press', EXERCISES, 'bodyweight', 3))).toContain('push-up')
    expect(ids(alternatives('lat-pulldown', EXERCISES, 'bodyweight', 3))).toContain('pull-up')
    expect(ids(alternatives('triceps-pushdown', EXERCISES, 'home_dumbbells', 3))).toContain('overhead-triceps-extension')
  })

  it('only returns exercises doable with the profile and never the exercise itself', () => {
    for (const p of PROFILES) {
      for (const e of EXERCISES) {
        const list = alternatives(e.id, EXERCISES, p, 10)
        expect(ids(list)).not.toContain(e.id)
        expect(new Set(ids(list)).size).toBe(list.length)
        for (const a of list) expect(isAvailable(a, p), `${p}: ${e.id} -> ${a.id}`).toBe(true)
      }
    }
  })

  it('treats an undefined profile as "everything"', () => {
    expect(ids(alternatives('leg-press', EXERCISES, undefined, 20))).toEqual(ids(alternatives('leg-press', EXERCISES, 'gym', 20)))
  })

  it('respects the limit and is stable', () => {
    expect(alternatives('bench-press', EXERCISES, 'gym', 2)).toHaveLength(2)
    expect(alternatives('bench-press', EXERCISES, 'gym', 0)).toEqual([])
    expect(alternatives('bench-press', EXERCISES, 'gym')).toHaveLength(6)
    expect(ids(alternatives('dumbbell-curl', EXERCISES, 'gym'))).toEqual(ids(alternatives('dumbbell-curl', EXERCISES, 'gym')))
    // input order only breaks ties: reversing the list keeps the tier order
    const reversed = alternatives('dumbbell-curl', [...EXERCISES].reverse(), 'gym', 50)
    expect(reversed.every((e) => e.primary === 'biceps' || PATTERN_OF[e.id] === 'biceps')).toBe(true)
  })

  it('offers related conditioning moves when no closer swap exists', () => {
    const burpee = alternatives('burpee', EXERCISES, 'bodyweight')
    expect(burpee.length).toBeGreaterThan(0)
    expect(burpee.every((e) => PATTERN_OF[e.id] === 'conditioning' || PATTERN_OF[e.id] === 'full_body')).toBe(true)
    expect(ids(burpee)).toContain('mountain-climber')
    // closer tiers still come first
    expect(alternatives('burpee', EXERCISES, 'gym')[0].id).toBe('dumbbell-thruster')
    expect(ids(alternatives('mountain-climber', EXERCISES, 'bodyweight', 20))).toContain('burpee')
  })

  it('finds the target in the built-in library when `all` does not include it', () => {
    const pool = EXERCISES.filter((e) => e.id !== 'bench-press')
    expect(ids(alternatives('bench-press', pool, 'gym'))).toEqual(ids(alternatives('bench-press', EXERCISES, 'gym')))
  })

  it('ignores duplicate ids in the pool', () => {
    const dup = [...EXERCISES, { ...ex('dumbbell-bench-press') }]
    const list = alternatives('bench-press', dup, 'gym', 50)
    expect(new Set(ids(list)).size).toBe(list.length)
  })

  it('handles unknown ids and custom exercises', () => {
    expect(alternatives('nope', EXERCISES, 'gym')).toEqual([])
    const custom: Exercise = { ...ex('lateral-raise'), id: 'my-lateral', name: 'Mi lateral', custom: true }
    const list = alternatives('my-lateral', [...EXERCISES, custom], 'gym', 50)
    expect(list.length).toBeGreaterThan(0)
    expect(list.every((e) => e.primary === 'shoulders')).toBe(true) // custom: no pattern → same primary only
    expect(ids(alternatives('lateral-raise', [...EXERCISES, custom], 'gym', 50))).toContain('my-lateral')
  })
})

describe('suggestAddOns', () => {
  it('prioritises the least-trained muscles of the week', () => {
    const weekly = { chest: 12, back: 12, shoulders: 10, quads: 12, glutes: 9, core: 6, triceps: 8, biceps: 8, calves: 6, forearms: 4, hamstrings: 0 }
    const [first] = suggestAddOns(['bench-press'], weekly, EXERCISES, 'gym')
    expect(first.primary).toBe('hamstrings')
  })

  it('varies muscles, excludes the session and prefers isolation', () => {
    const session = ['bench-press', 'incline-dumbbell-press', 'triceps-pushdown']
    const list = suggestAddOns(session, {}, EXERCISES, 'gym', 4)
    expect(list).toHaveLength(4)
    expect(new Set(list.map((e) => e.primary)).size).toBe(4)
    for (const e of list) {
      expect(session).not.toContain(e.id)
      expect(e.isCompound).toBe(false)
      expect(['chest', 'triceps']).not.toContain(e.primary) // already trained today
    }
  })

  it('counts the current session when balancing', () => {
    const list = suggestAddOns(['back-squat', 'leg-press', 'leg-extension'], {}, EXERCISES, 'gym', 6)
    expect(list.some((e) => e.primary === 'quads')).toBe(false)
  })

  it('filters by equipment and skips cardio / full body', () => {
    for (const p of PROFILES) {
      const list = suggestAddOns([], {}, EXERCISES, p, 8)
      expect(list.length).toBeGreaterThan(0)
      for (const e of list) {
        expect(isAvailable(e, p)).toBe(true)
        expect(['cardio', 'full_body']).not.toContain(e.primary)
      }
    }
  })

  it('ignores session ids it does not know and never repeats an exercise', () => {
    const list = suggestAddOns(['custom-thing', 'bench-press', 'bench-press'], {}, EXERCISES, 'home_dumbbells', 12)
    expect(list).toHaveLength(12)
    expect(new Set(ids(list)).size).toBe(12)
    expect(ids(list)).not.toContain('bench-press')
  })

  it('returns fewer than the limit when the pool runs out (no infinite loop)', () => {
    const pool = [ex('lateral-raise'), ex('dumbbell-curl'), ex('stationary-bike')]
    expect(ids(suggestAddOns([], {}, pool, 'gym', 10)).sort()).toEqual(['dumbbell-curl', 'lateral-raise'])
    expect(suggestAddOns(['lateral-raise', 'dumbbell-curl'], {}, pool, 'gym', 10)).toEqual([])
  })

  it('respects the limit and is deterministic', () => {
    expect(suggestAddOns([], {}, EXERCISES, 'gym', 0)).toEqual([])
    expect(suggestAddOns([], {}, EXERCISES, 'gym')).toHaveLength(4)
    expect(ids(suggestAddOns(['back-squat'], { chest: 3 }, EXERCISES, 'gym', 6))).toEqual(
      ids(suggestAddOns(['back-squat'], { chest: 3 }, EXERCISES, 'gym', 6)),
    )
    const many = suggestAddOns([], {}, EXERCISES, 'gym', 40)
    expect(many).toHaveLength(40)
    expect(new Set(ids(many)).size).toBe(40)
  })
})

describe('searchExercises', () => {
  it('normalizes accents, case and punctuation', () => {
    expect(normalizeText('  Jalón  al PECHO! ')).toBe('jalon al pecho')
    expect(normalizeText('Pájaros')).toBe('pajaros')
    expect(normalizeText('Nórdico, Pingüino y Ñandú')).toBe('nordico pinguino y nandu')
    expect(normalizeText('PRESS-BANCA_80kg')).toBe('press banca 80kg')
  })

  it('ignores connector words ("de", "con", "al") in multi-word queries', () => {
    const curls = ids(searchExercises('curl de bíceps', EXERCISES))
    for (const id of EXERCISES.filter((e) => PATTERN_OF[e.id] === 'biceps').map((e) => e.id)) {
      expect(curls, id).toContain(id)
    }
    const shoulders = searchExercises('press de hombro', EXERCISES).slice(0, 4)
    expect(shoulders.every((e) => e.primary === 'shoulders')).toBe(true)
    expect(ids(searchExercises('peso muerto a una pierna', EXERCISES))[0]).toBe('single-leg-rdl')
    // a query made only of connector words still searches literally
    expect(searchExercises('de', EXERCISES).length).toBeGreaterThan(0)
  })

  it('finds custom exercises and prefers the start of the name while typing', () => {
    const custom: Exercise = { ...ex('lateral-raise'), id: 'my-raise', name: 'Vuelos con botellas', aliases: [], custom: true }
    expect(ids(searchExercises('botel', [...EXERCISES, custom]))).toEqual(['my-raise'])
    expect(ids(searchExercises('sentad', EXERCISES)).slice(0, 3).every((id) => normalizeText(ex(id).name).startsWith('sentad'))).toBe(true)
  })

  it('returns everything sorted by name for an empty query', () => {
    const all = searchExercises('   ', EXERCISES)
    expect(all).toHaveLength(EXERCISES.length)
    const names = all.map((e) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'es')))
  })

  it('is case- and accent-insensitive', () => {
    expect(ids(searchExercises('JALON', EXERCISES))[0]).toBe('lat-pulldown')
    expect(ids(searchExercises('extension de triceps', EXERCISES))).toContain('triceps-pushdown')
    expect(ids(searchExercises('pajaros', EXERCISES))).toEqual(['rear-delt-fly'])
  })

  it('ranks prefix matches first', () => {
    const list = searchExercises('press', EXERCISES)
    const firstNonPrefix = list.findIndex((e) => !normalizeText(e.name).startsWith('press'))
    const prefixAfter = list.slice(firstNonPrefix).some((e) => normalizeText(e.name).startsWith('press'))
    expect(firstNonPrefix).toBeGreaterThan(0)
    expect(prefixAfter).toBe(false)
    expect(ids(searchExercises('press banca', EXERCISES))[0]).toBe('bench-press')
  })

  it('matches aliases (English and Spanish variants)', () => {
    expect(ids(searchExercises('bench press', EXERCISES))[0]).toBe('bench-press')
    expect(ids(searchExercises('lagartijas', EXERCISES))[0]).toBe('push-up')
    expect(ids(searchExercises('rdl', EXERCISES))).toContain('romanian-deadlift')
    expect(ids(searchExercises('pull up', EXERCISES))[0]).toBe('pull-up')
  })

  it('matches muscle labels, with real muscle matches before incidental words', () => {
    const chest = searchExercises('pecho', EXERCISES)
    const firstOther = chest.findIndex((e) => e.primary !== 'chest')
    expect(chest.slice(0, firstOther).length).toBeGreaterThan(8)
    expect(ids(chest)).toContain('lat-pulldown') // "Jalón al pecho" still found, just later
    expect(ids(chest).indexOf('lat-pulldown')).toBeGreaterThan(ids(chest).indexOf('bench-press'))
    expect(searchExercises('gluteos', EXERCISES).every((e) => e.primary === 'glutes' || e.secondary.includes('glutes'))).toBe(true)
    const combo = searchExercises('pecho mancuernas', EXERCISES)
    expect(ids(combo)).toContain('dumbbell-bench-press')
    expect(ids(combo)).not.toContain('bench-press')
  })

  it('returns nothing for gibberish', () => {
    expect(searchExercises('qwxz', EXERCISES)).toEqual([])
  })
})
