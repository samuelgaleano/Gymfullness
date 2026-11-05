/**
 * Strict-but-friendly argument validation for the JSON-schema subset in toolDefs.ts.
 * - unknown properties are dropped; wrong types are coerced when unambiguous ("80" -> 80, "true" -> true)
 * - numbers outside [minimum, maximum] are CLAMPED (reported in `notes`)
 * - missing required / bad enum / uncoercible values return a helpful error string for the model
 */
import type { JsonSchema } from './toolDefs'

export type Validation = { ok: true; value: Record<string, unknown>; notes: string[] } | { ok: false; error: string }

/** Recorded measurements: an out-of-range value is an error (logging a clamped 1000 kg for "8000" corrupts history). */
const MEASURED = /(^|\.)(weight|reps|body_fat|waist|chest|arm|thigh|hips|neck)$/

type Res<T> = { ok: true; value: T } | { ok: false; error: string }

function coerce(schema: JsonSchema, v: unknown, path: string, notes: string[]): Res<unknown> {
  switch (schema.type) {
    case 'string': {
      if (typeof v === 'number' || typeof v === 'boolean') v = String(v)
      if (typeof v !== 'string') return { ok: false, error: `${path} debe ser texto` }
      let s = v.replace(/\s+/g, ' ').trim()
      if (schema.maxLength && s.length > schema.maxLength) s = s.slice(0, schema.maxLength)
      if (schema.enum && !schema.enum.includes(s)) return { ok: false, error: `${path} debe ser uno de: ${schema.enum.join(', ')}` }
      return { ok: true, value: s }
    }
    case 'number':
    case 'integer': {
      let n: number
      if (typeof v === 'number') n = v
      else if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v.replace(',', '.')))) n = Number(v.replace(',', '.'))
      else return { ok: false, error: `${path} debe ser un número` }
      if (!Number.isFinite(n)) return { ok: false, error: `${path} debe ser un número finito` }
      if (schema.type === 'integer') n = Math.round(n)
      const lo = schema.minimum
      const hi = schema.maximum
      if (MEASURED.test(path) && ((lo !== undefined && n < lo) || (hi !== undefined && n > hi))) {
        return { ok: false, error: `${path} fuera de rango (${lo ?? '-'} a ${hi ?? '-'}); confirma el valor con el usuario` }
      }
      if (lo !== undefined && n < lo) {
        notes.push(`${path} ajustado a ${lo}`)
        n = lo
      }
      if (hi !== undefined && n > hi) {
        notes.push(`${path} ajustado a ${hi}`)
        n = hi
      }
      return { ok: true, value: n }
    }
    case 'boolean': {
      if (typeof v === 'boolean') return { ok: true, value: v }
      if (v === 'true' || v === 'sí' || v === 'si') return { ok: true, value: true }
      if (v === 'false' || v === 'no') return { ok: true, value: false }
      return { ok: false, error: `${path} debe ser true o false` }
    }
    case 'array': {
      if (!Array.isArray(v)) return { ok: false, error: `${path} debe ser una lista` }
      if (schema.minItems && v.length < schema.minItems) return { ok: false, error: `${path} necesita al menos ${schema.minItems} elemento(s)` }
      let list = v
      if (schema.maxItems && list.length > schema.maxItems) {
        notes.push(`${path} recortado a ${schema.maxItems} elementos`)
        list = list.slice(0, schema.maxItems)
      }
      const out: unknown[] = []
      for (let i = 0; i < list.length; i++) {
        const r = schema.items ? coerce(schema.items, list[i], `${path}[${i}]`, notes) : { ok: true as const, value: list[i] }
        if (!r.ok) return r
        out.push(r.value)
      }
      return { ok: true, value: out }
    }
    case 'object': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: `${path} debe ser un objeto` }
      const src = v as Record<string, unknown>
      const out: Record<string, unknown> = {}
      for (const [k, sub] of Object.entries(schema.properties ?? {})) {
        const val = src[k]
        if (val === undefined || val === null || val === '') continue
        const r = coerce(sub, val, path ? `${path}.${k}` : k, notes)
        if (!r.ok) return r
        out[k] = r.value
      }
      for (const k of schema.required ?? []) {
        if (out[k] === undefined) return { ok: false, error: `falta el argumento obligatorio ${path ? `${path}.` : ''}${k}` }
      }
      return { ok: true, value: out }
    }
  }
}

/** Validate `args` against an object schema. Never throws. */
export function validateArgs(schema: JsonSchema, args: unknown): Validation {
  const notes: string[] = []
  const input = args === undefined || args === null ? {} : args
  const r = coerce(schema, input, '', notes)
  if (!r.ok) return { ok: false, error: r.error.replace(/^\s*/, '') }
  return { ok: true, value: r.value as Record<string, unknown>, notes }
}
