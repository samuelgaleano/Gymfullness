import { describe, expect, it } from 'vitest'
import { validateArgs } from './validate'
import { TOOL_DEFS } from './toolDefs'

const schema = (n: string) => TOOL_DEFS.find((d) => d.name === n)!.parameters

describe('validateArgs', () => {
  it('coerces numeric strings and drops unknown props', () => {
    const r = validateArgs(schema('log_set'), { weight: '80', reps: '10.4', bogus: 1 })
    expect(r).toMatchObject({ ok: true, value: { weight: 80, reps: 10 } })
    expect((r as { value: object }).value).not.toHaveProperty('bogus')
  })

  it('clamps numbers and reports it', () => {
    const r = validateArgs(schema('log_set'), { weight: 99, rpe: 0, reps: 5 })
    expect(r).toMatchObject({ ok: true, value: { weight: 99, rpe: 1 } })
    expect((r as { notes: string[] }).notes.length).toBe(1)
  })

  it('rejects (never clamps) out-of-range recorded measurements', () => {
    expect(validateArgs(schema('log_set'), { weight: 99999 })).toMatchObject({ ok: false })
    expect(validateArgs(schema('log_set'), { reps: -3 })).toMatchObject({ ok: false })
    expect(validateArgs(schema('log_body_metrics'), { weight: 5000 })).toMatchObject({ ok: false })
  })

  it('returns helpful errors instead of throwing', () => {
    expect(validateArgs(schema('add_exercise'), {})).toEqual({ ok: false, error: 'falta el argumento obligatorio query' })
    expect(validateArgs(schema('log_set'), { weight: 'mucho' })).toMatchObject({ ok: false })
    const e = validateArgs(schema('set_setting'), { key: 'theme', value: 'dark' })
    expect(e).toMatchObject({ ok: false })
    expect((e as { error: string }).error).toContain('unit')
    expect(validateArgs(schema('log_set'), 'oops')).toMatchObject({ ok: false })
    expect(validateArgs(schema('get_context'), undefined)).toMatchObject({ ok: true, value: {} })
  })

  it('validates nested arrays', () => {
    const bad = validateArgs(schema('create_routine'), { name: 'A', exercises: [{ sets: 3 }] })
    expect(bad).toMatchObject({ ok: false })
    const empty = validateArgs(schema('create_routine'), { name: 'A', exercises: [] })
    expect(empty).toMatchObject({ ok: false })
    const ok = validateArgs(schema('create_routine'), { name: 'A', exercises: [{ exercise_id: 'bench-press', sets: '4' }] })
    expect(ok).toMatchObject({ ok: true, value: { exercises: [{ exercise_id: 'bench-press', sets: 4 }] } })
  })

  it('coerces booleans', () => {
    expect(validateArgs(schema('start_workout'), { free: 'true' })).toMatchObject({ value: { free: true } })
    expect(validateArgs(schema('start_workout'), { free: 'quizá' })).toMatchObject({ ok: false })
  })
})
