import { describe, expect, it } from 'vitest'
import {
  areaPath,
  defaultXFormat,
  downsample,
  formatMonthYear,
  formatShortDate,
  labelIndices,
  linePath,
  linearScale,
  nearestIndex,
  niceNum,
  niceTicks,
  roundedTopRect,
  summarize,
  timeTicks,
} from './scale'

describe('niceNum / niceTicks', () => {
  it('rounds to 1-2-5 steps', () => {
    expect(niceNum(0.7, true)).toBe(0.5)
    expect(niceNum(23, true)).toBe(20)
    expect(niceNum(23, false)).toBe(50)
    expect(niceNum(0, true)).toBe(1)
  })

  it('produces round ticks that cover the data', () => {
    const t = niceTicks(71.3, 76.8, 4)
    expect(t.ticks[0]).toBeLessThanOrEqual(71.3)
    expect(t.ticks[t.ticks.length - 1]).toBeGreaterThanOrEqual(76.8)
    expect(t.ticks).toEqual([70, 72, 74, 76, 78])
  })

  it('never returns more than maxTicks and always at least 2', () => {
    for (const [a, b] of [[0, 1], [0, 100000], [3.2, 3.9], [-5, 5], [0, 7], [1000, 1010]]) {
      const t = niceTicks(a, b, 4)
      expect(t.ticks.length).toBeGreaterThanOrEqual(2)
      expect(t.ticks.length).toBeLessThanOrEqual(5)
      expect(t.min).toBeLessThanOrEqual(a)
      expect(t.max).toBeGreaterThanOrEqual(b)
    }
  })

  it('pads a flat series and avoids float noise', () => {
    const t = niceTicks(80, 80, 4)
    expect(t.min).toBeLessThan(80)
    expect(t.max).toBeGreaterThan(80)
    const f = niceTicks(0, 0.3, 4)
    expect(f.ticks.every((v) => Number.isFinite(v) && String(v).length < 6)).toBe(true)
  })

  it('handles swapped and non-finite input', () => {
    expect(niceTicks(10, 0).min).toBe(0)
    expect(niceTicks(NaN, 3).ticks).toHaveLength(2)
  })
})

describe('linearScale', () => {
  it('maps domain to range (also inverted)', () => {
    const s = linearScale(0, 10, 100, 0)
    expect(s(0)).toBe(100)
    expect(s(10)).toBe(0)
    expect(s(5)).toBe(50)
  })
  it('degenerate domain maps to the midpoint', () => {
    expect(linearScale(3, 3, 0, 10)(3)).toBe(5)
  })
})

describe('paths', () => {
  const pts = [
    { x: 0, y: 10 },
    { x: 10, y: 0 },
    { x: 20, y: 0 },
    { x: 30, y: 10 },
  ]
  it('builds M/L for straight lines and a single point', () => {
    expect(linePath([{ x: 1, y: 2 }])).toBe('M1,2')
    expect(linePath(pts, false)).toBe('M0,10L10,0L20,0L30,10')
    expect(linePath([])).toBe('')
  })
  it('smooth path starts at the first point and ends at the last', () => {
    const d = linePath(pts)
    expect(d.startsWith('M0,10C')).toBe(true)
    expect(d.endsWith('30,10')).toBe(true)
  })
  it('monotone smoothing does not overshoot a flat segment', () => {
    const d = linePath(pts)
    const nums = d.match(/-?\d+(\.\d+)?/g)!.map(Number)
    // all y values (odd indices) stay within the data range
    for (let i = 1; i < nums.length; i += 2) {
      expect(nums[i]).toBeGreaterThanOrEqual(-0.01)
      expect(nums[i]).toBeLessThanOrEqual(10.01)
    }
  })
  it('duplicate x does not produce NaN', () => {
    expect(linePath([{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 4, y: 2 }])).not.toMatch(/NaN|Infinity/)
  })
  it('closes the area at the baseline', () => {
    const a = areaPath(pts, 20)
    expect(a.endsWith('L0,20Z')).toBe(true)
    expect(areaPath([pts[0]], 20)).toBe('')
  })
  it('rounded-top rect', () => {
    expect(roundedTopRect(0, 0, 10, 0, 4)).toBe('')
    expect(roundedTopRect(0, 0, 10, 20, 4)).toContain('Q')
  })
})

describe('downsample', () => {
  const data = Array.from({ length: 500 }, (_, i) => ({ x: i, y: Math.sin(i / 20) * 10 }))
  it('returns input when small enough', () => {
    expect(downsample(data.slice(0, 10), 50)).toHaveLength(10)
  })
  it('reduces to max points keeping endpoints and order', () => {
    const out = downsample(data, 60)
    expect(out).toHaveLength(60)
    expect(out[0]).toBe(data[0])
    expect(out[59]).toBe(data[499])
    for (let i = 1; i < out.length; i++) expect(out[i].x).toBeGreaterThan(out[i - 1].x)
  })
  it('keeps a spike', () => {
    const d = Array.from({ length: 200 }, (_, i) => ({ x: i, y: i === 101 ? 100 : 1 }))
    expect(downsample(d, 30).some((p) => p.y === 100)).toBe(true)
  })
})

describe('nearestIndex / labels / dates', () => {
  it('finds the closest x', () => {
    const xs = [0, 10, 20, 100]
    expect(nearestIndex(xs, -5)).toBe(0)
    expect(nearestIndex(xs, 14)).toBe(1)
    expect(nearestIndex(xs, 16)).toBe(2)
    expect(nearestIndex(xs, 90)).toBe(3)
    expect(nearestIndex([], 3)).toBe(-1)
    expect(nearestIndex([5], 3)).toBe(0)
  })
  it('labelIndices thins labels and keeps the last', () => {
    expect(labelIndices(4, 80, 30)).toEqual([0, 1, 2, 3])
    const idx = labelIndices(12, 24, 34)
    expect(idx[idx.length - 1]).toBe(11)
    expect(idx.length).toBeLessThan(12)
    expect(labelIndices(0, 10, 10)).toEqual([])
  })
  it('formats Spanish short dates', () => {
    const ts = new Date(2026, 10, 4).getTime()
    expect(formatShortDate(ts)).toBe('4 nov')
    expect(formatMonthYear(ts)).toBe('nov 26')
    expect(defaultXFormat(400 * 86_400_000)).toBe(formatMonthYear)
    expect(defaultXFormat(30 * 86_400_000)).toBe(formatShortDate)
  })
  it('timeTicks are evenly spaced and de-duplicated', () => {
    const a = new Date(2026, 0, 1).getTime()
    const b = new Date(2026, 3, 1).getTime()
    const t = timeTicks(a, b, 4, formatShortDate)
    expect(t).toHaveLength(4)
    expect(t[0]).toBe(a)
    expect(t[3]).toBe(b)
    expect(timeTicks(a, a, 4, formatShortDate)).toEqual([a])
    expect(timeTicks(a, a + 3600_000, 4, formatShortDate)).toHaveLength(1)
  })
  it('summarize', () => {
    expect(summarize([])).toBeNull()
    expect(summarize([3, 1, 5])).toEqual({ count: 3, first: 3, last: 5, min: 1, max: 5 })
  })
})
