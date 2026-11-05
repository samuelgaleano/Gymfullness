import { describe, expect, it } from 'vitest'
import { aiMode, capLabel, formatRest, isChipOnly, isNo, isStaleConversation, isYes, visibleTools } from './assistantLogic'

describe('isYes / isNo', () => {
  it('understands spoken confirmations', () => {
    for (const t of ['sí', 'Si.', 'dale', 'Claro!', 'confirmo', 'sí, hazlo', 'OK']) expect(isYes(t), t).toBe(true)
    for (const t of ['no', 'No.', 'cancela', 'mejor no', 'No gracias', 'olvídalo']) expect(isNo(t), t).toBe(true)
  })
  it('does not treat commands as answers', () => {
    for (const t of ['siguiente', '80 por 10', 'no sé cuánto peso', 'sí quiero cambiar el ejercicio']) {
      expect(isYes(t), t).toBe(false)
      expect(isNo(t), t).toBe(false)
    }
  })
})

describe('isStaleConversation', () => {
  const at = (iso: string) => new Date(iso).getTime()
  it('is per day', () => {
    expect(isStaleConversation([])).toBe(false)
    expect(isStaleConversation([{ at: at('2026-03-01T22:00:00') }], at('2026-03-01T23:50:00'))).toBe(false)
    expect(isStaleConversation([{ at: at('2026-03-01T22:00:00') }], at('2026-03-02T08:00:00'))).toBe(true)
  })
})

describe('aiMode', () => {
  const base = { useAI: true, available: true, online: true, remaining: 10 }
  it('is basic when AI cannot answer', () => {
    expect(aiMode(base).mode).toBe('ai')
    expect(aiMode({ ...base, useAI: false })).toMatchObject({ mode: 'basic', reason: 'IA apagada en Ajustes' })
    expect(aiMode({ ...base, online: false }).mode).toBe('basic')
    expect(aiMode({ ...base, available: false }).reason).toBe('IA no disponible')
    expect(aiMode({ ...base, remaining: 0 }).reason).toBe('Límite diario de IA')
    expect(aiMode({ ...base, available: null }).mode).toBe('ai') // still checking: do not flash the badge
  })
})

describe('labels', () => {
  it('cap label', () => {
    expect(capLabel({ used: 3, cap: 40, remaining: 37 })).toBe('3/40 consultas con IA hoy')
    expect(capLabel({ used: 40, cap: 40, remaining: 0 })).toMatch(/límite de hoy/)
  })
  it('rest clock', () => {
    expect(formatRest(75)).toBe('1:15')
    expect(formatRest(5)).toBe('0:05')
  })
})

describe('tool chips', () => {
  const t = (summary: string, ok = true) => ({ name: 'x', ok, summary })
  it('chip-only when the message is just the outcome', () => {
    expect(isChipOnly({ text: 'Serie 1 · 80 kg × 10', tools: [t('Serie 1 · 80 kg × 10')] })).toBe(true)
    expect(isChipOnly({ text: 'Listo, anoté tu serie.', tools: [t('Serie 1 · 80 kg × 10')] })).toBe(false)
    expect(isChipOnly({ text: 'Hola', tools: [] })).toBe(false)
  })
  it('a confirmation question is never a done action', () => {
    const q = '¿Terminar el entreno?'
    expect(isChipOnly({ text: q, tools: [t(q)] })).toBe(false)
    expect(visibleTools({ text: 'Dudo', tools: [t(q), t('Serie 2')] }).map((x) => x.summary)).toEqual(['Serie 2'])
  })
  it('hides chips that repeat the text', () => {
    expect(visibleTools({ text: 'Serie 2', tools: [t('Serie 2'), t('Descanso 90 s')] }).map((x) => x.summary)).toEqual(['Descanso 90 s'])
  })
})
