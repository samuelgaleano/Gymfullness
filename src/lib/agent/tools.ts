/**
 * Tool registry of the assistant. Every tool executes IN THE BROWSER against the local store, always through
 * the existing store actions / engine (never by mutating persisted state directly).
 *
 * Contract of `executeTool`: it NEVER throws. Bad arguments come back as `{ ok: false, result: { error } }`
 * so the model can fix the call. 'destructive' tools do not run until the user confirms (pending action)
 * unless the call is an explicit local imperative or was already confirmed.
 */
import type { Exercise, LogSetInput, MuscleGroup, Routine, RoutineItem, Settings, Unit, WorkoutSession } from '../types'
import { useApp, getExercise, allExercises, selectRoutines, selectSessions, selectBodyLogs } from '@/store/app'
import { MUSCLE_LABEL, EQUIPMENT_LABEL } from '@/data/exercises'
import { getCursorInfo } from '../workout/engine'
import {
  bodySeries,
  exerciseHistory,
  muscleSets,
  personalRecords,
  streak,
  summarizeSession,
  weeklyStats,
} from '../stats'
import { clampDays, generatePlan, nextRoutineId, prescribe } from '../planner'
import { alternatives, searchExercises, normalizeText } from '../recommend'
import { formatWeight } from '../units'
import { toDateKey } from '../date'
import { uid } from '../id'
import { TOOL_DEFS, TOOL_NAMES, type ToolDef, type ToolName } from './toolDefs'
import { validateArgs } from './validate'
import type { PendingAction, ToolCall, ToolOutcome, ToolRuntime } from './types'

/* ================================================================ helpers */

const st = () => useApp.getState()

/** User-controlled text (custom exercise/routine names) goes to the model: single line, short. */
export function clean(s: unknown, max = 60): string {
  return typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f<>`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}
const nm = (ex: Exercise | undefined, fallback = 'Ejercicio') => clean(ex?.name, 60) || fallback

const fail = (error: string, summary: string, extra: Record<string, unknown> = {}): ToolOutcome => ({
  ok: false,
  result: { error, ...extra },
  summary,
})
const good = (result: unknown, summary: string, extra: Partial<ToolOutcome> = {}): ToolOutcome => ({ ok: true, result, summary, ...extra })

const noSession = (): ToolOutcome =>
  fail('No hay un entreno activo. Usa start_workout primero.', 'No hay un entreno en curso.', { code: 'no_active_workout' })

const round1 = (n: number) => Math.round(n * 10) / 10
const unitOf = (): Unit => st().settings.unit

function setLabel(weight: number | null | undefined, reps: number | null | undefined, seconds: number | null | undefined, unit: Unit): string {
  const parts: string[] = []
  const hasW = typeof weight === 'number' && weight > 0
  if (hasW && typeof reps === 'number') parts.push(`${formatWeight(weight)} ${unit} × ${reps}`)
  else if (hasW) parts.push(`${formatWeight(weight)} ${unit}`)
  else if (typeof reps === 'number' && reps > 0) parts.push(`${reps} ${reps === 1 ? 'rep' : 'reps'}`)
  if (typeof seconds === 'number' && seconds > 0) parts.push(`${seconds} s`)
  return parts.join(' · ') || 'Serie'
}

const fmtRest = (sec: number) => (sec >= 60 ? `${Math.floor(sec / 60)} min${sec % 60 ? ` ${sec % 60} s` : ''}` : `${sec} s`)

const PERIOD_DAYS: Record<string, number> = { week: 7, month: 30, '3months': 90, year: 365, all: 36500 }
const PERIOD_LABEL: Record<string, string> = {
  week: 'esta semana',
  month: 'el último mes',
  '3months': 'los últimos 3 meses',
  year: 'el último año',
  all: 'todo tu historial',
}

/* ---------------- exercise resolution (shared with the local router) ---------------- */

export type ExerciseMatch = { kind: 'one'; ex: Exercise } | { kind: 'many'; candidates: Exercise[] } | { kind: 'none' }

/** id, exact name/alias, or search. Unique/exact → one; several → candidates (best first). */
export function resolveExerciseQuery(query: string, pool: Exercise[] = allExercises()): ExerciseMatch {
  const q = query.trim()
  if (!q) return { kind: 'none' }
  const byId = getExercise(q)
  if (byId) return { kind: 'one', ex: byId }
  const nq = normalizeText(q)
  const exact = pool.filter((e) => normalizeText(e.name) === nq || e.aliases.some((a) => normalizeText(a) === nq))
  if (exact.length === 1) return { kind: 'one', ex: exact[0] }
  const hits = searchExercises(q, pool)
  if (hits.length === 0) return { kind: 'none' }
  if (hits.length === 1) return { kind: 'one', ex: hits[0] }
  return { kind: 'many', candidates: hits.slice(0, 5) }
}

/** Lenient lookup for read tools: id, then name. */
function findExercise(idOrName: string): Exercise | undefined {
  const r = resolveExerciseQuery(idOrName)
  return r.kind === 'one' ? r.ex : r.kind === 'many' ? r.candidates[0] : undefined
}

const brief = (e: Exercise) => ({ id: e.id, name: nm(e), muscle: MUSCLE_LABEL[e.primary] ?? e.primary })

/* ================================================================ snapshots */

function sessionSnapshot(s: WorkoutSession) {
  const info = getCursorInfo(s)
  const unit = s.unit
  const cur = info.exercise
  const ex = cur ? getExercise(cur.exerciseId) : undefined
  const set = cur?.sets[info.setIndex]
  const nextEx = info.next?.exercise
  const rest = s.rest
  const leftMs = rest ? rest.endsAt - Date.now() : 0
  return {
    name: clean(s.name),
    unit,
    elapsed_min: Math.max(0, Math.round((Date.now() - s.startedAt) / 60000)),
    progress_pct: Math.round(info.progress * 100),
    done_sets: info.doneSets,
    total_sets: info.totalSessionSets,
    finished: info.isFinished,
    current: cur
      ? {
          index: info.exIndex,
          exercise_id: cur.exerciseId,
          name: nm(ex),
          set_number: info.setNumber,
          total_sets: info.totalSets,
          target: {
            reps: cur.target.targetSeconds ? `${cur.target.targetSeconds} s` : `${cur.target.repsMin}-${cur.target.repsMax}`,
            rest_sec: cur.target.restSec,
            weight: cur.target.weight ?? null,
          },
          prefill: { weight: set?.weight ?? null, reps: set?.reps ?? null },
        }
      : null,
    next: info.next ? { name: nm(getExercise(nextEx!.exerciseId)), set_number: info.next.setIndex + 1 } : null,
    rest_left_sec: rest && leftMs > 0 ? Math.ceil(leftMs / 1000) : null,
    exercises: s.exercises.slice(0, 20).map((e, i) => ({
      i,
      name: nm(getExercise(e.exerciseId)),
      done: e.sets.filter((x) => x.done).length,
      total: e.sets.length,
      ...(e.skipped ? { skipped: true } : {}),
    })),
  }
}

/** Compact snapshot used by get_context and by the <contexto> block sent with each AI turn. */
export function contextSnapshot(opts: { route?: string; full?: boolean } = {}) {
  const s = st()
  const routines = selectRoutines(s)
  const nextId = nextRoutineId(s.plan, selectSessions(s), s.routines)
  const out: Record<string, unknown> = {
    ...(opts.route ? { screen: opts.route } : {}),
    unit: s.settings.unit,
    profile: { goal: s.profile.goal ?? s.plan?.goal ?? null, level: s.profile.level ?? s.plan?.level ?? null, equipment: s.profile.equipment ?? s.plan?.equipment ?? null },
    workout: s.activeSession ? sessionSnapshot(s.activeSession) : null,
    next_routine: nextId ? clean(routines.find((r) => r.id === nextId)?.name) : null,
  }
  if (opts.full !== false) {
    const t: Settings = s.settings
    out.settings = { unit: t.unit, defaultRestSec: t.defaultRestSec, autoStartRest: t.autoStartRest, sounds: t.sounds, vibration: t.vibration, voiceAnnouncements: t.voiceAnnouncements }
    out.plan = s.plan
      ? { days_per_week: s.plan.daysPerWeek, next_routine_id: nextId, routine_ids: s.plan.routineIds.slice(0, 8) }
      : null
    out.routines = routines.slice(0, 10).map((r) => ({ id: r.id, name: clean(r.name), exercises: r.items.length }))
    out.sessions_done = selectSessions(s).length
  }
  return out
}

/* ================================================================ implementations */

interface ToolImpl {
  execute: (args: Record<string, unknown>, rt: ToolRuntime) => ToolOutcome
  /** For destructive tools: the confirmation question, or an error outcome when the action cannot apply. */
  confirm?: (args: Record<string, unknown>) => string | ToolOutcome
}

const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined)
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

const IMPLS: Record<ToolName, ToolImpl> = {
  get_context: {
    execute: () => good(contextSnapshot(), 'Contexto leído.'),
  },

  get_next_workout: {
    execute: () => {
      const s = st()
      const id = nextRoutineId(s.plan, selectSessions(s), s.routines)
      const routine = id ? selectRoutines(s).find((r) => r.id === id) : undefined
      if (!routine) {
        return good(
          { routine: null, hint: 'No hay plan. El usuario puede crear una rutina o empezar un entreno libre.' },
          'Aún no tienes un plan. Puedes crear una rutina o empezar un entreno libre.',
        )
      }
      const items = routine.items.map((it) => ({
        exercise_id: it.exerciseId,
        name: nm(getExercise(it.exerciseId)),
        sets: it.sets,
        reps: it.targetSeconds ? `${it.targetSeconds} s` : `${it.repsMin}-${it.repsMax}`,
      }))
      return good(
        { routine: { id: routine.id, name: clean(routine.name), focus: clean(routine.focus, 80), exercises: items } },
        `Hoy te toca «${clean(routine.name)}»: ${items.length} ejercicios (${items.slice(0, 3).map((i) => i.name).join(', ')}${items.length > 3 ? '…' : ''}).`,
      )
    },
  },

  start_workout: {
    execute: (a, rt) => {
      const s = st()
      if (s.activeSession) return fail('Ya hay un entreno activo.', 'Ya tienes un entreno en curso.', { code: 'workout_active' })
      let routineId: string | null = null
      if (text(a.routine_id)) {
        const r = selectRoutines(s).find((x) => x.id === a.routine_id)
        if (!r) return fail(`routine_id desconocido: ${clean(a.routine_id, 40)}. Usa get_context para ver los ids.`, 'No encontré esa rutina.')
        routineId = r.id
      } else if (a.free !== true) {
        routineId = nextRoutineId(s.plan, selectSessions(s), s.routines)
      }
      const session = s.startWorkout(routineId)
      rt.navigate?.('/workout')
      const n = session.exercises.length
      return good(
        { started: true, name: clean(session.name), exercises: n },
        routineId ? `Entreno «${clean(session.name)}» iniciado (${n} ejercicios).` : 'Entreno libre iniciado.',
      )
    },
  },

  log_set: {
    execute: (a, rt) => {
      const s = st().activeSession
      if (!s) return noSession()
      const before = getCursorInfo(s)
      if (!before.exercise) return fail('El entreno no tiene ejercicios. Usa add_exercise.', 'Añade un ejercicio primero.')
      const input: LogSetInput = { source: rt.source ?? (rt.origin === 'local' ? 'text' : 'auto') }
      if (num(a.weight) !== undefined) input.weight = a.weight as number
      if (num(a.reps) !== undefined) input.reps = a.reps as number
      if (num(a.seconds) !== undefined) input.seconds = a.seconds as number
      if (num(a.rpe) !== undefined) input.rpe = a.rpe as number
      const res = st().logSet(input)
      if (!res) return noSession()
      const exIdx = before.exIndex
      const sets = res.session.exercises[exIdx]?.sets ?? []
      let idx = before.setIndex
      sets.forEach((x, i) => {
        if (x.done && (x.completedAt ?? 0) >= (sets[idx]?.completedAt ?? 0)) idx = i
      })
      const logged = sets[idx]
      const autoRest = st().settings.autoStartRest
      if (!res.workoutCompleted && autoRest && res.restSec > 0) st().startRest(res.restSec)
      const after = st().activeSession
      const nextInfo = after ? getCursorInfo(after) : null
      const nextSet = nextInfo?.exercise?.sets[nextInfo.setIndex]
      const exName = nm(getExercise(s.exercises[exIdx].exerciseId))
      const label = setLabel(logged?.weight, logged?.reps, logged?.seconds, s.unit)
      const result = {
        logged: { exercise: exName, set_number: idx + 1, of: sets.length, weight: logged?.weight ?? null, reps: logged?.reps ?? null, seconds: logged?.seconds ?? null },
        is_pr: res.isPR,
        exercise_done: res.exerciseCompleted,
        workout_done: res.workoutCompleted,
        rest_sec: !res.workoutCompleted && autoRest ? res.restSec : 0,
        next:
          nextInfo?.exercise && !nextInfo.isFinished
            ? { exercise: nm(getExercise(nextInfo.exercise.exerciseId)), set_number: nextInfo.setNumber, weight: nextSet?.weight ?? null, reps: nextSet?.reps ?? null }
            : null,
      }
      const summary = `Serie ${idx + 1} · ${label}${res.isPR ? ' · ¡Récord!' : ''}${res.workoutCompleted ? ' · Entreno completo' : ''}`
      return good(result, summary, { undo: { name: 'undo_last_set', args: {} } })
    },
  },

  undo_last_set: {
    execute: () => {
      const s = st().activeSession
      if (!s) return noSession()
      if (!s.exercises.some((e) => e.sets.some((x) => x.done))) return fail('No hay series registradas para deshacer.', 'No hay series que deshacer.')
      st().undoLastSet()
      return good({ undone: true }, 'Serie deshecha.')
    },
  },

  skip_exercise: {
    execute: (a) => {
      const s = st().activeSession
      if (!s) return noSession()
      const idx = num(a.exercise_index) ?? getCursorInfo(s).exIndex
      const se = s.exercises[idx]
      if (!se) return fail(`exercise_index fuera de rango (0-${s.exercises.length - 1}).`, 'Ese ejercicio no existe en el entreno.')
      st().skipExercise(idx)
      const name = nm(getExercise(se.exerciseId))
      return good({ skipped: name, index: idx }, `Saltado: ${name}.`)
    },
  },

  swap_exercise: {
    execute: (a) => {
      const s = st().activeSession
      if (!s) return noSession()
      const idx = num(a.exercise_index) ?? getCursorInfo(s).exIndex
      const se = s.exercises[idx]
      if (!se) return fail(`exercise_index fuera de rango (0-${s.exercises.length - 1}).`, 'Ese ejercicio no existe en el entreno.')
      const inSession = new Set(s.exercises.map((e) => e.exerciseId))
      const pool = alternatives(se.exerciseId, allExercises(), st().profile.equipment ?? st().plan?.equipment, 8).filter((e) => !inSession.has(e.id))
      let target: Exercise | undefined
      if (text(a.to_exercise_id)) {
        target = getExercise(a.to_exercise_id as string)
        if (!target) {
          const m = resolveExerciseQuery(a.to_exercise_id as string)
          if (m.kind === 'one') target = m.ex
          else return fail(`to_exercise_id desconocido. Usa search_exercises para obtener un id válido.`, 'No encontré ese ejercicio.', { candidates: m.kind === 'many' ? m.candidates.map(brief) : [] })
        }
      } else {
        target = pool[0]
        if (!target) return fail('No hay alternativas disponibles con tu equipo.', 'No encontré una alternativa.')
      }
      if (target.id === se.exerciseId) return fail('Ese ya es el ejercicio actual.', 'Ya estás haciendo ese ejercicio.')
      const from = nm(getExercise(se.exerciseId))
      st().swapExercise(idx, target.id)
      return good(
        { from, to: { id: target.id, name: nm(target) }, other_options: pool.filter((e) => e.id !== target!.id).slice(0, 3).map(brief) },
        `Cambiado: ${from} → ${nm(target)}.`,
      )
    },
  },

  add_exercise: {
    execute: (a) => {
      const s = st().activeSession
      if (!s) return noSession()
      const m = resolveExerciseQuery(a.query as string)
      if (m.kind === 'none') return fail(`No encontré «${clean(a.query, 40)}». Prueba search_exercises.`, `No encontré «${clean(a.query, 40)}» en la biblioteca.`)
      if (m.kind === 'many') {
        return fail('Hay varios ejercicios posibles; pregunta al usuario cuál o usa el id exacto.', `¿Cuál? ${m.candidates.map((c) => nm(c)).join(' · ')}`, {
          code: 'ambiguous',
          candidates: m.candidates.map(brief),
        })
      }
      st().addExercise(m.ex.id)
      const after = st().activeSession
      if (after && getCursorInfo(s).isFinished) st().setCursor(after.exercises.length - 1)
      return good({ added: brief(m.ex) }, `${nm(m.ex)} añadido al entreno.`)
    },
  },

  start_rest: {
    execute: (a) => {
      const s = st().activeSession
      if (!s) return noSession()
      const cur = getCursorInfo(s).exercise
      const sec = Math.round(num(a.seconds) ?? cur?.target.restSec ?? st().settings.defaultRestSec)
      st().startRest(sec)
      return good({ rest_sec: sec }, `Descanso de ${fmtRest(sec)} iniciado.`)
    },
  },

  skip_rest: {
    execute: () => {
      const s = st().activeSession
      if (!s) return noSession()
      if (!s.rest) return good({ rest: false }, 'No había un descanso en curso.')
      st().endRest()
      return good({ rest: false }, 'Descanso omitido.')
    },
  },

  adjust_rest: {
    execute: (a) => {
      const s = st().activeSession
      if (!s) return noSession()
      if (!s.rest) return fail('No hay un descanso en curso. Usa start_rest.', 'No hay un descanso en curso.')
      const d = a.delta_seconds as number
      st().adjustRest(d)
      const left = Math.max(0, Math.ceil(((st().activeSession?.rest?.endsAt ?? Date.now()) - Date.now()) / 1000))
      return good({ rest_left_sec: left }, `${d > 0 ? '+' : '−'}${Math.abs(d)} s de descanso (quedan ${fmtRest(left)}).`)
    },
  },

  finish_workout: {
    confirm: () => {
      const s = st().activeSession
      if (!s) return noSession()
      const info = getCursorInfo(s)
      const remaining = Math.max(0, info.totalSessionSets - info.doneSets)
      return remaining > 0
        ? `¿Terminar el entreno? Te quedan ${remaining} ${remaining === 1 ? 'serie' : 'series'} sin hacer.`
        : '¿Terminar y guardar el entreno?'
    },
    execute: (_a, rt) => {
      if (!st().activeSession) return noSession()
      const done = st().finishWorkout()
      if (!done) {
        rt.navigate?.('/')
        return good({ saved: false }, 'No había series que guardar.')
      }
      const sum = summarizeSession(done, getExercise)
      rt.navigate?.(`/summary/${done.id}`)
      return good(
        { saved: true, session_id: done.id, sets: sum.totalSets, volume: Math.round(sum.volume), unit: sum.unit, minutes: Math.round(sum.durationSec / 60), prs: sum.prs.length },
        `Entreno guardado: ${sum.totalSets} series${sum.prs.length ? `, ${sum.prs.length} ${sum.prs.length === 1 ? 'récord' : 'récords'}` : ''}.`,
      )
    },
  },

  search_exercises: {
    execute: (a) => {
      const limit = num(a.limit) ?? 6
      let hits = searchExercises(a.query as string, allExercises())
      if (text(a.muscle)) hits = hits.filter((e) => e.primary === a.muscle || e.secondary.includes(a.muscle as MuscleGroup))
      const list = hits.slice(0, limit).map((e) => ({ ...brief(e), equipment: e.equipment.slice(0, 2).map((q) => EQUIPMENT_LABEL[q] ?? q), kind: e.kind }))
      return good({ results: list, total: hits.length }, list.length ? `${hits.length} resultados: ${list.slice(0, 3).map((e) => e.name).join(', ')}…` : 'Sin resultados.')
    },
  },

  get_exercise_info: {
    execute: (a) => {
      const ex = findExercise(a.exercise_id as string)
      if (!ex) return fail('Ejercicio no encontrado. Usa search_exercises.', 'No encontré ese ejercicio.')
      const alts = alternatives(ex.id, allExercises(), st().profile.equipment ?? st().plan?.equipment, 3).map((e) => nm(e))
      const t = (l: string[], n: number) => l.slice(0, n).map((x) => clean(x, 160))
      return good(
        {
          id: ex.id,
          name: nm(ex),
          primary: MUSCLE_LABEL[ex.primary],
          secondary: ex.secondary.map((m) => MUSCLE_LABEL[m]),
          equipment: ex.equipment.map((e) => EQUIPMENT_LABEL[e]),
          kind: ex.kind,
          level: ex.level,
          rest_sec: ex.defaultRestSec,
          setup: t(ex.setup, 3),
          cues: t(ex.cues, 5),
          mistakes: t(ex.mistakes, 4),
          breathing: clean(ex.breathing, 200),
          alternatives: alts,
        },
        `Técnica de ${nm(ex)} lista.`,
      )
    },
  },

  get_progress: {
    execute: (a) => {
      const s = st()
      const sessions = selectSessions(s)
      const unit = unitOf()
      const period = text(a.period) ?? 'month'
      const days = PERIOD_DAYS[period] ?? 30
      const since = Date.now() - days * 86_400_000

      if (text(a.exercise_id)) {
        const ex = findExercise(a.exercise_id as string)
        if (!ex) return fail('Ejercicio no encontrado. Usa search_exercises.', 'No encontré ese ejercicio.')
        const all = exerciseHistory(sessions, ex.id, unit)
        if (!all.length) return good({ exercise: nm(ex), sessions: 0 }, `Aún no tienes registros de ${nm(ex)}.`)
        const pts = all.filter((p) => p.date >= since)
        const shown = (pts.length ? pts : all.slice(-1)).slice(-8)
        const first = shown[0]?.bestE1rm
        const last = shown[shown.length - 1]?.bestE1rm
        const change = first && last && shown.length > 1 ? Math.round(((last - first) / first) * 100) : null
        const pr = personalRecords(sessions, unit).find((r) => r.exerciseId === ex.id)
        const result = {
          exercise: nm(ex),
          unit,
          period,
          sessions_total: all.length,
          trend: shown.map((p) => ({ date: toDateKey(p.date), best_weight: p.bestWeight, best_reps: p.bestReps, e1rm: p.bestE1rm, volume: p.volume })),
          e1rm_change_pct: change,
          pr: pr ? { e1rm: pr.bestE1rm, weight: pr.bestWeight, reps: pr.bestReps, date: toDateKey(pr.date) } : null,
        }
        const bits = [`${nm(ex)}: ${all.length} ${all.length === 1 ? 'sesión' : 'sesiones'}`]
        if (last) bits.push(`e1RM ${formatWeight(last)} ${unit}${change !== null ? ` (${change >= 0 ? '+' : ''}${change} % en ${PERIOD_LABEL[period]})` : ''}`)
        if (pr?.bestWeight) bits.push(`mejor carga ${formatWeight(pr.bestWeight)} ${unit}`)
        return good(result, `${bits.join(' · ')}.`)
      }

      if (text(a.muscle)) {
        const m = a.muscle as MuscleGroup
        const acc = muscleSets(sessions, getExercise, days)
        const v = Math.round((acc[m] ?? 0) * 10) / 10
        return good({ muscle: m, sets: v, period, per_week: round1((v / days) * 7) }, `${MUSCLE_LABEL[m]}: ${v} series en ${PERIOD_LABEL[period]}.`)
      }

      const str = streak(sessions)
      const weeks = weeklyStats(sessions, 4, unit)
      const prs = personalRecords(sessions, unit).slice(0, 3).map((r) => ({ exercise: nm(getExercise(r.exerciseId), r.exerciseId), e1rm: r.bestE1rm, weight: r.bestWeight, date: toDateKey(r.date) }))
      const body = bodySeries(selectBodyLogs(s), 'weight', unit)
      const bodyTrend = body.length ? { first: body[0].value, last: body[body.length - 1].value, unit } : null
      return good(
        {
          sessions_total: str.total,
          streak_weeks: str.weeks,
          sessions_this_week: str.thisWeek,
          last_weeks: weeks.map((w) => ({ week: w.weekStart, sessions: w.sessions, sets: w.sets, volume: w.volume })),
          recent_prs: prs,
          body_weight: bodyTrend,
        },
        str.total
          ? `${str.total} entrenos en total, racha de ${str.weeks} ${str.weeks === 1 ? 'semana' : 'semanas'}, ${str.thisWeek} esta semana.`
          : 'Aún no tienes entrenos guardados.',
      )
    },
  },

  log_body_metrics: {
    execute: (a) => {
      const keys = { weight: 'weight', body_fat: 'bodyFat', waist: 'waist', chest: 'chest', arm: 'arm', thigh: 'thigh', hips: 'hips', neck: 'neck' } as const
      const unit = unitOf()
      const patch: Record<string, number> = {}
      for (const [arg, field] of Object.entries(keys)) if (num(a[arg]) !== undefined) patch[field] = a[arg] as number
      if (!Object.keys(patch).length) return fail('Indica al menos una medida (weight, body_fat, waist…).', 'Dime qué medida quieres guardar.')
      const limits: Record<string, [number, number, string]> = {
        weight: unit === 'kg' ? [20, 400, `peso entre 20 y 400 ${unit}`] : [45, 880, `peso entre 45 y 880 ${unit}`],
        bodyFat: [2, 70, 'grasa corporal entre 2 y 70 %'],
        waist: [30, 250, 'cintura entre 30 y 250 cm'],
        chest: [40, 250, 'pecho entre 40 y 250 cm'],
        arm: [10, 100, 'brazo entre 10 y 100 cm'],
        thigh: [20, 150, 'muslo entre 20 y 150 cm'],
        hips: [40, 250, 'cadera entre 40 y 250 cm'],
        neck: [20, 80, 'cuello entre 20 y 80 cm'],
      }
      for (const [k, v] of Object.entries(patch)) {
        const [lo, hi, label] = limits[k]
        if (v < lo || v > hi) return fail(`Valor implausible para ${k}: ${v}. Esperado ${label}. Pregunta al usuario.`, `Ese valor no parece correcto (${label}).`)
      }
      const date = text(a.date) && /^\d{4}-\d{2}-\d{2}$/.test(a.date as string) ? (a.date as string) : toDateKey()
      const existing = selectBodyLogs(st()).find((b) => b.date === date)
      // keep the unit of an existing weight when we are not rewriting it
      const logUnit: Unit = existing?.weight != null && patch.weight === undefined ? existing.unit : unit
      st().upsertBodyLog({ date, unit: logUnit, ...patch })
      const names: Record<string, string> = { weight: 'Peso', bodyFat: 'Grasa', waist: 'Cintura', chest: 'Pecho', arm: 'Brazo', thigh: 'Muslo', hips: 'Cadera', neck: 'Cuello' }
      const bits = Object.entries(patch).map(([k, v]) => `${names[k]} ${formatWeight(v)}${k === 'weight' ? ` ${unit}` : k === 'bodyFat' ? ' %' : ' cm'}`)
      return good({ saved: patch, date }, `Guardado: ${bits.join(' · ')}.`)
    },
  },

  create_routine: {
    confirm: (a) => {
      const bad = badExerciseIds(a.exercises as { exercise_id: string }[])
      if (bad.length) return fail(`Ids de ejercicio inválidos: ${bad.join(', ')}. Usa search_exercises para obtener ids.`, 'Algunos ejercicios no existen en la biblioteca.', { invalid: bad })
      return `¿Crear la rutina «${clean(a.name)}» con ${(a.exercises as unknown[]).length} ejercicios?`
    },
    execute: (a) => {
      const list = a.exercises as { exercise_id: string; sets?: number; reps_min?: number; reps_max?: number; rest_sec?: number }[]
      const bad = badExerciseIds(list)
      if (bad.length) return fail(`Ids de ejercicio inválidos: ${bad.join(', ')}.`, 'Algunos ejercicios no existen en la biblioteca.', { invalid: bad })
      const s = st()
      const goal = s.plan?.goal ?? s.profile.goal ?? 'muscle'
      const level = s.plan?.level ?? s.profile.level ?? 'intermediate'
      const items: RoutineItem[] = list.map((row) => {
        const ex = getExercise(row.exercise_id)!
        const t = prescribe(ex, goal, level)
        const item: RoutineItem = {
          id: uid('ri_'),
          exerciseId: ex.id,
          sets: row.sets ?? t.sets,
          repsMin: row.reps_min ?? t.repsMin,
          repsMax: row.reps_max ?? t.repsMax,
          restSec: row.rest_sec ?? t.restSec,
        }
        if (item.repsMax < item.repsMin) item.repsMax = item.repsMin
        if (t.targetSeconds !== undefined) item.targetSeconds = t.targetSeconds
        return item
      })
      // never overwrite: a taken name gets a numeric suffix
      const taken = new Set(selectRoutines(s).map((r) => normalizeText(r.name)))
      const base = clean(a.name) || 'Mi rutina'
      let name = base
      for (let n = 2; taken.has(normalizeText(name)); n++) name = `${base} (${n})`
      const now = Date.now()
      const routine: Routine = { id: uid('r_'), name, items, createdAt: now, updatedAt: now }
      const focus = clean(a.focus, 80)
      if (focus) routine.focus = focus
      s.upsertRoutine(routine)
      let inPlan = false
      const plan = st().plan
      if (a.add_to_plan === true && plan) {
        st().setPlan({ ...plan, routineIds: [...plan.routineIds, routine.id] })
        inPlan = true
      }
      return good({ routine_id: routine.id, name, exercises: items.length, added_to_plan: inPlan }, `Rutina «${name}» creada con ${items.length} ejercicios${inPlan ? ' y añadida a tu plan' : ''}.`)
    },
  },

  modify_plan_days: {
    confirm: (a) => `¿Cambiar tu plan a ${clampDays(a.days as number)} días por semana? Se generarán rutinas nuevas; las actuales se conservan.`,
    execute: (a) => {
      const s = st()
      const days = clampDays(a.days as number)
      const { plan, routines } = generatePlan({
        goal: s.plan?.goal ?? s.profile.goal ?? 'muscle',
        level: s.plan?.level ?? s.profile.level ?? 'beginner',
        daysPerWeek: days,
        equipment: s.plan?.equipment ?? s.profile.equipment ?? 'gym',
      })
      s.setPlan(plan, routines)
      st().updateProfile({ daysPerWeek: days })
      return good({ days, routines: routines.map((r) => ({ id: r.id, name: clean(r.name) })) }, `Plan actualizado a ${days} días por semana (${routines.length} rutinas).`)
    },
  },

  set_setting: {
    confirm: (a) => {
      const p = parseSetting(a.key as string, a.value as string)
      return 'error' in p ? fail(p.error, p.error) : `¿Cambiar ${p.label} a ${p.display}?`
    },
    execute: (a) => {
      const p = parseSetting(a.key as string, a.value as string)
      if ('error' in p) return fail(p.error, p.error)
      st().updateSettings({ [p.key]: p.value } as Partial<Settings>)
      return good({ key: p.key, value: p.value }, `Listo: ${p.label} ${p.display}.`)
    },
  },

  navigate: {
    execute: (a, rt) => {
      let route = a.route as string
      const label: Record<string, string> = { '/': 'Hoy', '/routines': 'Rutinas', '/exercises': 'Ejercicios', '/workout': 'tu entreno', '/progress': 'Progreso', '/profile': 'Perfil' }
      if (route === '/workout' && !st().activeSession) return fail('No hay un entreno activo para abrir.', 'No hay un entreno en curso.')
      let text2 = label[route]
      if (route === '/exercises' && typeof a.exercise_id === 'string') {
        const ex = findExercise(a.exercise_id)
        if (!ex) return fail('exercise_id desconocido.', 'No encontré ese ejercicio.')
        route = `/exercises/${ex.id}`
        text2 = nm(ex)
      }
      if (!rt.navigate) return fail('Navegación no disponible aquí.', 'No puedo abrir pantallas desde aquí.')
      rt.navigate(route)
      return good({ route }, `Abriendo ${text2}.`)
    },
  },
}

function badExerciseIds(list: { exercise_id: string }[]): string[] {
  return list.filter((r) => !getExercise(r.exercise_id)).map((r) => clean(r.exercise_id, 40))
}

type ParsedSetting = { key: keyof Settings; value: Settings[keyof Settings]; label: string; display: string } | { error: string }
function parseSetting(key: string, raw: string): ParsedSetting {
  const bool = (label: string): ParsedSetting => {
    const v = raw.toLowerCase()
    if (['true', 'si', 'sí', 'on', '1'].includes(v)) return { key: key as keyof Settings, value: true, label, display: 'activado' }
    if (['false', 'no', 'off', '0'].includes(v)) return { key: key as keyof Settings, value: false, label, display: 'desactivado' }
    return { error: `value de ${key} debe ser true o false` }
  }
  switch (key) {
    case 'unit':
      return raw === 'kg' || raw === 'lb' ? { key, value: raw, label: 'la unidad', display: raw === 'kg' ? 'kilos' : 'libras' } : { error: 'unit debe ser kg o lb' }
    case 'defaultRestSec': {
      const n = Number(raw.replace(',', '.'))
      if (!Number.isFinite(n)) return { error: 'defaultRestSec debe ser un número de segundos' }
      const v = Math.min(600, Math.max(10, Math.round(n)))
      return { key, value: v, label: 'el descanso por defecto', display: fmtRest(v) }
    }
    case 'autoStartRest':
      return bool('el inicio automático del descanso')
    case 'sounds':
      return bool('los sonidos')
    case 'vibration':
      return bool('la vibración')
    case 'voiceAnnouncements':
      return bool('los avisos por voz')
    default:
      return { error: `ajuste no permitido: ${clean(key, 30)}` }
  }
}

/* ================================================================ registry */

export interface Tool extends ToolDef {
  execute: (args: Record<string, unknown>, rt: ToolRuntime) => ToolOutcome
  confirm?: ToolImpl['confirm']
}

export const TOOLS: readonly Tool[] = TOOL_DEFS.map((d) => ({ ...d, ...IMPLS[d.name] }))
const TOOL_BY_NAME = new Map<string, Tool>(TOOLS.map((t) => [t.name, t]))
export const getTool = (name: string): Tool | undefined => TOOL_BY_NAME.get(name)

/* ---------------- pending confirmations ---------------- */

const PENDING_TTL_MS = 3 * 60_000
const pending = new Map<string, PendingAction>()

export function listPending(): PendingAction[] {
  const now = Date.now()
  for (const [id, p] of pending) if (now - p.createdAt > PENDING_TTL_MS) pending.delete(id)
  return [...pending.values()]
}

/** The user said "sí": run the tool for real. Never throws. */
export function confirmPending(id: string, rt: ToolRuntime = {}): ToolOutcome {
  const p = listPending().find((x) => x.id === id)
  if (!p) return fail('La confirmación venció o no existe.', 'Esa confirmación ya no está disponible.', { code: 'expired' })
  pending.delete(id)
  if (p.sessionId && st().activeSession?.id !== p.sessionId && (p.tool === 'finish_workout')) {
    return fail('Esa confirmación era de otro entreno.', 'Esa confirmación ya no aplica.', { code: 'expired' })
  }
  return executeTool({ id: p.id, name: p.tool, args: p.args }, { ...rt, confirmed: true })
}

/** The user said "no". */
export function cancelPending(id: string): ToolOutcome {
  const had = pending.delete(id)
  return good({ cancelled: had }, had ? 'Cancelado.' : 'Nada que cancelar.')
}

export function clearPending(): void {
  pending.clear()
}

/* ---------------- execution ---------------- */

/** Validate → gate by risk → execute. Never throws. */
export function executeTool(call: ToolCall, rt: ToolRuntime = {}): ToolOutcome {
  try {
    const tool = TOOL_BY_NAME.get(call.name)
    if (!tool) {
      return fail(`Herramienta desconocida: ${clean(call.name, 40)}`, 'No conozco esa acción.', { available: [...TOOL_NAMES] })
    }
    const v = validateArgs(tool.parameters, call.args)
    if (!v.ok) return fail(`Argumentos inválidos: ${v.error}`, `Faltan datos: ${v.error}.`, { code: 'invalid_args' })

    if (tool.risk === 'destructive' && !(rt.confirmed || call.explicit)) {
      const asked = tool.confirm ? tool.confirm(v.value) : `¿Confirmas ${tool.name}?`
      if (typeof asked !== 'string') return asked
      // own id (never the model's: providers may reuse ids like "call_1" across requests); same request replaces the older one
      const action: PendingAction = { id: uid('p_'), tool: tool.name, args: v.value, prompt: asked, createdAt: Date.now(), sessionId: st().activeSession?.id }
      for (const [k, p] of pending) if (p.tool === action.tool && JSON.stringify(p.args) === JSON.stringify(action.args)) pending.delete(k)
      pending.set(action.id, action)
      return {
        ok: true,
        result: { status: 'needs_user_confirmation', message: 'No se ha hecho nada todavía. Espera la respuesta del usuario.' },
        summary: asked,
        pending: action,
      }
    }

    const out = tool.execute(v.value, rt)
    if (v.notes.length && out.result && typeof out.result === 'object' && !Array.isArray(out.result)) {
      return { ...out, result: { ...(out.result as object), notes: v.notes } }
    }
    return out
  } catch {
    return fail('Error interno al ejecutar la herramienta.', 'Algo salió mal con esa acción.', { code: 'internal' })
  }
}
