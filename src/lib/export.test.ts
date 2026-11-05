import { describe, expect, it } from 'vitest'
import type { SessionSummary } from './types'
import { bestSetOf, buildCsv, describePR, buildSummaryText, cardStats, exportFileName, formatSummarySet, slugify } from './export'

const summary: SessionSummary = {
  sessionId: 'w1',
  name: 'Día A · Empuje',
  startedAt: new Date(2026, 10, 5, 18, 0).getTime(),
  endedAt: new Date(2026, 10, 5, 18, 52).getTime(),
  durationSec: 52 * 60,
  totalSets: 5,
  totalReps: 44,
  volume: 3120,
  unit: 'kg',
  prs: [{ exerciseId: 'bench-press', name: 'Press de banca', weight: 82.5, reps: 8, e1rm: 104.5 }],
  exercises: [
    {
      exerciseId: 'bench-press',
      name: 'Press de banca',
      volume: 2100,
      bestE1rm: 104.5,
      sets: [
        { weight: 80, reps: 10 },
        { weight: 82.5, reps: 8, isPR: true },
        { weight: 80, reps: 9 },
      ],
    },
    {
      exerciseId: 'plank',
      name: 'Plancha, "frontal"',
      volume: 0,
      bestE1rm: null,
      sets: [
        { weight: null, reps: null, seconds: 45 },
        { weight: null, reps: 12 },
      ],
    },
  ],
  muscles: { chest: 3 },
}

describe('formatSummarySet', () => {
  it('formats weight × reps, reps, seconds', () => {
    expect(formatSummarySet({ weight: 80, reps: 10 }, 'kg')).toBe('80 kg × 10')
    expect(formatSummarySet({ weight: 82.5, reps: 8 }, 'kg')).toBe('82.5 kg × 8')
    expect(formatSummarySet({ weight: null, reps: 12 }, 'kg')).toBe('12 reps')
    expect(formatSummarySet({ weight: null, reps: 1 }, 'kg')).toBe('1 rep')
    expect(formatSummarySet({ weight: null, reps: null, seconds: 45 }, 'kg')).toBe('45 s')
    expect(formatSummarySet({ weight: null, reps: null }, 'kg')).toBe('–')
  })
})

describe('buildSummaryText', () => {
  it('builds a clean Spanish summary', () => {
    const t = buildSummaryText(summary, { feeling: 4, notes: ' Buen día ' })
    const lines = t.split('\n')
    expect(lines[0]).toBe('Día A · Empuje · Gymfullness')
    expect(lines[1]).toContain('52 min')
    expect(lines[2]).toBe('2 ejercicios · 5 series · 44 reps · 3.120 kg'.replace('3.120', (3120).toLocaleString('es')))
    expect(t).toContain('Récord personal')
    expect(t).toContain('- Press de banca: 82.5 kg × 8')
    expect(t).toContain('2. 82.5 kg × 8 (récord)')
    expect(t).toContain('1. 45 s')
    expect(t).toContain('Sensación: Bien (4/5)')
    expect(t).toContain('Notas: Buen día')
  })

  it('omits optional sections', () => {
    const t = buildSummaryText({ ...summary, prs: [], volume: 0 })
    expect(t).not.toContain('Récord')
    expect(t).not.toContain('Sensación')
    expect(t.split('\n')[2]).toBe('2 ejercicios · 5 series · 44 reps')
  })
})

describe('buildCsv', () => {
  it('writes one row per set with a header', () => {
    const rows = buildCsv(summary).trim().split('\n')
    expect(rows[0]).toBe('fecha,entreno,ejercicio,serie,peso,unidad,reps,segundos,record')
    expect(rows).toHaveLength(1 + 5)
    expect(rows[1]).toBe('2026-11-05,Día A · Empuje,Press de banca,1,80,kg,10,,')
    expect(rows[2]).toBe('2026-11-05,Día A · Empuje,Press de banca,2,82.5,kg,8,,si')
  })

  it('escapes commas and quotes', () => {
    const rows = buildCsv(summary).trim().split('\n')
    expect(rows[4]).toBe('2026-11-05,Día A · Empuje,"Plancha, ""frontal""",1,,,,45,')
  })
})

describe('describePR', () => {
  it('uses weight × reps, and falls back to the record set for time PRs', () => {
    expect(describePR(summary, summary.prs[0])).toBe('82.5 kg × 8')
    const timed: SessionSummary = {
      ...summary,
      prs: [{ exerciseId: 'plank', name: 'Plancha', weight: null, reps: null, e1rm: null }],
      exercises: [{ ...summary.exercises[1], sets: [{ weight: null, reps: null, seconds: 60, isPR: true }] }],
    }
    expect(describePR(timed, timed.prs[0])).toBe('60 s')
  })
})

describe('file names + card data', () => {
  it('slugifies', () => {
    expect(slugify('Día A · Empuje')).toBe('dia-a-empuje')
    expect(slugify('···')).toBe('entreno')
    expect(exportFileName(summary, 'png')).toBe('gymfullness-2026-11-05-dia-a-empuje.png')
  })
  it('card stats has six tiles', () => {
    const s = cardStats(summary)
    expect(s).toHaveLength(6)
    expect(s[0]).toEqual({ label: 'Duración', value: '52 min' })
    expect(s[5]).toEqual({ label: 'Récords', value: '1' })
  })
  it('best set prefers weight then reps', () => {
    expect(bestSetOf(summary.exercises[0])).toEqual({ weight: 82.5, reps: 8, isPR: true })
    expect(bestSetOf(summary.exercises[1])).toEqual({ weight: null, reps: 12 })
    expect(bestSetOf({ ...summary.exercises[0], sets: [] })).toBeNull()
  })
})
