import { describe, expect, it } from 'vitest'
import { heatmapGrid, intensityLevel, monthLabels } from './heatmap'

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

describe('heatmapGrid', () => {
  it('has weeks*7 cells, Monday-first, ending in the week of endDate', () => {
    // 2026-11-05 is a Thursday
    const cells = heatmapGrid('2026-11-05', 12)
    expect(cells).toHaveLength(84)
    const last = cells.filter((c) => c.col === 11)
    expect(last[0].key).toBe('2026-11-02') // Monday
    expect(last[6].key).toBe('2026-11-08')
    expect(last.filter((c) => c.future).map((c) => c.key)).toEqual(['2026-11-06', '2026-11-07', '2026-11-08'])
    expect(cells[0].key).toBe('2026-08-17')
    expect(cells[0].row).toBe(0)
  })
  it('a Sunday end date has no future cells', () => {
    const cells = heatmapGrid('2026-11-08', 4)
    expect(cells.some((c) => c.future)).toBe(false)
  })
  it('keys are unique across DST changes', () => {
    const cells = heatmapGrid('2026-11-05', 52)
    expect(new Set(cells.map((c) => c.key)).size).toBe(cells.length)
  })
})

describe('intensityLevel', () => {
  it('maps to 0..4 relative to the max', () => {
    expect(intensityLevel(0, 5)).toBe(0)
    expect(intensityLevel(1, 4)).toBe(1)
    expect(intensityLevel(2, 4)).toBe(2)
    expect(intensityLevel(4, 4)).toBe(4)
    expect(intensityLevel(1, 1)).toBe(4)
    expect(intensityLevel(3, 0)).toBe(4)
  })
})

describe('monthLabels', () => {
  it('labels month changes without crowding', () => {
    const cells = heatmapGrid('2026-11-05', 12)
    const labels = monthLabels(cells, MONTHS)
    const cols = [...labels.keys()]
    for (let i = 1; i < cols.length; i++) expect(cols[i] - cols[i - 1]).toBeGreaterThanOrEqual(3)
    expect([...labels.values()]).toContain('nov')
  })
})
