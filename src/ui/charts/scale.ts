/**
 * Pure helpers for the hand-written SVG charts: nice ticks, scales, path building,
 * downsampling and Spanish short dates. No DOM, no React — fully unit-tested.
 */

export interface Pt {
  x: number
  y: number
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
export const DAY_MS = 86_400_000

/** "Nice" number near `range` (Heckbert). round=true picks the closest, false rounds up. */
export function niceNum(range: number, round: boolean): number {
  if (!(range > 0) || !Number.isFinite(range)) return 1
  const exp = Math.floor(Math.log10(range))
  const f = range / 10 ** exp
  let nf: number
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10
  return nf * 10 ** exp
}

export interface NiceTicks {
  ticks: number[]
  min: number
  max: number
  step: number
}

/**
 * Round tick values covering [min, max]. Returns at most `maxTicks` ticks (default 5) and
 * always at least 2. Equal min/max is padded so the line sits mid-chart.
 */
export function niceTicks(min: number, max: number, count = 4, maxTicks = 5): NiceTicks {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { ticks: [0, 1], min: 0, max: 1, step: 1 }
  if (min > max) [min, max] = [max, min]
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1
    min -= pad
    max += pad
  }
  let target = Math.max(2, count)
  for (;;) {
    const step = niceNum((max - min) / (target - 1), true)
    const lo = Math.floor(min / step + 1e-9) * step
    const hi = Math.ceil(max / step - 1e-9) * step
    const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9))
    const n = Math.round((hi - lo) / step)
    const ticks = Array.from({ length: n + 1 }, (_, i) => Number((lo + i * step).toFixed(decimals)))
    if (ticks.length <= maxTicks || target <= 2) {
      return { ticks, min: ticks[0], max: ticks[ticks.length - 1], step }
    }
    target--
  }
}

/** Linear map from [d0, d1] to [r0, r1]. Degenerate domains map to the range midpoint. */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  if (d0 === d1) return () => (r0 + r1) / 2
  const k = (r1 - r0) / (d1 - d0)
  return (v) => r0 + (v - d0) * k
}

const f2 = (n: number) => (Math.round(n * 100) / 100).toString()

/**
 * SVG path through points. Smooth = monotone cubic (Fritsch–Carlson): never overshoots the data,
 * so a flat stretch stays flat and a weight trend never dips below its real minimum.
 */
export function linePath(pts: Pt[], smooth = true): string {
  const n = pts.length
  if (n === 0) return ''
  if (n === 1) return `M${f2(pts[0].x)},${f2(pts[0].y)}`
  if (!smooth || n === 2) return pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${f2(p.x)},${f2(p.y)}`).join('')

  const dx: number[] = []
  const m: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const w = pts[i + 1].x - pts[i].x
    dx.push(w)
    m.push(w === 0 ? 0 : (pts[i + 1].y - pts[i].y) / w)
  }
  const t: number[] = new Array(n)
  t[0] = m[0]
  t[n - 1] = m[n - 2]
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
      continue
    }
    const a = t[i] / m[i]
    const b = t[i + 1] / m[i]
    const s = a * a + b * b
    if (s > 9) {
      const tau = 3 / Math.sqrt(s)
      t[i] = tau * a * m[i]
      t[i + 1] = tau * b * m[i]
    }
  }
  let d = `M${f2(pts[0].x)},${f2(pts[0].y)}`
  for (let i = 0; i < n - 1; i++) {
    const w = dx[i]
    if (w === 0) {
      d += `L${f2(pts[i + 1].x)},${f2(pts[i + 1].y)}`
      continue
    }
    const h = w / 3
    d += `C${f2(pts[i].x + h)},${f2(pts[i].y + t[i] * h)},${f2(pts[i + 1].x - h)},${f2(pts[i + 1].y - t[i + 1] * h)},${f2(pts[i + 1].x)},${f2(pts[i + 1].y)}`
  }
  return d
}

/** Closed area under a line down to `baseY`. */
export function areaPath(pts: Pt[], baseY: number, smooth = true): string {
  if (pts.length < 2) return ''
  const first = pts[0]
  const last = pts[pts.length - 1]
  return `${linePath(pts, smooth)}L${f2(last.x)},${f2(baseY)}L${f2(first.x)},${f2(baseY)}Z`
}

/** Rect with only its top corners rounded (bar charts). */
export function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  if (h <= 0 || w <= 0) return ''
  return `M${f2(x)},${f2(y + h)}V${f2(y + rr)}Q${f2(x)},${f2(y)},${f2(x + rr)},${f2(y)}H${f2(x + w - rr)}Q${f2(x + w)},${f2(y)},${f2(x + w)},${f2(y + rr)}V${f2(y + h)}Z`
}

/**
 * Largest-Triangle-Three-Buckets downsampling: keeps the first and last points and the visually
 * most significant ones in between. Returns the input when it already fits.
 */
export function downsample<T extends Pt>(data: T[], max: number): T[] {
  const n = data.length
  if (max < 3 || n <= max) return data
  const out: T[] = [data[0]]
  const every = (n - 2) / (max - 2)
  let a = 0
  for (let i = 0; i < max - 2; i++) {
    const rs = Math.floor((i + 1) * every) + 1
    const re = Math.min(Math.floor((i + 2) * every) + 1, n)
    let avgX = 0
    let avgY = 0
    for (let j = rs; j < re; j++) {
      avgX += data[j].x
      avgY += data[j].y
    }
    const len = Math.max(1, re - rs)
    avgX /= len
    avgY /= len
    const s = Math.floor(i * every) + 1
    const e = Math.floor((i + 1) * every) + 1
    let best = -1
    let pick = s
    for (let j = s; j < e; j++) {
      const area = Math.abs((data[a].x - avgX) * (data[j].y - data[a].y) - (data[a].x - data[j].x) * (avgY - data[a].y))
      if (area > best) {
        best = area
        pick = j
      }
    }
    out.push(data[pick])
    a = pick
  }
  out.push(data[n - 1])
  return out
}

/** Index of the point whose x is closest to `px` (points sorted ascending by x). */
export function nearestIndex(xs: number[], px: number): number {
  if (!xs.length) return -1
  let lo = 0
  let hi = xs.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] < px) lo = mid
    else hi = mid
  }
  return Math.abs(xs[lo] - px) <= Math.abs(xs[hi] - px) ? lo : hi
}

/** '4 nov' */
export function formatShortDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`
}

/** 'nov 25' */
export function formatMonthYear(ts: number): string {
  const d = new Date(ts)
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`
}

/** Default x-axis formatter: days for spans under ~11 months, months beyond. */
export function defaultXFormat(span: number): (ts: number) => string {
  return span > 330 * DAY_MS ? formatMonthYear : formatShortDate
}

/** Evenly spaced timestamps from x0 to x1 (≤ `count`), de-duplicated by formatted label. */
export function timeTicks(x0: number, x1: number, count: number, format: (ts: number) => string): number[] {
  if (!(x1 > x0) || count < 2) return [x0]
  const out: number[] = []
  const seen = new Set<string>()
  for (let i = 0; i < count; i++) {
    const ts = x0 + ((x1 - x0) * i) / (count - 1)
    const label = format(ts)
    if (seen.has(label)) continue
    seen.add(label)
    out.push(ts)
  }
  return out
}

/** Locale number without trailing noise: 72.4, 1.250, 80. */
export function formatNum(n: number): string {
  return n.toLocaleString('es', { maximumFractionDigits: 1 })
}

/** Approximate rendered width (px) of a label at ~11px, for gutter sizing. */
export function textWidth(s: string, px = 6.2): number {
  return s.length * px
}

/** Indices of labels to show so they never collide; always includes the last one. */
export function labelIndices(n: number, slotWidth: number, labelWidth: number): number[] {
  if (n === 0) return []
  const step = Math.max(1, Math.ceil((labelWidth + 6) / Math.max(1, slotWidth)))
  const out: number[] = []
  for (let i = n - 1; i >= 0; i -= step) out.unshift(i)
  return out
}

export interface SeriesSummary {
  count: number
  first: number
  last: number
  min: number
  max: number
}

export function summarize(values: number[]): SeriesSummary | null {
  if (!values.length) return null
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  return { count: values.length, first: values[0], last: values[values.length - 1], min, max }
}
