import { describe, expect, it } from 'vitest'
import { detectIntent, localAnswer } from './coach'

describe('coach safety routing', () => {
  it.each([
    'me torcí el tobillo',
    'Me siento mareada',
    'tengo agujetas pero siento un pinchazo en el hombro',
    'se me durmió la mano, tengo hormigueo',
    'me duele la rodilla, cuánto peso uso?',
    'siento dolor en el pecho',
  ])('%s -> pain', (q) => {
    expect(detectIntent(q)).toBe('pain')
    expect(localAnswer(q)).toMatch(/profesional|médico|fisioterapeuta/i)
  })
  it('plain soreness and sleep questions are not pain', () => {
    expect(detectIntent('tengo agujetas, ¿entreno?')).toBe('soreness')
    expect(detectIntent('he dormido mal, ¿cuánto descanso entre series?')).toBe('rest')
  })
})
