/** Pure helpers for the Profile screen (formatting, clamping, CSV, plan-change detection). */
import type { Profile, WorkoutSession } from '@/lib/types'
import { toDateKey } from '@/lib/date'

export const REST_MIN = 30
export const REST_MAX = 300
export const REST_STEP = 15

export function clampRest(sec: number): number {
  if (!Number.isFinite(sec)) return 90
  const snapped = Math.round(sec / REST_STEP) * REST_STEP
  return Math.min(REST_MAX, Math.max(REST_MIN, snapped))
}

export function stepRest(sec: number, dir: 1 | -1): number {
  return clampRest(clampRest(sec) + dir * REST_STEP)
}

/** 90 → '1:30', 60 → '1:00', 45 → '0:45'. */
export function formatRest(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export const SPEECH_LANGS: { value: string; label: string }[] = [
  { value: 'es-CO', label: 'Español (CO)' },
  { value: 'es-MX', label: 'Español (MX)' },
  { value: 'es-ES', label: 'Español (ES)' },
  { value: 'es-AR', label: 'Español (AR)' },
  { value: 'en-US', label: 'English (US)' },
]

/** The saved language may be something else (e.g. 'es-US'); keep it selectable. */
export function speechLangOptions(current: string): { value: string; label: string }[] {
  return SPEECH_LANGS.some((l) => l.value === current) ? SPEECH_LANGS : [{ value: current, label: current }, ...SPEECH_LANGS]
}

export function initials(name: string | null | undefined, fallback = ''): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  const first = parts[0][0] ?? ''
  const last = parts.length > 1 ? (parts[parts.length - 1][0] ?? '') : ''
  return (first + last).toUpperCase()
}

/** 'Sincronizado hace 2 min' */
export function formatSyncAgo(ts: number | null, now = Date.now()): string {
  if (!ts) return 'Aún sin sincronizar'
  const diff = Math.max(0, now - ts)
  const min = Math.floor(diff / 60_000)
  if (min < 1) return 'Sincronizado ahora mismo'
  if (min < 60) return `Sincronizado hace ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `Sincronizado hace ${h} h`
  const d = Math.floor(h / 24)
  return `Sincronizado hace ${d} ${d === 1 ? 'día' : 'días'}`
}

/** True when an edit touches a field that the generated plan depends on. */
export function planFieldsChanged(prev: Profile, next: Partial<Profile>): boolean {
  return (['goal', 'level', 'daysPerWeek', 'equipment'] as const).some((k) => k in next && next[k] !== prev[k])
}

export const GOAL_DEFAULTS = { goal: 'muscle', level: 'beginner', daysPerWeek: 3, equipment: 'gym' } as const

/** Plan inputs from a profile, falling back to the onboarding defaults. */
export function planInputFromProfile(p: Profile) {
  return {
    goal: p.goal ?? GOAL_DEFAULTS.goal,
    level: p.level ?? GOAL_DEFAULTS.level,
    daysPerWeek: p.daysPerWeek ?? GOAL_DEFAULTS.daysPerWeek,
    equipment: p.equipment ?? GOAL_DEFAULTS.equipment,
  }
}

/** Parses a free-typed number; returns null when empty/invalid or outside [min, max]. */
export function parseBounded(text: string, min: number, max: number): number | null {
  const n = Number(text.replace(',', '.').trim())
  if (text.trim() === '' || !Number.isFinite(n) || n < min || n > max) return null
  return Math.round(n * 10) / 10
}

export function confirmWordMatches(input: string, word = 'BORRAR'): boolean {
  return input.trim().toUpperCase() === word
}

/* ---------------- CSV of every logged set ---------------- */

export const ALL_SETS_HEADER = ['fecha', 'entreno', 'ejercicio', 'serie', 'peso', 'unidad', 'reps', 'segundos', 'rpe', 'record'] as const

function cell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildAllSetsCsv(sessions: WorkoutSession[], nameOf: (exerciseId: string) => string): string {
  const rows: string[] = [ALL_SETS_HEADER.join(',')]
  const list = sessions.filter((s) => !s.deleted && s.endedAt).sort((a, b) => a.startedAt - b.startedAt)
  for (const s of list) {
    const date = toDateKey(s.startedAt)
    for (const ex of s.exercises) {
      if (ex.skipped) continue
      let n = 0
      for (const set of ex.sets) {
        if (!set.done) continue
        n++
        rows.push(
          [
            date,
            s.name,
            nameOf(ex.exerciseId),
            n,
            set.weight ?? '',
            set.weight != null ? s.unit : '',
            set.reps ?? '',
            set.seconds ?? '',
            set.rpe ?? '',
            set.isPR ? 'si' : '',
          ]
            .map(cell)
            .join(','),
        )
      }
    }
  }
  return rows.join('\n')
}
