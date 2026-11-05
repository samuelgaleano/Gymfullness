import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@/store/app'
import { parseImportText, validateImport } from './importValidate'

const defaults = defaultSettings()
const routine = { id: 'r1', name: 'Día A', items: [], createdAt: 1, updatedAt: 1 }
const session = {
  id: 's1',
  name: 'Día A',
  unit: 'kg',
  startedAt: 1000,
  endedAt: 2000,
  exercises: [{ id: 'e1', exerciseId: 'bench-press', target: {}, sets: [{ id: 'x', weight: 50, reps: 10, done: true }] }],
  cursor: { ex: 0, set: 0 },
  updatedAt: 2000,
}

describe('validateImport', () => {
  it('rejects non-objects and unrelated JSON', () => {
    expect(validateImport(null, defaults).ok).toBe(false)
    expect(validateImport([1, 2], defaults).ok).toBe(false)
    expect(validateImport('hola', defaults).ok).toBe(false)
    expect(validateImport({ foo: 1 }, defaults).ok).toBe(false)
  })

  it('rejects a newer version', () => {
    const r = validateImport({ version: 2, sessions: [] }, defaults)
    expect(r.ok).toBe(false)
  })

  it('treats a missing version as v1 and tolerates missing optional fields', () => {
    const r = validateImport({ routines: [routine], sessions: [session] }, defaults)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.version).toBe(1)
    expect(r.data.plan).toBeNull()
    expect(r.data.bodyLogs).toEqual([])
    expect(r.data.settings).toEqual(defaults)
    expect(r.data.profile.onboarded).toBe(true)
    expect(r.summary.sessions).toBe(1)
  })

  it('drops malformed items and reports warnings', () => {
    const r = validateImport({ version: 1, routines: [routine, { nope: true }], sessions: [session, { id: 'bad' }] }, defaults)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.routines).toHaveLength(1)
    expect(r.data.sessions).toHaveLength(1)
    expect(r.warnings.length).toBe(2)
  })

  it('omits unfinished sessions', () => {
    const r = validateImport({ sessions: [{ ...session, endedAt: null }] }, defaults)
    expect(r.ok && r.data.sessions).toEqual([])
  })

  it('sanitizes settings and clamps rest', () => {
    const r = validateImport({ settings: { unit: 'stone', defaultRestSec: 9999, theme: 'light', sounds: 'yes' } }, defaults)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.data.settings.unit).toBe(defaults.unit)
    expect(r.data.settings.defaultRestSec).toBe(300)
    expect(r.data.settings.theme).toBe('light')
    expect(r.data.settings.sounds).toBe(defaults.sounds)
  })

  it('drops a plan that references no known routine', () => {
    const r = validateImport({ routines: [routine], plan: { routineIds: ['zzz'], goal: 'muscle' } }, defaults)
    expect(r.ok && r.data.plan).toBeNull()
    const ok = validateImport({ routines: [routine], plan: { routineIds: ['r1', 'zzz'], goal: 'strength', level: 'advanced' } }, defaults)
    expect(ok.ok && ok.data.plan?.routineIds).toEqual(['r1'])
    expect(ok.ok && ok.data.plan?.goal).toBe('strength')
  })
})

describe('parseImportText', () => {
  it('handles empty, malformed and BOM-prefixed JSON', () => {
    expect(parseImportText('', defaults).ok).toBe(false)
    expect(parseImportText('{oops', defaults).ok).toBe(false)
    const r = parseImportText('﻿' + JSON.stringify({ routines: [routine] }), defaults)
    expect(r.ok).toBe(true)
  })
})
