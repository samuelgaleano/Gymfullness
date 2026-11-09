import { describe, expect, it } from 'vitest'
import { sanitizeActiveSession } from './sanitize'

const set = (o: object = {}) => ({ id: 's1', done: false, weight: 80, reps: 10, ...o })
const ex = (o: object = {}) => ({
  id: 'e1',
  exerciseId: 'bench-press',
  target: { sets: 1, repsMin: 8, repsMax: 12, restSec: 90 },
  sets: [set()],
  ...o,
})
const session = (o: object = {}) => ({
  id: 'w1',
  name: 'Día A',
  unit: 'kg',
  startedAt: 1,
  exercises: [ex()],
  cursor: { ex: 0, set: 0 },
  rest: null,
  updatedAt: 1,
  ...o,
})

describe('sanitizeActiveSession', () => {
  it('keeps a valid session', () => {
    expect(sanitizeActiveSession(session())?.id).toBe('w1')
  })
  it.each([
    ['null', null],
    ['string', 'x'],
    ['array', []],
    ['no id', session({ id: undefined })],
    ['bad unit', session({ unit: 'stone' })],
    ['exercises not array', session({ exercises: 'bad' })],
    ['empty exercises', session({ exercises: [] })],
    ['exercise without sets array', session({ exercises: [ex({ sets: 'x' })] })],
    ['exercise without target', session({ exercises: [ex({ target: null })] })],
    ['NaN startedAt', session({ startedAt: Number.NaN })],
  ])('rejects %s', (_n, raw) => {
    expect(sanitizeActiveSession(raw)).toBeNull()
  })
  it('clamps an out-of-range cursor and drops a malformed rest', () => {
    const s = sanitizeActiveSession(session({ cursor: { ex: 99, set: -5 }, rest: { endsAt: 'soon' } }))!
    expect(s.cursor).toEqual({ ex: 0, set: 0 })
    expect(s.rest).toBeNull()
  })
  it('repairs a missing cursor', () => {
    expect(sanitizeActiveSession(session({ cursor: undefined }))!.cursor).toEqual({ ex: 0, set: 0 })
  })
})
