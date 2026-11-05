import { describe, expect, it } from 'vitest'
import type { RoutineItem } from '@/lib/types'
import { EXERCISE_BY_ID } from '@/data/exercises'
import { draftSignature, insertAt, itemFromExercise, moveItem, patchItem } from './editorLogic'

const item = (over: Partial<RoutineItem> = {}): RoutineItem => ({ id: 'a', exerciseId: 'bench-press', sets: 3, repsMin: 8, repsMax: 12, restSec: 90, ...over })

describe('moveItem', () => {
  it('moves and ignores out-of-range', () => {
    expect(moveItem([1, 2, 3], 0, 1)).toEqual([2, 1, 3])
    expect(moveItem([1, 2, 3], 2, 0)).toEqual([3, 1, 2])
    const same = [1, 2]
    expect(moveItem(same, 0, -1)).toBe(same)
    expect(moveItem(same, 1, 2)).toBe(same)
  })
})

describe('insertAt', () => {
  it('re-inserts at the original index (undo)', () => {
    expect(insertAt([1, 3], 1, 2)).toEqual([1, 2, 3])
    expect(insertAt([1], 9, 2)).toEqual([1, 2])
  })
})

describe('patchItem', () => {
  it('keeps repsMin <= repsMax', () => {
    expect(patchItem(item(), 'repsMin', 15)).toMatchObject({ repsMin: 15, repsMax: 15 })
    expect(patchItem(item(), 'repsMax', 5)).toMatchObject({ repsMin: 5, repsMax: 5 })
  })
  it('clamps values', () => {
    expect(patchItem(item(), 'sets', 0).sets).toBe(1)
    expect(patchItem(item(), 'sets', 99).sets).toBe(10)
    expect(patchItem(item(), 'restSec', -5).restSec).toBe(0)
    expect(patchItem(item(), 'targetSeconds', 1).targetSeconds).toBe(5)
  })
  it('does not mutate', () => {
    const a = item()
    patchItem(a, 'sets', 5)
    expect(a.sets).toBe(3)
  })
})

describe('itemFromExercise', () => {
  it('uses planner defaults for the goal', () => {
    const ex = EXERCISE_BY_ID.get('bench-press')!
    const it1 = itemFromExercise(ex, 'strength', 'intermediate', true)
    expect(it1.exerciseId).toBe('bench-press')
    expect(it1.repsMax).toBeLessThanOrEqual(8)
    expect(it1.restSec).toBeGreaterThanOrEqual(120)
  })
  it('sets targetSeconds for time exercises', () => {
    const ex = EXERCISE_BY_ID.get('plank')!
    expect(itemFromExercise(ex, 'muscle', 'beginner', false).targetSeconds).toBeGreaterThan(0)
  })
})

describe('draftSignature', () => {
  it('changes on edit and on reorder, not on whitespace padding', () => {
    const a = { name: 'Día A', focus: '', items: [item({ id: '1' }), item({ id: '2' })] }
    expect(draftSignature(a)).toBe(draftSignature({ ...a, name: ' Día A ' }))
    expect(draftSignature(a)).not.toBe(draftSignature({ ...a, items: [a.items[1], a.items[0]] }))
    expect(draftSignature(a)).not.toBe(draftSignature({ ...a, items: [patchItem(a.items[0], 'sets', 4), a.items[1]] }))
  })
})
