/** Pure helpers for the routine editor. */
import type { Exercise, Goal, Level, Routine, RoutineItem } from '@/lib/types'
import { uid } from '@/lib/id'
import { prescribe } from '@/lib/planner'

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const copy = list.slice()
  const [x] = copy.splice(from, 1)
  copy.splice(to, 0, x)
  return copy
}

export function insertAt<T>(list: T[], index: number, item: T): T[] {
  const copy = list.slice()
  copy.splice(Math.min(Math.max(0, index), copy.length), 0, item)
  return copy
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

export const LIMITS = {
  sets: { min: 1, max: 10 },
  reps: { min: 1, max: 60 },
  rest: { min: 0, max: 600, step: 15 },
  seconds: { min: 5, max: 900, step: 5 },
} as const

/** Applies a single-field change keeping the item valid (repsMin ≤ repsMax, ranges clamped). */
export function patchItem(item: RoutineItem, field: 'sets' | 'repsMin' | 'repsMax' | 'restSec' | 'targetSeconds', value: number): RoutineItem {
  const next = { ...item }
  switch (field) {
    case 'sets':
      next.sets = clamp(Math.round(value), LIMITS.sets.min, LIMITS.sets.max)
      break
    case 'repsMin':
      next.repsMin = clamp(Math.round(value), LIMITS.reps.min, LIMITS.reps.max)
      if (next.repsMax < next.repsMin) next.repsMax = next.repsMin
      break
    case 'repsMax':
      next.repsMax = clamp(Math.round(value), LIMITS.reps.min, LIMITS.reps.max)
      if (next.repsMin > next.repsMax) next.repsMin = next.repsMax
      break
    case 'restSec':
      next.restSec = clamp(Math.round(value), LIMITS.rest.min, LIMITS.rest.max)
      break
    case 'targetSeconds':
      next.targetSeconds = clamp(Math.round(value), LIMITS.seconds.min, LIMITS.seconds.max)
      break
  }
  return next
}

/** A new routine item with sensible defaults for the user's goal and level. */
export function itemFromExercise(ex: Exercise, goal: Goal, level: Level, mainSlot: boolean): RoutineItem {
  const t = prescribe(ex, goal, level, mainSlot)
  const item: RoutineItem = { id: uid('ri_'), exerciseId: ex.id, sets: t.sets, repsMin: t.repsMin, repsMax: t.repsMax, restSec: t.restSec }
  if (ex.kind === 'time') item.targetSeconds = t.targetSeconds ?? 30
  else if (t.targetSeconds !== undefined) item.targetSeconds = t.targetSeconds
  return item
}

export interface Draft {
  name: string
  focus: string
  items: RoutineItem[]
}

export const toDraft = (r: Pick<Routine, 'name' | 'focus' | 'items'>): Draft => ({ name: r.name, focus: r.focus ?? '', items: r.items })

/** Stable signature used to detect unsaved changes (item ids are included: reorder = change). */
export function draftSignature(d: Draft): string {
  return JSON.stringify({ n: d.name.trim(), f: d.focus.trim(), i: d.items })
}
