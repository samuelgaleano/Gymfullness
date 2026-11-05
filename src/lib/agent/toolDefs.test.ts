import { describe, expect, it } from 'vitest'
import { TOOL_DEFS, TOOL_NAMES, toolsDigest, NAV_ROUTES, SETTING_KEYS, type JsonSchema } from './toolDefs'
import { TOOLS, getTool } from './tools'
import { toGeminiSchema, geminiTools, anthropicTools, openaiTools } from '../../../functions/api/agent'

describe('toolDefs ↔ registry', () => {
  it('has exactly the declared tool names, once each', () => {
    expect(TOOL_DEFS.map((d) => d.name).sort()).toEqual([...TOOL_NAMES].sort())
    expect(new Set(TOOL_NAMES).size).toBe(TOOL_NAMES.length)
  })

  it('every def has an executable tool with the same risk and schema', () => {
    expect(TOOLS.map((t) => t.name)).toEqual(TOOL_DEFS.map((d) => d.name))
    for (const d of TOOL_DEFS) {
      const t = getTool(d.name)!
      expect(typeof t.execute).toBe('function')
      expect(t.risk).toBe(d.risk)
      expect(t.parameters).toBe(d.parameters)
    }
  })

  it('has the required tools and risk classes', () => {
    for (const n of ['get_context', 'start_workout', 'log_set', 'create_routine', 'set_setting', 'navigate']) expect(TOOL_NAMES).toContain(n)
    const destructive = TOOL_DEFS.filter((d) => d.risk === 'destructive').map((d) => d.name).sort()
    expect(destructive).toEqual(['create_routine', 'finish_workout', 'modify_plan_days', 'set_setting'])
  })

  it('schemas are well formed objects with documented, bounded properties', () => {
    const walk = (s: JsonSchema, path: string) => {
      expect(['object', 'string', 'number', 'integer', 'boolean', 'array']).toContain(s.type)
      if (s.type === 'array') expect(s.items, path).toBeTruthy()
      if (s.type === 'object') {
        for (const r of s.required ?? []) expect(Object.keys(s.properties ?? {}), `${path}.${r}`).toContain(r)
        for (const [k, v] of Object.entries(s.properties ?? {})) walk(v, `${path}.${k}`)
      }
      if (s.items) walk(s.items, `${path}[]`)
    }
    for (const d of TOOL_DEFS) {
      expect(d.description.length).toBeGreaterThan(20)
      expect(d.parameters.type).toBe('object')
      walk(d.parameters, d.name)
    }
  })

  it('whitelists are what the spec allows', () => {
    expect([...SETTING_KEYS]).toEqual(['unit', 'defaultRestSec', 'autoStartRest', 'sounds', 'vibration', 'voiceAnnouncements'])
    expect(NAV_ROUTES).toContain('/progress')
    expect(NAV_ROUTES.every((r) => r.startsWith('/'))).toBe(true)
  })

  it('digest is stable and short', () => {
    expect(toolsDigest()).toBe(toolsDigest())
    expect(toolsDigest().length).toBeLessThan(10)
  })
})

describe('provider tool declarations (server)', () => {
  it('anthropic: one entry per tool, cache_control on the last only', () => {
    const t = anthropicTools()
    expect(t.map((x) => x.name)).toEqual(TOOL_NAMES)
    expect(t.filter((x) => 'cache_control' in x)).toHaveLength(1)
    expect(t[t.length - 1].cache_control).toEqual({ type: 'ephemeral' })
  })

  it('openai: function tools', () => {
    const t = openaiTools()
    expect(t).toHaveLength(TOOL_NAMES.length)
    expect(t[0]).toMatchObject({ type: 'function', function: { name: 'get_context' } })
  })

  it('gemini: unsupported keys stripped, argument-less tools have no parameters', () => {
    const decl = (geminiTools()[0] as { functionDeclarations: { name: string; parameters?: unknown }[] }).functionDeclarations
    expect(decl).toHaveLength(TOOL_NAMES.length)
    expect(decl.find((d) => d.name === 'get_context')!.parameters).toBeUndefined()
    const json = JSON.stringify(decl)
    expect(json).not.toContain('maxLength')
    expect(json).not.toContain('additionalProperties')
    expect(decl.find((d) => d.name === 'log_set')!.parameters).toBeTruthy()
    const s = toGeminiSchema({ type: 'string', maxLength: 5, description: 'x' })
    expect(s).toEqual({ type: 'string', description: 'x' })
  })
})
