import { describe, expect, it } from 'vitest'
import { EXERCISES } from '@/data/exercises'
import { filterExercises, groupByMuscle } from './exerciseList'

describe('filterExercises', () => {
  it('returns everything alphabetically with no filters', () => {
    const r = filterExercises(EXERCISES, {})
    expect(r).toHaveLength(EXERCISES.length)
  })

  it('searches ignoring accents and case', () => {
    const r = filterExercises(EXERCISES, { query: 'PRESS BANCA' })
    expect(r.length).toBeGreaterThan(0)
    expect(r.some((e) => e.id === 'bench-press')).toBe(true)
  })

  it('filters by muscle', () => {
    const r = filterExercises(EXERCISES, { muscle: 'quads' })
    expect(r.length).toBeGreaterThan(0)
    expect(r.every((e) => e.primary === 'quads' || e.secondary.includes('quads'))).toBe(true)
  })

  it('filters by equipment and by "mine"', () => {
    const bw = filterExercises(EXERCISES, { equipment: 'bodyweight' })
    expect(bw.every((e) => e.equipment.includes('bodyweight'))).toBe(true)
    const mine = filterExercises(EXERCISES, { equipment: 'mine', profileEquipment: 'bodyweight' })
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((e) => e.equipment.every((q) => ['bodyweight', 'pullup_bar', 'band'].includes(q)))).toBe(true)
  })

  it('hides excluded ids', () => {
    const r = filterExercises(EXERCISES, { excludeIds: ['bench-press'] })
    expect(r.find((e) => e.id === 'bench-press')).toBeUndefined()
  })
})

describe('groupByMuscle', () => {
  it('groups in the canonical muscle order', () => {
    const groups = groupByMuscle(filterExercises(EXERCISES, {}))
    expect(groups[0].muscle).toBe('chest')
    expect(groups.reduce((n, g) => n + g.items.length, 0)).toBe(EXERCISES.length)
  })
})
