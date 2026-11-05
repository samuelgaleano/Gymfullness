import { describe, expect, it } from 'vitest'
import type { BodyLog, Exercise, WorkoutSession } from '@/lib/types'
import { smartTip, weekDays, weightPromptDue } from './homeLogic'
import { EXERCISE_BY_ID } from '@/data/exercises'

// Thursday 5 Nov 2026, 10:00 local
const NOW = new Date(2026, 10, 5, 10, 0, 0).getTime()
const DAY = 86_400_000

function session(id: string, daysAgo: number, exerciseId = 'bench-press', sets = 3): WorkoutSession {
  const startedAt = NOW - daysAgo * DAY
  return {
    id,
    routineId: null,
    name: 'Test',
    unit: 'kg',
    startedAt,
    endedAt: startedAt + 3_600_000,
    cursor: { ex: 0, set: 0 },
    updatedAt: startedAt,
    exercises: [
      {
        id: `${id}-e`,
        exerciseId,
        target: { sets, repsMin: 8, repsMax: 12, restSec: 90 },
        sets: Array.from({ length: sets }, (_, i) => ({ id: `${id}-s${i}`, weight: 60, reps: 10, done: true })),
      },
    ],
  }
}

const getEx = (id: string): Exercise | undefined => EXERCISE_BY_ID.get(id)

describe('weekDays', () => {
  it('returns Monday→Sunday flagging trained days and today', () => {
    const days = weekDays([session('a', 1), session('b', 3)], NOW) // Wed + Mon
    expect(days.map((d) => d.label).join('')).toBe('LMXJVSD')
    expect(days.filter((d) => d.trained).map((d) => d.label)).toEqual(['L', 'X'])
    expect(days.find((d) => d.today)?.label).toBe('J')
    expect(days.filter((d) => d.future)).toHaveLength(3)
  })

  it('ignores deleted sessions', () => {
    const s = { ...session('a', 1), deleted: true }
    expect(weekDays([s], NOW).some((d) => d.trained)).toBe(false)
  })
})

describe('smartTip', () => {
  it('is null with no history', () => {
    expect(smartTip({ sessions: [], getExercise: getEx, daysPerWeek: 3, now: NOW })).toBeNull()
  })

  it('suggests coming back after a long break', () => {
    const tip = smartTip({ sessions: [session('a', 9)], getExercise: getEx, daysPerWeek: 3, now: NOW })
    expect(tip?.kind).toBe('comeback')
    expect(tip?.text).toContain('9 días')
  })

  it('celebrates reaching the weekly goal', () => {
    const tip = smartTip({ sessions: [session('a', 1), session('b', 3)], getExercise: getEx, daysPerWeek: 2, now: NOW })
    expect(tip?.kind).toBe('goal')
  })

  it('flags an under-trained muscle once enough work is logged', () => {
    const tip = smartTip({
      sessions: [session('a', 1, 'bench-press', 8)],
      getExercise: getEx,
      daysPerWeek: 4,
      now: NOW,
    })
    expect(tip?.kind).toBe('muscle')
    expect(tip?.text).toMatch(/esta semana/)
  })
})

describe('weightPromptDue', () => {
  const log = (date: string, weight: number | null): BodyLog => ({ id: date, date, weight, unit: 'kg', updatedAt: 0 })
  it('is due with no logs', () => expect(weightPromptDue([], NOW)).toBe(true))
  it('is not due after a recent weight', () => expect(weightPromptDue([log('2026-11-02', 80)], NOW)).toBe(false))
  it('is due when the last weight is older than a week', () => expect(weightPromptDue([log('2026-10-20', 80)], NOW)).toBe(true))
  it('respects the snooze', () => expect(weightPromptDue([], NOW, NOW + 1000)).toBe(false))
  it('ignores logs without weight', () => expect(weightPromptDue([log('2026-11-04', null)], NOW)).toBe(true))
})
