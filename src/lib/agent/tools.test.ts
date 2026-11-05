import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useApp, selectRoutines, selectSessions, selectBodyLogs } from '@/store/app'
import { resetStore, seedPlan, startPlanWorkout, tool } from './testkit'
import { cancelPending, confirmPending, executeTool, listPending, resolveExerciseQuery } from './tools'

const st = () => useApp.getState()
const R = (o: { result: unknown }) => o.result as Record<string, any>

beforeEach(() => {
  resetStore()
  vi.useRealTimers()
})

describe('unknown tools and bad args never throw', () => {
  it('unknown tool', () => {
    const o = tool('rm_rf')
    expect(o.ok).toBe(false)
    expect(R(o).available).toContain('log_set')
  })
  it('invalid args come back as errors for the model', () => {
    const o = tool('add_exercise', {})
    expect(o).toMatchObject({ ok: false })
    expect(R(o).error).toContain('query')
  })
})

describe('read tools', () => {
  it('get_context with no data', () => {
    const o = tool('get_context')
    expect(o.ok).toBe(true)
    expect(R(o).workout).toBeNull()
    expect(R(o).settings.unit).toBe('kg')
  })

  it('get_context with an active workout is compact', () => {
    startPlanWorkout()
    const r = R(tool('get_context'))
    expect(r.workout.current.name).toBeTruthy()
    expect(r.workout.current.set_number).toBe(1)
    expect(r.workout.total_sets).toBeGreaterThan(3)
    expect(r.plan.days_per_week).toBe(3)
    expect(JSON.stringify(r).length).toBeLessThan(4000)
  })

  it('get_next_workout', () => {
    expect(R(tool('get_next_workout')).routine).toBeNull()
    const { routines } = seedPlan()
    const o = tool('get_next_workout')
    expect(R(o).routine.id).toBe(routines[0].id)
    expect(o.summary).toContain('Hoy te toca')
  })

  it('search_exercises + muscle filter + limit', () => {
    const r = R(tool('search_exercises', { query: 'press', limit: 3 }))
    expect(r.results).toHaveLength(3)
    const chest = R(tool('search_exercises', { query: 'press', muscle: 'chest' }))
    expect(chest.results.length).toBeGreaterThan(0)
    expect(tool('search_exercises', { query: 'zzzzqq' }).summary).toBe('Sin resultados.')
  })

  it('get_exercise_info by id and by name; unknown fails', () => {
    const r = R(tool('get_exercise_info', { exercise_id: 'bench-press' }))
    expect(r.name).toBe('Press de banca')
    expect(r.cues.length).toBeGreaterThan(0)
    expect(R(tool('get_exercise_info', { exercise_id: 'Dominadas' })).id).toBe('pull-up')
    expect(tool('get_exercise_info', { exercise_id: 'nope-nope' }).ok).toBe(false)
  })

  it('resolveExerciseQuery: id, exact, many, none', () => {
    expect(resolveExerciseQuery('bench-press')).toMatchObject({ kind: 'one' })
    expect(resolveExerciseQuery('plancha')).toMatchObject({ kind: 'one', ex: { id: 'plank' } })
    expect(resolveExerciseQuery('sentadilla')).toMatchObject({ kind: 'one', ex: { id: 'back-squat' } }) // exact alias
    expect(resolveExerciseQuery('curl').kind).toBe('many')
    expect(resolveExerciseQuery('qqqzzz').kind).toBe('none')
  })
})

describe('workout tools', () => {
  it('everything needs an active workout', () => {
    for (const n of ['log_set', 'undo_last_set', 'skip_exercise', 'swap_exercise', 'start_rest', 'skip_rest']) {
      const o = tool(n, n === 'add_exercise' ? { query: 'x' } : {})
      expect(o.ok, n).toBe(false)
      expect(R(o).code).toBe('no_active_workout')
    }
    expect(tool('add_exercise', { query: 'plancha' }).ok).toBe(false)
    expect(tool('adjust_rest', { delta_seconds: 15 }).ok).toBe(false)
  })

  it('start_workout: next routine, navigates, refuses a second one', () => {
    const { routines } = seedPlan()
    const navigate = vi.fn()
    const o = tool('start_workout', {}, { navigate })
    expect(o.ok).toBe(true)
    expect(st().activeSession?.routineId).toBe(routines[0].id)
    expect(navigate).toHaveBeenCalledWith('/workout')
    const again = tool('start_workout', {})
    expect(again.ok).toBe(false)
    expect(R(again).code).toBe('workout_active')
  })

  it('start_workout: free, explicit routine, bad routine', () => {
    seedPlan()
    expect(tool('start_workout', { routine_id: 'nope' }).ok).toBe(false)
    expect(st().activeSession).toBeNull()
    expect(tool('start_workout', { free: true }).summary).toContain('libre')
    expect(st().activeSession?.exercises).toHaveLength(0)
  })

  it('log_set: logs through the store, prefilled and explicit, starts rest', () => {
    startPlanWorkout()
    const first = st().activeSession!.exercises[0]
    const o = tool('log_set', { weight: 82.5, reps: 9 })
    expect(o.ok).toBe(true)
    expect(o.summary).toContain('82.5 kg × 9')
    expect(o.undo?.name).toBe('undo_last_set')
    const s = st().activeSession!
    expect(s.exercises[0].sets[0]).toMatchObject({ done: true, weight: 82.5, reps: 9, source: 'auto' })
    expect(s.rest?.durationSec).toBe(first.target.restSec)
    expect(R(o).next.set_number).toBe(2)
    // empty call = as planned
    const p = tool('log_set')
    expect(p.ok).toBe(true)
    expect(st().activeSession!.exercises[0].sets[1].done).toBe(true)
  })

  it('log_set respects autoStartRest=false and the source runtime', () => {
    startPlanWorkout()
    st().updateSettings({ autoStartRest: false })
    tool('log_set', { reps: 8 }, { origin: 'local' })
    expect(st().activeSession!.rest).toBeFalsy()
    expect(st().activeSession!.exercises[0].sets[0].source).toBe('text')
    tool('log_set', { reps: 8 }, { source: 'voice' })
    expect(st().activeSession!.exercises[0].sets[1].source).toBe('voice')
  })

  it('log_set rejects absurd values instead of logging a clamped one', () => {
    startPlanWorkout()
    const o = tool('log_set', { weight: 5000, reps: 10 })
    expect(o.ok).toBe(false)
    expect(st().activeSession!.exercises[0].sets.some((x) => x.done)).toBe(false)
  })

  it('undo_last_set reverts, and fails when nothing is logged', () => {
    startPlanWorkout()
    expect(tool('undo_last_set').ok).toBe(false)
    tool('log_set', { reps: 10 })
    expect(tool('undo_last_set').ok).toBe(true)
    expect(st().activeSession!.exercises[0].sets[0].done).toBe(false)
  })

  it('skip_exercise: current and by index; range checked', () => {
    startPlanWorkout()
    expect(tool('skip_exercise', { exercise_index: 99 }).ok).toBe(false)
    const o = tool('skip_exercise')
    expect(o.ok).toBe(true)
    expect(st().activeSession!.exercises[0].skipped).toBe(true)
    expect(st().activeSession!.cursor.ex).toBe(1)
    tool('skip_exercise', { exercise_index: 3 })
    expect(st().activeSession!.exercises[3].skipped).toBe(true)
  })

  it('swap_exercise: explicit, automatic, same, unknown', () => {
    startPlanWorkout()
    const original = st().activeSession!.exercises[0].exerciseId
    const auto = tool('swap_exercise')
    expect(auto.ok).toBe(true)
    const now = st().activeSession!.exercises[0].exerciseId
    expect(now).not.toBe(original)
    expect(st().activeSession!.exercises[0].swappedFrom).toBe(original)
    expect(tool('swap_exercise', { to_exercise_id: now }).ok).toBe(false)
    expect(tool('swap_exercise', { to_exercise_id: 'qqqzzz' }).ok).toBe(false)
    const other = now === 'plank' ? 'pull-up' : 'plank'
    expect(tool('swap_exercise', { to_exercise_id: other }).ok).toBe(true)
    expect(st().activeSession!.exercises[0].exerciseId).toBe(other)
  })

  it('add_exercise: unique, ambiguous (candidates), none', () => {
    startPlanWorkout()
    const n = st().activeSession!.exercises.length
    expect(tool('add_exercise', { query: 'plancha' }).ok).toBe(true)
    expect(st().activeSession!.exercises).toHaveLength(n + 1)
    const amb = tool('add_exercise', { query: 'curl' })
    expect(amb.ok).toBe(false)
    expect(R(amb).code).toBe('ambiguous')
    expect(R(amb).candidates.length).toBeGreaterThan(1)
    expect(st().activeSession!.exercises).toHaveLength(n + 1)
    expect(tool('add_exercise', { query: 'qqqzzz' }).ok).toBe(false)
  })

  it('rest tools', () => {
    startPlanWorkout()
    expect(tool('adjust_rest', { delta_seconds: 15 }).ok).toBe(false)
    expect(tool('start_rest', { seconds: 45 }).ok).toBe(true)
    expect(st().activeSession!.rest?.durationSec).toBe(45)
    const a = tool('adjust_rest', { delta_seconds: 30 })
    expect(a.ok).toBe(true)
    expect(st().activeSession!.rest?.durationSec).toBe(75)
    tool('start_rest', { seconds: 1 })
    expect(st().activeSession!.rest?.durationSec).toBe(5) // clamped
    expect(tool('skip_rest').ok).toBe(true)
    expect(st().activeSession!.rest).toBeNull()
    expect(tool('skip_rest').summary).toContain('No había')
    const dflt = tool('start_rest')
    expect(R(dflt).rest_sec).toBe(st().activeSession!.exercises[0].target.restSec)
  })
})

describe('finish_workout (destructive)', () => {
  it('asks for confirmation first, nothing changes', () => {
    startPlanWorkout()
    tool('log_set', { reps: 10 })
    const o = tool('finish_workout')
    expect(o.pending?.tool).toBe('finish_workout')
    expect(o.pending?.prompt).toContain('sin hacer')
    expect(st().activeSession).not.toBeNull()
    expect(selectSessions(st())).toHaveLength(0)
    expect(listPending()).toHaveLength(1)
  })

  it('confirmPending finishes, saves and navigates to the summary', () => {
    startPlanWorkout()
    tool('log_set', { weight: 60, reps: 10 })
    const navigate = vi.fn()
    const p = tool('finish_workout').pending!
    const done = confirmPending(p.id, { navigate })
    expect(done.ok).toBe(true)
    expect(st().activeSession).toBeNull()
    const saved = selectSessions(st())
    expect(saved).toHaveLength(1)
    expect(navigate).toHaveBeenCalledWith(`/summary/${saved[0].id}`)
    expect(listPending()).toHaveLength(0)
    expect(confirmPending(p.id).ok).toBe(false) // single use
  })

  it('cancelPending leaves the workout untouched', () => {
    startPlanWorkout()
    const p = tool('finish_workout').pending!
    expect(cancelPending(p.id).ok).toBe(true)
    expect(st().activeSession).not.toBeNull()
    expect(confirmPending(p.id).ok).toBe(false)
  })

  it('explicit local imperative skips the confirmation', () => {
    startPlanWorkout()
    tool('log_set', { weight: 60, reps: 10 })
    const o = executeTool({ id: 'x', name: 'finish_workout', args: {}, explicit: true }, { origin: 'local' })
    expect(o.pending).toBeUndefined()
    expect(o.ok).toBe(true)
    expect(st().activeSession).toBeNull()
  })

  it('an empty workout is discarded without saving, and no active workout fails before asking', () => {
    expect(tool('finish_workout').ok).toBe(false)
    startPlanWorkout()
    const p = tool('finish_workout').pending!
    expect(confirmPending(p.id).summary).toContain('No había series')
    expect(selectSessions(st())).toHaveLength(0)
  })

  it('pending actions expire', () => {
    vi.useFakeTimers()
    startPlanWorkout()
    const p = tool('finish_workout').pending!
    vi.advanceTimersByTime(11 * 60_000)
    expect(confirmPending(p.id)).toMatchObject({ ok: false })
    expect(st().activeSession).not.toBeNull()
  })
})

describe('get_progress', () => {
  function history() {
    startPlanWorkout()
    const id = st().activeSession!.exercises[0].exerciseId
    for (let i = 0; i < 3; i++) tool('log_set', { weight: 50 + i * 5, reps: 8 })
    st().finishWorkout()
    return id
  }

  it('empty history', () => {
    const o = tool('get_progress')
    expect(o.ok).toBe(true)
    expect(o.summary).toContain('Aún no')
    expect(tool('get_progress', { exercise_id: 'bench-press' }).summary).toContain('Aún no tienes registros')
    expect(tool('get_progress', { exercise_id: 'qqqzzz' }).ok).toBe(false)
  })

  it('exercise / muscle / overall', () => {
    const id = history()
    const e = R(tool('get_progress', { exercise_id: id }))
    expect(e.sessions_total).toBe(1)
    expect(e.pr.weight).toBe(60)
    expect(e.trend).toHaveLength(1)
    const m = R(tool('get_progress', { muscle: 'chest', period: 'week' }))
    expect(m.muscle).toBe('chest')
    const all = R(tool('get_progress'))
    expect(all.sessions_total).toBe(1)
    expect(all.recent_prs.length).toBeGreaterThan(0)
  })
})

describe('log_body_metrics', () => {
  it('saves, merges the same day, validates plausibility', () => {
    expect(tool('log_body_metrics').ok).toBe(false)
    expect(tool('log_body_metrics', { weight: 7 }).ok).toBe(false)
    expect(selectBodyLogs(st())).toHaveLength(0)
    expect(tool('log_body_metrics', { weight: 78.4 }).summary).toContain('78.4 kg')
    tool('log_body_metrics', { waist: 85, body_fat: 18 })
    const logs = selectBodyLogs(st())
    expect(logs).toHaveLength(1)
    expect(logs[0]).toMatchObject({ weight: 78.4, waist: 85, bodyFat: 18, unit: 'kg' })
  })

  it('explicit date and bad date fallback', () => {
    tool('log_body_metrics', { weight: 80, date: '2026-01-05' })
    expect(selectBodyLogs(st())[0].date).toBe('2026-01-05')
  })
})

describe('create_routine (destructive)', () => {
  const rows = [{ exercise_id: 'bench-press' }, { exercise_id: 'plank', sets: 2 }, { exercise_id: 'goblet-squat', sets: 4, reps_min: 6, reps_max: 4, rest_sec: 75 }]

  it('validates ids before asking', () => {
    const o = tool('create_routine', { name: 'X', exercises: [{ exercise_id: 'bench-press' }, { exercise_id: 'nope' }] })
    expect(o.ok).toBe(false)
    expect(R(o).invalid).toEqual(['nope'])
    expect(o.pending).toBeUndefined()
  })

  it('asks, then creates with planner defaults and never overwrites', () => {
    const o = tool('create_routine', { name: 'Mi día', focus: 'Pecho', exercises: rows })
    expect(o.pending?.prompt).toContain('Mi día')
    expect(selectRoutines(st())).toHaveLength(0)
    const done = confirmPending(o.pending!.id)
    expect(done.ok).toBe(true)
    const r = selectRoutines(st())[0]
    expect(r.items).toHaveLength(3)
    expect(r.items[0].sets).toBeGreaterThan(0) // prescribe default
    expect(r.items[1]).toMatchObject({ exerciseId: 'plank', sets: 2 })
    expect(r.items[1].targetSeconds).toBeGreaterThan(0)
    expect(r.items[2]).toMatchObject({ sets: 4, repsMin: 6, repsMax: 6, restSec: 75 })
    // same name again → suffix
    const p2 = tool('create_routine', { name: 'mi día', exercises: rows }).pending!
    confirmPending(p2.id)
    expect(selectRoutines(st()).map((x) => x.name)).toContain('mi día (2)')
    expect(selectRoutines(st())).toHaveLength(2)
  })

  it('add_to_plan appends to the rotation', () => {
    const { plan } = seedPlan()
    const p = tool('create_routine', { name: 'Extra', exercises: rows, add_to_plan: true }).pending!
    confirmPending(p.id)
    expect(st().plan!.routineIds).toHaveLength(plan.routineIds.length + 1)
  })
})

describe('modify_plan_days / set_setting (destructive)', () => {
  it('modify_plan_days regenerates the plan after confirmation, keeping old routines', () => {
    const { plan } = seedPlan(3)
    const p = tool('modify_plan_days', { days: 4 }).pending!
    expect(st().plan!.daysPerWeek).toBe(3)
    expect(confirmPending(p.id).ok).toBe(true)
    expect(st().plan!.daysPerWeek).toBe(4)
    expect(st().plan!.routineIds).not.toEqual(plan.routineIds)
    for (const id of plan.routineIds) expect(selectRoutines(st()).some((r) => r.id === id)).toBe(true)
    expect(st().profile.daysPerWeek).toBe(4)
  })

  it('modify_plan_days clamps to the supported range', () => {
    const p = tool('modify_plan_days', { days: 7 }).pending!
    expect(p.prompt).toContain('6 días')
  })

  it('set_setting whitelist, validation, confirmation', () => {
    expect(tool('set_setting', { key: 'theme', value: 'dark' }).ok).toBe(false)
    expect(tool('set_setting', { key: 'unit', value: 'stone' }).ok).toBe(false)
    expect(tool('set_setting', { key: 'sounds', value: 'maybe' }).ok).toBe(false)
    const p = tool('set_setting', { key: 'unit', value: 'lb' })
    expect(p.pending?.prompt).toContain('libras')
    expect(st().settings.unit).toBe('kg')
    confirmPending(p.pending!.id)
    expect(st().settings.unit).toBe('lb')
    confirmPending(tool('set_setting', { key: 'defaultRestSec', value: '9999' }).pending!.id)
    expect(st().settings.defaultRestSec).toBe(600)
    confirmPending(tool('set_setting', { key: 'sounds', value: 'false' }).pending!.id)
    expect(st().settings.sounds).toBe(false)
  })

  it('a local explicit call applies directly', () => {
    const o = executeTool({ id: 'z', name: 'set_setting', args: { key: 'vibration', value: 'false' }, explicit: true }, { origin: 'local' })
    expect(o.ok).toBe(true)
    expect(st().settings.vibration).toBe(false)
  })
})

describe('navigate', () => {
  it('whitelist, exercise detail, requires workout for /workout', () => {
    const navigate = vi.fn()
    expect(tool('navigate', { route: '/admin' }, { navigate }).ok).toBe(false)
    expect(tool('navigate', { route: '/progress' }, { navigate }).ok).toBe(true)
    expect(navigate).toHaveBeenLastCalledWith('/progress')
    tool('navigate', { route: '/exercises', exercise_id: 'bench-press' }, { navigate })
    expect(navigate).toHaveBeenLastCalledWith('/exercises/bench-press')
    expect(tool('navigate', { route: '/workout' }, { navigate }).ok).toBe(false)
    startPlanWorkout()
    expect(tool('navigate', { route: '/workout' }, { navigate }).ok).toBe(true)
    expect(tool('navigate', { route: '/progress' }).ok).toBe(false) // no navigator available
  })
})
