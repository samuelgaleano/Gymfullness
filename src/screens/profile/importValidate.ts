/**
 * Validation + migration of a user-provided backup (JSON exported by this app, possibly an
 * older version or hand-edited). Pure: no store access. Tolerant to missing optional fields,
 * strict about structure, and never throws.
 */
import type { BodyLog, Exercise, Plan, Profile, Routine, Settings, UserData, WorkoutSession } from '@/lib/types'

export const CURRENT_DATA_VERSION = 1
/** Refuse absurdly large files (the app stores everything locally). */
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

export interface ImportSummary {
  sessions: number
  routines: number
  bodyLogs: number
  customExercises: number
  hasPlan: boolean
  hasProfile: boolean
}

export type ImportResult =
  | { ok: true; data: UserData; summary: ImportSummary; warnings: string[] }
  | { ok: false; error: string }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** Keeps items that pass `ok`; reports how many were dropped. */
function keep<T>(list: unknown, ok: (x: unknown) => boolean, label: string, warnings: string[]): T[] {
  if (list === undefined || list === null) return []
  if (!Array.isArray(list)) {
    warnings.push(`Se ignoró "${label}" porque no tiene el formato esperado.`)
    return []
  }
  const good = list.filter(ok) as T[]
  const dropped = list.length - good.length
  if (dropped > 0) warnings.push(`Se omitieron ${dropped} elemento${dropped === 1 ? '' : 's'} dañado${dropped === 1 ? '' : 's'} de "${label}".`)
  return good
}

const okRoutine = (x: unknown) => isObj(x) && isStr(x.id) && Array.isArray(x.items)
const okSession = (x: unknown) =>
  isObj(x) && isStr(x.id) && Array.isArray(x.exercises) && isNum(x.startedAt) && x.exercises.every((e) => isObj(e) && Array.isArray(e.sets))
const okBody = (x: unknown) => isObj(x) && isStr(x.id) && isStr(x.date)
const okExercise = (x: unknown) => isObj(x) && isStr(x.id) && isStr(x.name)

function sanitizeSettings(raw: unknown, base: Settings): Settings {
  if (!isObj(raw)) return base
  const out: Settings = { ...base }
  if (raw.unit === 'kg' || raw.unit === 'lb') out.unit = raw.unit
  if (isNum(raw.defaultRestSec)) out.defaultRestSec = Math.min(300, Math.max(15, Math.round(raw.defaultRestSec)))
  for (const k of ['autoStartRest', 'voiceAnnouncements', 'sounds', 'vibration', 'keepAwake', 'countdownBeeps'] as const) {
    if (typeof raw[k] === 'boolean') out[k] = raw[k]
  }
  if (isStr(raw.speechLang)) out.speechLang = raw.speechLang
  if (raw.theme === 'auto' || raw.theme === 'dark' || raw.theme === 'light') out.theme = raw.theme
  if (isNum(raw.updatedAt)) out.updatedAt = raw.updatedAt
  return out
}

function sanitizeProfile(raw: unknown): Profile {
  if (!isObj(raw)) return { onboarded: true, updatedAt: 0 }
  const p: Profile = { onboarded: true, updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0 }
  if (typeof raw.name === 'string') p.name = raw.name.slice(0, 60)
  if (raw.goal === 'muscle' || raw.goal === 'strength' || raw.goal === 'fat_loss' || raw.goal === 'health') p.goal = raw.goal
  if (raw.level === 'beginner' || raw.level === 'intermediate' || raw.level === 'advanced') p.level = raw.level
  if (isNum(raw.daysPerWeek)) p.daysPerWeek = Math.min(7, Math.max(1, Math.round(raw.daysPerWeek)))
  if (raw.equipment === 'gym' || raw.equipment === 'home_dumbbells' || raw.equipment === 'bodyweight') p.equipment = raw.equipment
  if (isNum(raw.heightCm)) p.heightCm = raw.heightCm
  if (isNum(raw.birthYear)) p.birthYear = raw.birthYear
  if (raw.sex === 'male' || raw.sex === 'female' || raw.sex === 'other') p.sex = raw.sex
  return p
}

function sanitizePlan(raw: unknown): Plan | null {
  if (!isObj(raw) || !Array.isArray(raw.routineIds)) return null
  const ids = raw.routineIds.filter(isStr)
  if (ids.length === 0) return null
  const goal = raw.goal === 'muscle' || raw.goal === 'strength' || raw.goal === 'fat_loss' || raw.goal === 'health' ? raw.goal : 'muscle'
  const level = raw.level === 'beginner' || raw.level === 'intermediate' || raw.level === 'advanced' ? raw.level : 'beginner'
  const equipment = raw.equipment === 'gym' || raw.equipment === 'home_dumbbells' || raw.equipment === 'bodyweight' ? raw.equipment : 'gym'
  return {
    routineIds: ids,
    daysPerWeek: isNum(raw.daysPerWeek) ? Math.min(7, Math.max(1, Math.round(raw.daysPerWeek))) : ids.length,
    goal,
    level,
    equipment,
    updatedAt: isNum(raw.updatedAt) ? raw.updatedAt : 0,
  }
}

/** Validate an already-parsed JSON value. */
export function validateImport(raw: unknown, defaults: Settings): ImportResult {
  if (!isObj(raw)) return { ok: false, error: 'El archivo no es una copia de seguridad de Gymfullness.' }

  // Version: missing → legacy v1 shape. A newer version cannot be read safely.
  const version = raw.version === undefined ? CURRENT_DATA_VERSION : raw.version
  if (!isNum(version) || version < 0) return { ok: false, error: 'La versión del archivo no es válida.' }
  if (version > CURRENT_DATA_VERSION) {
    return { ok: false, error: 'Este archivo viene de una versión más nueva de la app. Actualiza Gymfullness e inténtalo de nuevo.' }
  }

  const known = ['profile', 'settings', 'plan', 'routines', 'sessions', 'bodyLogs', 'customExercises']
  if (!known.some((k) => k in raw)) return { ok: false, error: 'No encontré datos de entrenamiento en este archivo.' }

  const warnings: string[] = []
  const routines = keep<Routine>(raw.routines, okRoutine, 'rutinas', warnings)
  const sessions = keep<WorkoutSession>(raw.sessions, okSession, 'entrenos', warnings)
  const bodyLogs = keep<BodyLog>(raw.bodyLogs, okBody, 'medidas', warnings)
  const customExercises = keep<Exercise>(raw.customExercises, okExercise, 'ejercicios propios', warnings)

  // Only completed (or tombstoned) sessions belong in history.
  const history = sessions.filter((s) => s.deleted || isNum(s.endedAt))
  if (history.length < sessions.length) warnings.push('Se omitió un entreno sin terminar.')

  const plan = sanitizePlan(raw.plan)
  // A plan that points at unknown routines would leave Home empty: drop dangling ids.
  let finalPlan = plan
  if (plan) {
    const ids = new Set(routines.map((r) => r.id))
    const routineIds = plan.routineIds.filter((id) => ids.has(id))
    finalPlan = routineIds.length > 0 ? { ...plan, routineIds } : null
    if (!finalPlan) warnings.push('El plan no incluía rutinas válidas y se omitió.')
  }

  const data: UserData = {
    version: 1,
    profile: sanitizeProfile(raw.profile),
    settings: sanitizeSettings(raw.settings, defaults),
    plan: finalPlan,
    routines,
    sessions: history,
    bodyLogs,
    customExercises,
  }
  const live = <T extends { deleted?: boolean }>(l: T[]) => l.filter((x) => !x.deleted).length
  return {
    ok: true,
    data,
    warnings,
    summary: {
      sessions: live(history),
      routines: live(routines),
      bodyLogs: live(bodyLogs),
      customExercises: customExercises.length,
      hasPlan: finalPlan !== null,
      hasProfile: isObj(raw.profile),
    },
  }
}

/** Parse + validate file text. */
export function parseImportText(text: string, defaults: Settings): ImportResult {
  const t = text.replace(/^﻿/, '').trim()
  if (!t) return { ok: false, error: 'El archivo está vacío.' }
  if (t.length > MAX_IMPORT_BYTES) return { ok: false, error: 'El archivo es demasiado grande.' }
  let json: unknown
  try {
    json = JSON.parse(t)
  } catch {
    return { ok: false, error: 'No pude leer el archivo. Elige un .json exportado desde Gymfullness.' }
  }
  return validateImport(json, defaults)
}
