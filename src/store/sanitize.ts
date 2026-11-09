/**
 * Defensive validation of persisted/untrusted state. A corrupted IndexedDB entry (old version,
 * manual edit, partial write) must never white-screen the app: bad pieces are dropped, good pieces kept.
 */
import type { WorkoutSession } from '@/lib/types'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function validSet(s: unknown): boolean {
  return isObj(s) && typeof s.id === 'string' && typeof s.done === 'boolean'
}

function validExercise(e: unknown): boolean {
  if (!isObj(e) || typeof e.id !== 'string' || typeof e.exerciseId !== 'string') return false
  if (!Array.isArray(e.sets) || !e.sets.every(validSet)) return false
  const t = e.target
  return isObj(t) && isNum(t.sets) && isNum(t.repsMin) && isNum(t.repsMax) && isNum(t.restSec)
}

/** Returns the session if it is structurally safe to render, otherwise null. Clamps the cursor. */
export function sanitizeActiveSession(raw: unknown): WorkoutSession | null {
  if (!isObj(raw)) return null
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || !isNum(raw.startedAt)) return null
  if (raw.unit !== 'kg' && raw.unit !== 'lb') return null
  if (!Array.isArray(raw.exercises) || raw.exercises.length === 0 || !raw.exercises.every(validExercise)) return null
  const s = raw as unknown as WorkoutSession
  const cur = isObj(raw.cursor) ? raw.cursor : {}
  const ex = Math.min(Math.max(0, isNum(cur.ex) ? Math.floor(cur.ex) : 0), s.exercises.length - 1)
  const set = Math.min(Math.max(0, isNum(cur.set) ? Math.floor(cur.set) : 0), Math.max(0, s.exercises[ex].sets.length - 1))
  let rest = s.rest ?? null
  if (rest && !(isObj(rest) && isNum(rest.endsAt) && isNum(rest.startedAt) && isNum(rest.durationSec))) rest = null
  return { ...s, cursor: { ex, set }, rest, updatedAt: isNum(s.updatedAt) ? s.updatedAt : Date.now() }
}
