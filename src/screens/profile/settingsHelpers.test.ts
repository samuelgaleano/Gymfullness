import { describe, expect, it } from 'vitest'
import type { WorkoutSession } from '@/lib/types'
import {
  buildAllSetsCsv,
  clampRest,
  confirmWordMatches,
  formatRest,
  formatSyncAgo,
  initials,
  parseBounded,
  planFieldsChanged,
  planInputFromProfile,
  speechLangOptions,
  stepRest,
} from './settingsHelpers'

describe('rest helpers', () => {
  it('clamps and snaps to 15 s within 30–300', () => {
    expect(clampRest(10)).toBe(30)
    expect(clampRest(1000)).toBe(300)
    expect(clampRest(92)).toBe(90)
    expect(clampRest(NaN)).toBe(90)
  })
  it('steps without leaving the range', () => {
    expect(stepRest(30, -1)).toBe(30)
    expect(stepRest(300, 1)).toBe(300)
    expect(stepRest(90, 1)).toBe(105)
  })
  it('formats m:ss', () => {
    expect(formatRest(90)).toBe('1:30')
    expect(formatRest(60)).toBe('1:00')
    expect(formatRest(45)).toBe('0:45')
  })
})

describe('misc helpers', () => {
  it('initials', () => {
    expect(initials('Ana María López')).toBe('AL')
    expect(initials('carlos')).toBe('C')
    expect(initials('', '?')).toBe('?')
  })
  it('formatSyncAgo', () => {
    const now = 10_000_000
    expect(formatSyncAgo(null, now)).toBe('Aún sin sincronizar')
    expect(formatSyncAgo(now - 5_000, now)).toBe('Sincronizado ahora mismo')
    expect(formatSyncAgo(now - 120_000, now)).toBe('Sincronizado hace 2 min')
    expect(formatSyncAgo(now - 3 * 3_600_000, now)).toBe('Sincronizado hace 3 h')
    expect(formatSyncAgo(now - 86_400_000, now)).toBe('Sincronizado hace 1 día')
  })
  it('planFieldsChanged only for plan-related fields', () => {
    const prev = { onboarded: true, updatedAt: 0, goal: 'muscle' as const }
    expect(planFieldsChanged(prev, { name: 'X' })).toBe(false)
    expect(planFieldsChanged(prev, { goal: 'muscle' })).toBe(false)
    expect(planFieldsChanged(prev, { goal: 'strength' })).toBe(true)
    expect(planFieldsChanged(prev, { daysPerWeek: 4 })).toBe(true)
  })
  it('planInputFromProfile falls back to defaults', () => {
    expect(planInputFromProfile({ onboarded: true, updatedAt: 0 })).toEqual({
      goal: 'muscle',
      level: 'beginner',
      daysPerWeek: 3,
      equipment: 'gym',
    })
  })
  it('parseBounded', () => {
    expect(parseBounded('175', 100, 250)).toBe(175)
    expect(parseBounded('1,75', 0, 3)).toBe(1.8)
    expect(parseBounded('', 0, 10)).toBeNull()
    expect(parseBounded('999', 0, 10)).toBeNull()
    expect(parseBounded('abc', 0, 10)).toBeNull()
  })
  it('confirmWordMatches', () => {
    expect(confirmWordMatches(' borrar ')).toBe(true)
    expect(confirmWordMatches('borra')).toBe(false)
  })
  it('speechLangOptions keeps unknown saved languages', () => {
    expect(speechLangOptions('es-CO')).toHaveLength(5)
    expect(speechLangOptions('es-US')[0].value).toBe('es-US')
  })
})

describe('buildAllSetsCsv', () => {
  const mk = (id: string, startedAt: number, extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
    id,
    name: 'Día A, fuerte',
    unit: 'kg',
    startedAt,
    endedAt: startedAt + 1000,
    cursor: { ex: 0, set: 0 },
    updatedAt: 1,
    exercises: [
      {
        id: 'e',
        exerciseId: 'bench',
        target: { sets: 2, repsMin: 8, repsMax: 10, restSec: 90 },
        sets: [
          { id: 'a', weight: 60, reps: 10, done: true, isPR: true },
          { id: 'b', weight: 60, reps: 8, done: false },
          { id: 'c', weight: 62.5, reps: 8, done: true },
        ],
      },
    ],
    ...extra,
  })
  it('writes one row per done set, numbered, escaping commas', () => {
    const csv = buildAllSetsCsv([mk('2', 2_000_000_000_000), mk('1', 1_000_000_000_000), mk('3', 3, { deleted: true })], () => 'Press de banca')
    const lines = csv.split('\n')
    expect(lines[0]).toBe('fecha,entreno,ejercicio,serie,peso,unidad,reps,segundos,rpe,record')
    expect(lines).toHaveLength(5)
    expect(lines[1]).toContain('"Día A, fuerte",Press de banca,1,60,kg,10,,,si')
    expect(lines[2]).toContain(',2,62.5,kg,8,')
    expect(lines[1] < lines[3]).toBe(true) // oldest first
  })
})
