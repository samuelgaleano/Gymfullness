/**
 * Pure view-model helpers for the Progress screen (no React, no store access).
 * Heavy lifting (stats, PRs, series) comes from lib/stats.ts; this file only shapes it for display.
 */
import type { BodyLog, Exercise, ExerciseKind, MuscleGroup, Unit, WorkoutSession } from '@/lib/types'
import { WEEKLY_SET_TARGET, normalizeText } from '@/lib/recommend'
import { MUSCLE_LABEL } from '@/data/exercises'
import { exerciseHistory, isWorkingSet, type WeekStat } from '@/lib/stats'
import { formatClock, fromDateKey, toDateKey } from '@/lib/date'
import { formatVolume as fvRaw, formatWeight as fwRaw } from '@/lib/units'

/** Spanish decimal comma for display. */
const formatWeight = (n: number) => fwRaw(n).replace('.', ',')
const formatVolume = (n: number, u: Parameters<typeof fvRaw>[1]) => fvRaw(n, u).replace('.', ',')
export { formatWeight as formatWeightEs, formatVolume as formatVolumeEs }
import { formatShortDate } from '@/ui/charts/scale'

const DAY = 86_400_000

/* ---------------- Body ---------------- */

export type BodyRange = '1M' | '3M' | '6M' | 'all'
export const RANGE_DAYS: Record<Exclude<BodyRange, 'all'>, number> = { '1M': 30, '3M': 91, '6M': 182 }

export interface DatedValue {
  date: string
  value: number
}

export function filterRange<T extends { date: string }>(series: T[], range: BodyRange, now: number = Date.now()): T[] {
  if (range === 'all') return series
  const from = toDateKey(now - RANGE_DAYS[range] * DAY)
  return series.filter((p) => p.date >= from)
}

/** Latest value vs the latest value on/before `days` ago. Falls back to the oldest log if it is ≥ 7 days old. */
export function deltaOver(series: DatedValue[], days: number, now: number = Date.now()): { current: number; delta: number; days: number } | null {
  if (series.length < 2) return null
  const current = series[series.length - 1]
  const cutoff = toDateKey(now - days * DAY)
  let ref: DatedValue | undefined
  for (const p of series) if (p.date <= cutoff) ref = p
  if (!ref) {
    const first = series[0]
    const age = Math.round((fromDateKey(current.date).getTime() - fromDateKey(first.date).getTime()) / DAY)
    if (age < 7) return null
    ref = first
  }
  if (ref === current) return null
  const span = Math.round((fromDateKey(current.date).getTime() - fromDateKey(ref.date).getTime()) / DAY)
  return { current: current.value, delta: Math.round((current.value - ref.value) * 10) / 10, days: span }
}

/** Last value vs the one before it. */
export function lastDelta(series: DatedValue[]): number | null {
  if (series.length < 2) return null
  return Math.round((series[series.length - 1].value - series[series.length - 2].value) * 10) / 10
}

export type BodyMetric = 'bodyFat' | 'waist' | 'chest' | 'arm' | 'thigh' | 'hips' | 'neck'
export const BODY_METRICS: { key: BodyMetric; label: string; unit: string; step: number; start: number }[] = [
  { key: 'bodyFat', label: '% grasa', unit: '%', step: 0.1, start: 20 },
  { key: 'waist', label: 'Cintura', unit: 'cm', step: 0.5, start: 80 },
  { key: 'chest', label: 'Pecho', unit: 'cm', step: 0.5, start: 95 },
  { key: 'arm', label: 'Brazo', unit: 'cm', step: 0.5, start: 32 },
  { key: 'thigh', label: 'Muslo', unit: 'cm', step: 0.5, start: 55 },
  { key: 'hips', label: 'Cadera', unit: 'cm', step: 0.5, start: 95 },
  { key: 'neck', label: 'Cuello', unit: 'cm', step: 0.5, start: 37 },
]

/** How a log row is summarised under its date: '18,2 % grasa · cintura 84 cm'. */
export function logExtras(log: BodyLog): string {
  const parts: string[] = []
  for (const m of BODY_METRICS) {
    const v = log[m.key]
    if (typeof v === 'number') parts.push(m.key === 'bodyFat' ? `${formatWeight(v)} % grasa` : `${m.label.toLowerCase()} ${formatWeight(v)} cm`)
  }
  return parts.join(' · ')
}

/** Does moving in `dir` match what the user wants? Unknown goals stay neutral (never shame). */
export function deltaTone(goal: string | undefined, delta: number): 'good' | 'neutral' {
  if (delta === 0) return 'neutral'
  if (goal === 'fat_loss' && delta < 0) return 'good'
  if (goal === 'muscle' && delta > 0) return 'good'
  return 'neutral'
}

/* ---------------- Muscle balance ---------------- */

export type BalanceStatus = 'under' | 'ok' | 'over'
export interface BalanceRow {
  muscle: MuscleGroup
  label: string
  value: number
  target: number
  status: BalanceStatus
}

export const UNDER_RATIO = 0.6
export const OVER_RATIO = 1.5

export function balanceStatus(value: number, target: number): BalanceStatus {
  const r = value / target
  return r < UNDER_RATIO ? 'under' : r > OVER_RATIO ? 'over' : 'ok'
}

export function muscleBalance(sets: Partial<Record<MuscleGroup, number>>): BalanceRow[] {
  return (Object.entries(WEEKLY_SET_TARGET) as [MuscleGroup, number][]).map(([muscle, target]) => {
    const value = Math.round((sets[muscle] ?? 0) * 10) / 10
    return { muscle, label: MUSCLE_LABEL[muscle], value, target, status: balanceStatus(value, target) }
  })
}

/** One calm sentence about the week's balance. */
export function balanceInsight(rows: BalanceRow[]): string {
  const total = rows.reduce((a, r) => a + r.value, 0)
  if (total < 6) return 'Entrena esta semana y aquí verás cómo se reparte tu trabajo por músculo.'
  const under = rows.filter((r) => r.status === 'under').sort((a, b) => a.value / a.target - b.value / b.target)
  if (under.length === 0) return 'Buen reparto: todos los grupos van al día esta semana.'
  const w = under[0]
  const n = Math.floor(w.value)
  const label = w.label.toLowerCase()
  return n === 0
    ? `Aún no entrenas ${label} esta semana. Un ejercicio extra lo equilibra.`
    : `Llevas ${n} ${n === 1 ? 'serie' : 'series'} de ${label} (meta ${w.target}). Suma un ejercicio y listo.`
}

/* ---------------- Weeks ---------------- */

export type WeekMetric = 'volume' | 'sessions' | 'minutes'

export function weekBars(weeks: WeekStat[], metric: WeekMetric): { label: string; value: number; highlight?: boolean }[] {
  return weeks.map((w, i) => ({
    label: formatShortDate(fromDateKey(w.weekStart).getTime()),
    value: metric === 'volume' ? w.volume : metric === 'sessions' ? w.sessions : w.minutes,
    highlight: i === weeks.length - 1,
  }))
}

/** Compact y-axis numbers: 12400 → '12,4k'. */
export function compactNumber(v: number): string {
  if (Math.abs(v) >= 1000) return `${(v / 1000).toLocaleString('es', { maximumFractionDigits: 1 })}k`
  return v.toLocaleString('es', { maximumFractionDigits: 1 })
}

/** Working sets per local day (heatmap intensity). */
export function setsByDay(sessions: WorkoutSession[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of sessions) {
    const k = toDateKey(s.startedAt)
    let n = 0
    for (const se of s.exercises) n += se.sets.filter(isWorkingSet).length
    out[k] = (out[k] ?? 0) + n
  }
  return out
}

/* ---------------- History ---------------- */

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function monthLabel(ts: number, now: number = Date.now()): string {
  const d = new Date(ts)
  const name = MONTH_NAMES[d.getMonth()]
  const cap = name[0].toUpperCase() + name.slice(1)
  return d.getFullYear() === new Date(now).getFullYear() ? cap : `${cap} ${d.getFullYear()}`
}

/** Groups items by calendar month, newest month first, newest item first within. */
export function groupByMonth<T extends { startedAt: number }>(items: T[], now: number = Date.now()): { key: string; label: string; items: T[] }[] {
  const sorted = items.slice().sort((a, b) => b.startedAt - a.startedAt)
  const groups: { key: string; label: string; items: T[] }[] = []
  for (const it of sorted) {
    const d = new Date(it.startedAt)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(it)
    else groups.push({ key, label: monthLabel(it.startedAt, now), items: [it] })
  }
  return groups
}

/* ---------------- Exercises ---------------- */

export type ExMetric = 'e1rm' | 'weight' | 'volume' | 'reps' | 'seconds'

export const METRIC_LABEL: Record<ExMetric, string> = { e1rm: 'e1RM', weight: 'Peso', volume: 'Volumen', reps: 'Reps', seconds: 'Tiempo' }

export function metricsFor(kind: ExerciseKind): ExMetric[] {
  if (kind === 'time') return ['seconds']
  if (kind === 'reps') return ['reps']
  return ['e1rm', 'weight', 'volume', 'reps']
}

export function formatMetric(metric: ExMetric, v: number, unit: Unit): string {
  switch (metric) {
    case 'e1rm':
    case 'weight':
      return `${formatWeight(v)} ${unit}`
    case 'volume':
      return formatVolume(v, unit)
    case 'reps':
      return `${Math.round(v)} reps`
    case 'seconds':
      return v >= 60 ? formatClock(v) : `${Math.round(v)} s`
  }
}

/** Best hold (seconds) per session for a timed exercise. */
function secondsHistory(sessions: WorkoutSession[], exerciseId: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const s of sessions.filter((x) => !x.deleted).sort((a, b) => a.startedAt - b.startedAt)) {
    let best = 0
    for (const se of s.exercises) {
      if (se.exerciseId !== exerciseId) continue
      for (const set of se.sets) if (isWorkingSet(set) && (set.seconds ?? 0) > best) best = set.seconds ?? 0
    }
    if (best > 0) out.push({ x: s.startedAt, y: best })
  }
  return out
}

/** Chart series (x = timestamp) for one exercise and metric. */
export function exerciseSeries(sessions: WorkoutSession[], exerciseId: string, metric: ExMetric, unit: Unit): { x: number; y: number }[] {
  if (metric === 'seconds') return secondsHistory(sessions, exerciseId)
  const pick = (p: ReturnType<typeof exerciseHistory>[number]): number | null =>
    metric === 'e1rm' ? p.bestE1rm : metric === 'weight' ? p.bestWeight : metric === 'volume' ? (p.volume > 0 ? p.volume : null) : p.bestReps
  return exerciseHistory(sessions, exerciseId, unit).flatMap((p) => {
    const y = pick(p)
    return y === null ? [] : [{ x: p.date, y }]
  })
}

export interface ExerciseRowData {
  id: string
  name: string
  kind: ExerciseKind
  metric: ExMetric
  last: number | null
  best: number | null
  sessions: number
  lastDate: number
  spark: number[]
}

/** One row per exercise the user has trained, most recently trained first. */
export function exerciseRows(
  sessions: WorkoutSession[],
  unit: Unit,
  getExercise: (id: string) => Exercise | undefined,
): ExerciseRowData[] {
  const ids = new Set<string>()
  for (const s of sessions) if (!s.deleted) for (const se of s.exercises) if (se.sets.some(isWorkingSet)) ids.add(se.exerciseId)
  const rows: ExerciseRowData[] = []
  for (const id of ids) {
    const ex = getExercise(id)
    const kind: ExerciseKind = ex?.kind ?? 'weight_reps'
    let metric: ExMetric = metricsFor(kind)[0]
    let series = exerciseSeries(sessions, id, metric, unit)
    if (!series.length && metric === 'e1rm') {
      metric = 'reps'
      series = exerciseSeries(sessions, id, metric, unit)
    }
    const all = exerciseHistory(sessions, id, unit)
    const count = metric === 'seconds' ? series.length : all.length
    if (!count) continue
    const ys = series.map((p) => p.y)
    rows.push({
      id,
      name: ex?.name ?? id.replace(/[-_]+/g, ' '),
      kind,
      metric,
      last: ys.length ? ys[ys.length - 1] : null,
      best: ys.length ? Math.max(...ys) : null,
      sessions: count,
      lastDate: series.length ? series[series.length - 1].x : all[all.length - 1].date,
      spark: ys.slice(-10),
    })
  }
  return rows.sort((a, b) => b.lastDate - a.lastDate)
}

export function filterExerciseRows(rows: ExerciseRowData[], query: string): ExerciseRowData[] {
  const q = normalizeText(query)
  return q ? rows.filter((r) => normalizeText(r.name).includes(q)) : rows
}

export interface SessionLine {
  sessionId: string
  date: number
  best: string
  sets: number
  volume: number
}

/** Last sessions of an exercise for the sheet table (newest first). */
export function recentLines(sessions: WorkoutSession[], exerciseId: string, unit: Unit, limit = 6): SessionLine[] {
  const hist = exerciseHistory(sessions, exerciseId, unit)
  const byDate = new Map(sessions.filter((s) => !s.deleted).map((s) => [s.startedAt, s]))
  return hist
    .slice(-limit)
    .reverse()
    .map((p) => {
      const s = byDate.get(p.date)
      let best = '–'
      if (s) {
        let top: { w: number; r: number; score: number } | null = null
        for (const se of s.exercises) {
          if (se.exerciseId !== exerciseId) continue
          for (const set of se.sets) {
            if (!isWorkingSet(set)) continue
            const w = set.weight ?? 0
            const r = set.reps ?? 0
            const secs = set.seconds ?? 0
            const score = w * (1 + r / 30) + r + secs / 100
            if (!top || score > top.score) top = { w, r, score }
            if (secs > 0 && !w && !r) best = `${secs} s`
          }
        }
        if (top && (top.w || top.r)) best = top.w ? `${formatWeight(top.w)} × ${top.r}` : `${top.r} reps`
      }
      return { sessionId: s?.id ?? String(p.date), date: p.date, best, sets: p.sets, volume: p.volume }
    })
}
