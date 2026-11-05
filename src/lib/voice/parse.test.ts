import { describe, expect, it } from 'vitest'
import type { ParsedVoice, VoiceCommand, VoiceContext } from '../types'
import {
  formatParsed,
  formatSeconds,
  normalizeText,
  parsedToLogInput,
  parseUtterance,
  pickBestTranscript,
  wordsToNumber,
  type ParsedSet,
} from './parse'

const CTX: VoiceContext = { lastWeight: 80, lastReps: 10, unit: 'kg', kind: 'weight_reps' }
const ctx = (patch: Partial<VoiceContext> = {}): VoiceContext => ({ ...CTX, ...patch })

function asSet(p: ParsedVoice): ParsedSet {
  if (p.type !== 'set') throw new Error(`expected set, got ${JSON.stringify(p)}`)
  return p
}

interface SetCase {
  /** spoken text; an optional " (note)" suffix is stripped before parsing */
  text: string
  weight?: number | null
  reps?: number | null
  seconds?: number
  rpe?: number
  unit?: 'kg' | 'lb'
  relative?: boolean
  ctx?: Partial<VoiceContext>
  /** confidence must be ≥ this (default 0.5) */
  minConf?: number
  /** confidence must be < this (ambiguous parses) */
  maxConf?: number
}

/* ------------------------------------------------------------------ */
/* Sets                                                                */
/* ------------------------------------------------------------------ */

const SET_CASES: SetCase[] = [
  // explicit units, Spanish words & digits
  { text: '80 kilos 10 repeticiones', weight: 80, reps: 10, minConf: 0.9 },
  { text: 'ochenta kilos diez repeticiones', weight: 80, reps: 10, minConf: 0.9 },
  { text: 'Ochenta kilos, diez repeticiones.', weight: 80, reps: 10, minConf: 0.9 },
  { text: '80 kilos por 10 reps', weight: 80, reps: 10, minConf: 0.9 },
  { text: '80 kg 10 reps', weight: 80, reps: 10, minConf: 0.9 },
  { text: '80kg 10reps', weight: 80, reps: 10, minConf: 0.9 },
  { text: 'veinte kilos doce repeticiones', weight: 20, reps: 12, minConf: 0.9 },
  { text: '10 repeticiones de 80 kilos', weight: 80, reps: 10, minConf: 0.9 },
  { text: '10 reps con 80 kilos', weight: 80, reps: 10, minConf: 0.9 },
  { text: '8 repeticiones con 22.5', weight: 22.5, reps: 8, minConf: 0.85 },
  { text: '8 repeticiones con 22,5', weight: 22.5, reps: 8, minConf: 0.85 },
  { text: 'peso 60 reps 12', weight: 60, reps: 12, minConf: 0.85 },
  { text: '60 de peso, 12 repeticiones', weight: 60, reps: 12, minConf: 0.85 },
  { text: 'treinta y cinco kilos ocho repes', weight: 35, reps: 8, minConf: 0.9 },
  { text: 'veinti dos kilos', weight: 22, reps: 10 },
  { text: 'dieciséis repeticiones', weight: 80, reps: 16, minConf: 0.85 },
  { text: 'diez y seis repeticiones', weight: 80, reps: 16 },
  { text: 'veintiún repeticiones', weight: 80, reps: 21 },
  { text: 'cuarenta y una repeticiones', weight: 80, reps: 41 },
  { text: 'doscientos veinte libras cinco reps', weight: 220, reps: 5, unit: 'lb' },
  { text: 'cien kilos ocho', weight: 100, reps: 8, minConf: 0.85 },
  { text: '80 kilos y medio por 6', weight: 80.5, reps: 6 },
  { text: 'dos kilos y medio 15', weight: 2.5, reps: 15 },
  { text: 'medio kilo 20 repeticiones', weight: 0.5, reps: 20 },
  { text: '10 veces con 40', weight: 40, reps: 10 },

  // operators
  { text: '80 por 10', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'ochenta por diez', weight: 80, reps: 10, minConf: 0.85 },
  { text: '80x10', weight: 80, reps: 10, minConf: 0.85 },
  { text: '80 x 10', weight: 80, reps: 10, minConf: 0.85 },
  { text: '80 × 10', weight: 80, reps: 10, minConf: 0.85 },
  { text: '80*10', weight: 80, reps: 10, minConf: 0.85 },
  { text: '80/10', weight: 80, reps: 10 },
  { text: '80 10', weight: 80, reps: 10, minConf: 0.75 },
  { text: '80, 10', weight: 80, reps: 10, minConf: 0.75 },
  { text: '80 y 10', weight: 80, reps: 10 },
  { text: 'ciento cuarenta por cinco', weight: 140, reps: 5, minConf: 0.85 },
  { text: '22.5 por 8', weight: 22.5, reps: 8, minConf: 0.85 },
  { text: '82,5 x 8', weight: 82.5, reps: 8, minConf: 0.85 },
  { text: 'ochenta y dos punto cinco por ocho', weight: 82.5, reps: 8, minConf: 0.85 },
  { text: 'ochenta y dos coma cinco por ocho', weight: 82.5, reps: 8 },
  { text: 'ochenta y dos y medio por ocho', weight: 82.5, reps: 8 },
  { text: 'veintidós con cinco por doce', weight: 22.5, reps: 12 },
  { text: 'veintidós con cinco kilos', weight: 22.5, reps: 10 },
  { text: 'uno punto veinticinco por veinte', weight: 1.25, reps: 20 },
  { text: 'cien diez', weight: 100, reps: 10 },
  { text: '12 x 40', weight: 40, reps: 12, maxConf: 0.85 },
  { text: '10 80', weight: 80, reps: 10, maxConf: 0.8 },
  { text: '5 x 5', weight: 5, reps: 5 },

  // reps-first ("con", "de", "at")
  { text: '10 con 80', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'Hice 10 con 60', weight: 60, reps: 10, minConf: 0.85 },
  { text: 'hice 10 de 80', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'doce con cinco', weight: 5, reps: 12 },
  { text: 'diez con veinte kilos', weight: 20, reps: 10, minConf: 0.85 },
  { text: '80 con 10', weight: 80, reps: 10 },

  // single values use the previous set for the other field
  { text: '12 reps', weight: 80, reps: 12, minConf: 0.85 },
  { text: 'doce', weight: 80, reps: 12 },
  { text: '12', weight: 80, reps: 12 },
  { text: '85', weight: 85, reps: 10 },
  { text: 'ochenta y cinco', weight: 85, reps: 10 },
  { text: '82.5', weight: 82.5, reps: 10 },
  { text: '85 kilos', weight: 85, reps: 10, minConf: 0.85 },
  { text: 'con 90', weight: 90, reps: 10 },
  { text: 'serie de 12', weight: 80, reps: 12 },
  { text: 'mancuernas de 22', weight: 22, reps: 12, ctx: { lastWeight: 20, lastReps: 12 } },
  { text: 'mancuernas de 20 por 12', weight: 20, reps: 12 },
  { text: '22', weight: 22, reps: 12, ctx: { lastWeight: 20, lastReps: 12 }, maxConf: 0.7 },
  { text: '14', weight: 20, reps: 14, ctx: { lastWeight: 20, lastReps: 12 } },
  { text: 'diez repeticiones', weight: 80, reps: 10 },

  // same / igual
  { text: 'mismo peso 12', weight: 80, reps: 12, minConf: 0.85 },
  { text: 'el mismo peso, 12 repeticiones', weight: 80, reps: 12, minConf: 0.85 },
  { text: 'igual peso, 8', weight: 80, reps: 8, minConf: 0.85 },
  { text: 'same weight 9', weight: 80, reps: 9, minConf: 0.85 },
  { text: 'mismas repeticiones con 85', weight: 85, reps: 10 },

  // relative changes
  { text: 'subí a 85, 8 reps', weight: 85, reps: 8, minConf: 0.9 },
  { text: 'subí a 85', weight: 85, reps: 10 },
  { text: 'subí 5 kilos', weight: 85, reps: 10, relative: true, minConf: 0.8 },
  { text: 'subí cinco', weight: 85, reps: 10, relative: true },
  { text: 'bajé dos y medio', weight: 77.5, reps: 10, relative: true },
  { text: 'bajé 10 kilos e hice 12', weight: 70, reps: 12, relative: true },
  { text: 'más 2.5', weight: 82.5, reps: 10, relative: true },
  { text: '5 kilos más', weight: 85, reps: 10, relative: true },
  { text: 'quítale 5', weight: 75, reps: 10, relative: true },
  { text: 'quita 10 libras', weight: 75.5, reps: 10, relative: true, unit: 'kg' },
  { text: 'subí 2 reps', weight: 80, reps: 12, relative: true },
  { text: 'subí 5 kilos (sin peso previo)', weight: null, reps: 10, relative: true, ctx: { lastWeight: null }, minConf: 0, maxConf: 0.5 },

  // set references and filler words are ignored
  { text: 'serie 2: 80 por 10', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'segunda serie, ochenta por diez', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'la 3ra 70 por 8', weight: 70, reps: 8 },
  { text: 'hice 3 series de 10 con 80', weight: 80, reps: 10 },
  { text: 'eh bueno este... 80 por 10 listo', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'listo, 80 por 10', weight: 80, reps: 10, minConf: 0.85 },
  { text: 'siguiente: 90 por 6', weight: 90, reps: 6, minConf: 0.85 },
  { text: 'press de banca 80 por 10', weight: 80, reps: 10, minConf: 0.7 },
  { text: '20 kilos por lado, 10 reps', weight: 20, reps: 10 },
  { text: 'anota 75 por 9 por favor', weight: 75, reps: 9, minConf: 0.85 },

  // RPE / effort
  { text: '80 por 10 rpe 8', weight: 80, reps: 10, rpe: 8, minConf: 0.85 },
  { text: '80 por 10, esfuerzo 9', weight: 80, reps: 10, rpe: 9 },
  { text: '80 por 10 al fallo', weight: 80, reps: 10, rpe: 10 },
  { text: 'diez con ochenta, fácil', weight: 80, reps: 10, rpe: 6 },
  { text: '80 por 10 rir 2', weight: 80, reps: 10, rpe: 8 },
  { text: 'al fallo', weight: 80, reps: 10, rpe: 10, minConf: 0.3 },

  // English
  { text: 'one hundred pounds ten reps', weight: 100, reps: 10, unit: 'lb', minConf: 0.9 },
  { text: 'eighty kilos twelve reps', weight: 80, reps: 12, minConf: 0.9 },
  { text: 'twenty five pounds twelve reps', weight: 25, reps: 12, unit: 'lb' },
  { text: '100 pounds for 8', weight: 100, reps: 8, unit: 'lb' },
  { text: '10 reps at 80', weight: 80, reps: 10 },
  { text: 'twelve', weight: 80, reps: 12 },
  { text: 'one hundred twenty by five', weight: 120, reps: 5 },
  { text: 'increase 5 kilos', weight: 85, reps: 10, relative: true },
  { text: 'drop 10 pounds', weight: 75.5, reps: 10, relative: true },
  { text: '135 lbs 5 reps', weight: 135, reps: 5, unit: 'lb' },

  // real-world audit cases
  { text: 'Ochenta. Diez.', weight: 80, reps: 10 },
  { text: 'hice doce repeticiones con veinte kilos cada mano', weight: 20, reps: 12, minConf: 0.9 },
  { text: 'diecisiete y medio por doce', weight: 17.5, reps: 12, minConf: 0.85 },
  { text: 'hice nueve, la última al fallo', weight: 80, reps: 9, rpe: 10 },
  { text: '6 nomás', weight: 80, reps: 6 },
  { text: 'le puse 5 más', weight: 85, reps: 10, relative: true },
  { text: 'dos y medio más', weight: 82.5, reps: 10, relative: true },
  { text: 'sin peso 12', weight: null, reps: 12, minConf: 0.85 },
  { text: 'peso corporal 15', weight: null, reps: 15 },
  { text: 'una más con 85', weight: 85, reps: 10 },
  { text: 'cinco por cinco con cien', weight: 100, reps: 5, maxConf: 0.7 },
  { text: 'Ochenta kilos diez repeticiones ochenta kilos diez repeticiones', weight: 80, reps: 10, minConf: 0.9 },
  { text: 'one thirty five pounds', weight: 135, reps: 10, unit: 'lb' },
  { text: 'two twenty five for five', weight: 225, reps: 5 },

  // engines that glue digits ("ochenta diez" → "8010")
  { text: '8010', weight: 80, reps: 10, minConf: 0.3, maxConf: 0.6 },
  { text: '1008', weight: 100, reps: 8, minConf: 0.3, maxConf: 0.6 },

  // clamping
  { text: '2000 kilos', weight: 1000, reps: 10, maxConf: 0.7 },
  { text: '80 por 150', weight: 80, reps: 100, maxConf: 0.7 },

  // kind: reps (bodyweight)
  { text: '15', reps: 15, weight: null, ctx: { kind: 'reps', lastWeight: null }, minConf: 0.8 },
  { text: 'doce', reps: 12, weight: null, ctx: { kind: 'reps', lastWeight: null } },
  { text: '35', reps: 35, weight: null, ctx: { kind: 'reps', lastWeight: null } },
  { text: '10 con 20 kilos', reps: 10, weight: 20, ctx: { kind: 'reps', lastWeight: null } },

  // kind: time
  { text: '45 segundos', seconds: 45, weight: null, ctx: { kind: 'time', lastWeight: null, lastReps: null }, minConf: 0.9 },
  { text: 'un minuto', seconds: 60, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: 'minuto y medio', seconds: 90, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: 'un minuto y medio', seconds: 90, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: '2 minutos', seconds: 120, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: 'un minuto treinta', seconds: 90, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: '1:30', seconds: 90, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: '45', seconds: 45, ctx: { kind: 'time', lastWeight: null, lastReps: null }, minConf: 0.8 },
  { text: 'cuarenta segundos', seconds: 40, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: '30 seconds', seconds: 30, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
  { text: 'con 10 kilos 60 segundos', seconds: 60, weight: 10, ctx: { kind: 'time', lastWeight: null, lastReps: null } },
]

describe('parseUtterance — sets', () => {
  it.each(SET_CASES.map((c) => [c.text, c] as const))('%s', (_label, c) => {
    const spoken = c.text.replace(/ \(.*\)$/, '')
    const p = asSet(parseUtterance(spoken, ctx(c.ctx)))
    if (c.weight !== undefined) expect(p.weight).toBe(c.weight)
    if (c.reps !== undefined) expect(p.reps).toBe(c.reps)
    if (c.seconds !== undefined) expect(p.seconds).toBe(c.seconds)
    if (c.rpe !== undefined) expect(p.rpe).toBe(c.rpe)
    expect(p.unit).toBe(c.unit ?? 'kg')
    expect(Boolean(p.relative)).toBe(Boolean(c.relative))
    expect(p.raw).toBe(spoken.trim())
    expect(p.confidence).toBeGreaterThanOrEqual(c.minConf ?? 0.5)
    if (c.maxConf !== undefined) expect(p.confidence).toBeLessThan(c.maxConf)
    expect(p.confidence).toBeLessThanOrEqual(1)
  })
})

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

const COMMAND_CASES: Array<[string, VoiceCommand, number?]> = [
  ['siguiente', 'next'],
  ['Siguiente.', 'next'],
  ['listo', 'next'],
  ['hecho', 'next'],
  ['terminé la serie', 'next'],
  ['serie hecha', 'next'],
  ['next', 'next'],
  ['done', 'next'],
  ['saltar', 'skip'],
  ['omitir', 'skip'],
  ['pasar ejercicio', 'skip'],
  ['siguiente ejercicio', 'skip'],
  ['skip', 'skip'],
  ['deshacer', 'undo'],
  ['borrar', 'undo'],
  ['bórrala', 'undo'],
  ['me equivoqué', 'undo'],
  ['cancelar', 'undo'],
  ['undo', 'undo'],
  ['descanso', 'rest'],
  ['rest', 'rest'],
  ['descanso de 2 minutos', 'rest', 120],
  ['descanso 90', 'rest', 90],
  ['ya', 'skip_rest'],
  ['seguir', 'skip_rest'],
  ['vamos', 'skip_rest'],
  ['sin descanso', 'skip_rest'],
  ['saltar descanso', 'skip_rest'],
  ['termina el descanso', 'skip_rest'],
  ['skip rest', 'skip_rest'],
  ['más tiempo', 'add_time'],
  ['30 segundos más', 'add_time', 30],
  ['treinta segundos más', 'add_time', 30],
  ['dame un minuto', 'add_time', 60],
  ['agrega 15 segundos', 'add_time', 15],
  ['medio minuto más', 'add_time', 30],
  ['15 segundos menos', 'add_time', -15],
  ['menos tiempo', 'add_time', -15],
  ['30 more seconds', 'add_time', 30],
  ['add 30 seconds', 'add_time', 30],
  ['more time', 'add_time'],
  ['terminar entreno', 'finish'],
  ['terminar el entrenamiento', 'finish'],
  ['fin del entreno', 'finish'],
  ['acabé', 'finish'],
  ['finish workout', 'finish'],
  ['técnica', 'technique'],
  ['cómo se hace', 'technique'],
  ['¿Cómo se hace esto?', 'technique'],
  ['tengo una duda', 'technique'],
  ['cambiar ejercicio', 'swap'],
  ['otro ejercicio', 'swap'],
  ['la máquina está ocupada', 'swap'],
  ['swap', 'swap'],
  ['igual', 'repeat'],
  ['lo mismo', 'repeat'],
  ['repite', 'repeat'],
  ['igual que antes', 'repeat'],
  ['same', 'repeat'],
  ['again', 'repeat'],
  ['otra más', 'repeat'],
  ['another one', 'repeat'],
  ['terminar', 'finish'],
  ["I'm done", 'finish'],
  ['me duele', 'swap'],
  ['cambia', 'swap'],
  ['pausa', 'rest'],
  ['next set', 'next'],
  ["let's go", 'skip_rest'],
  ['how do I do this', 'technique'],
  ['deshaz eso', 'undo'],
]

describe('parseUtterance — commands', () => {
  it.each(COMMAND_CASES)('%s → %s', (text, command, seconds) => {
    const p = parseUtterance(text, CTX)
    expect(p.type).toBe('command')
    if (p.type !== 'command') return
    expect(p.command).toBe(command)
    expect(p.raw).toBe(text)
    if (seconds !== undefined) expect(p.seconds).toBe(seconds)
  })

  it('commands do not fire when set numbers are present', () => {
    expect(parseUtterance('listo 80 por 10', CTX).type).toBe('set')
    expect(parseUtterance('igual peso 8', CTX).type).toBe('set')
    expect(parseUtterance('siguiente, 12', CTX).type).toBe('set')
  })

  it('"45 segundos" in a time exercise is a set, not a command', () => {
    expect(parseUtterance('45 segundos', ctx({ kind: 'time' })).type).toBe('set')
    expect(parseUtterance('agrega 30 segundos', ctx({ kind: 'time' })).type).toBe('command')
  })
})

describe('parseUtterance — unknown', () => {
  it.each(['', '   ', 'hola', 'qué hora es', 'ponme música', '45 segundos', 'serie 3', 'ok', '¿Qué sigue?', '¿Qué ejercicio sigue?', 'cuánto me falta'])('"%s"', (text) => {
    const p = parseUtterance(text, CTX)
    expect(p.type).toBe('unknown')
    expect(p.raw).toBe(text.trim())
  })

  it('never throws on garbage', () => {
    for (const t of ['¿¿¿', '%%%', 'x', '...', '\u0000', 'constructor', '__proto__', 'toString 5', 'a'.repeat(5000)]) {
      expect(() => parseUtterance(t, CTX)).not.toThrow()
    }
  })
})

describe('parseUtterance — confidence', () => {
  it('explicit beats ambiguous', () => {
    const explicit = asSet(parseUtterance('80 kilos 10 repeticiones', CTX)).confidence
    const juxt = asSet(parseUtterance('80 10', CTX)).confidence
    const bare = asSet(parseUtterance('12', CTX)).confidence
    expect(explicit).toBeGreaterThan(juxt)
    expect(juxt).toBeGreaterThan(bare)
  })

  it('unrelated chatter lowers confidence', () => {
    const clean = asSet(parseUtterance('80 por 10', CTX)).confidence
    const noisy = asSet(parseUtterance('oye pásame la toalla porfa 80 por 10', CTX)).confidence
    expect(noisy).toBeLessThan(clean)
  })

  it('missing context lowers confidence', () => {
    const p = asSet(parseUtterance('12 reps', ctx({ lastWeight: null })))
    expect(p.weight).toBeNull()
    expect(p.confidence).toBeLessThan(0.9)
  })
})

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

describe('normalizeText', () => {
  it.each([
    ['Ochenta KILOS, diez repeticiones.', 'ochenta kilos diez repeticiones'],
    ['80kg×10', '80 kg x 10'],
    ['82,5 x 8', '82.5 x 8'],
    ['80,10', '80 10'],
    ['Subí a 85; 8 reps!', 'subi a 85 8 reps'],
    ['1:30', '90 segundos'],
    ['2da serie', 'serie'],
    ['RPE8', 'rpe 8'],
    ['dieciséis', 'dieciseis'],
    ['veinti-uno', 'veinti uno'],
  ])('%s → %s', (input, out) => {
    expect(normalizeText(input)).toBe(out)
  })
})

describe('wordsToNumber', () => {
  it.each([
    ['cero', 0],
    ['uno', 1],
    ['un', 1],
    ['una', 1],
    ['quince', 15],
    ['dieciséis', 16],
    ['veintiuno', 21],
    ['veintiún', 21],
    ['veinti uno', 21],
    ['veintidós', 22],
    ['treinta y cinco', 35],
    ['cien', 100],
    ['ciento cuarenta', 140],
    ['ciento cuarenta y cinco', 145],
    ['doscientos veinte', 220],
    ['quinientos', 500],
    ['novecientos noventa y nueve', 999],
    ['dos y medio', 2.5],
    ['ochenta y dos punto cinco', 82.5],
    ['veintidós con cinco', 22.5],
    ['82,5', 82.5],
    ['eighty', 80],
    ['twelve', 12],
    ['twenty five', 25],
    ['one hundred twenty', 120],
    ['a hundred and five', 105],
  ])('%s → %s', (text, n) => {
    expect(wordsToNumber(text)).toBe(n)
  })

  it.each(['ochenta kilos', 'hola', '', 'por'])('%s → null', (text) => {
    expect(wordsToNumber(text)).toBeNull()
  })
})

describe('formatParsed', () => {
  it('renders sets', () => {
    expect(formatParsed(parseUtterance('80 por 10', CTX), 'kg')).toBe('80 kg × 10')
    expect(formatParsed(parseUtterance('82.5 por 8', CTX), 'kg')).toBe('82.5 kg × 8')
    expect(formatParsed(parseUtterance('100 libras 5 reps', CTX), 'kg')).toBe('100 lb × 5')
    expect(formatParsed(parseUtterance('80 por 10 rpe 8', CTX), 'kg')).toBe('80 kg × 10 · RPE 8')
    expect(formatParsed(parseUtterance('12', ctx({ kind: 'reps', lastWeight: null })), 'kg')).toBe('12 reps')
    expect(formatParsed(parseUtterance('45 segundos', ctx({ kind: 'time', lastWeight: null })), 'kg')).toBe('45 s')
    expect(formatParsed(parseUtterance('minuto y medio', ctx({ kind: 'time', lastWeight: null })), 'kg')).toBe('1:30 min')
  })

  it('renders commands and unknown', () => {
    expect(formatParsed(parseUtterance('siguiente', CTX), 'kg')).toBe('Siguiente')
    expect(formatParsed(parseUtterance('30 segundos más', CTX), 'kg')).toBe('+30 s')
    expect(formatParsed(parseUtterance('menos tiempo', CTX), 'kg')).toBe('−15 s')
    expect(formatParsed(parseUtterance('descanso de 2 minutos', CTX), 'kg')).toBe('Descanso 2 min')
    expect(formatParsed(parseUtterance('hola', CTX), 'kg')).toBe('No entendí')
  })

  it('formatSeconds', () => {
    expect(formatSeconds(45)).toBe('45 s')
    expect(formatSeconds(60)).toBe('1 min')
    expect(formatSeconds(90)).toBe('1:30 min')
    expect(formatSeconds(125)).toBe('2:05 min')
  })
})

describe('pickBestTranscript', () => {
  it('prefers the alternative that parses as a confident set', () => {
    const best = pickBestTranscript(['ochenta pro diez mil', '80 por 10'], CTX)
    expect(best?.index).toBe(1)
    expect(best?.parsed.type).toBe('set')
  })

  it('keeps the first one on ties and handles empty lists', () => {
    expect(pickBestTranscript(['80 por 10', '80 por 10'], CTX)?.index).toBe(0)
    expect(pickBestTranscript([], CTX)).toBeNull()
    expect(pickBestTranscript(['', '  '], CTX)).toBeNull()
  })
})

describe('parsedToLogInput', () => {
  it('converts pounds into a kg session', () => {
    const p = asSet(parseUtterance('100 libras 10 reps', CTX))
    expect(parsedToLogInput(p, 'kg')).toEqual({ weight: 45.5, reps: 10, source: 'voice' })
  })

  it('passes seconds and rpe through', () => {
    const t = asSet(parseUtterance('45 segundos', ctx({ kind: 'time', lastWeight: null })))
    expect(parsedToLogInput(t, 'kg')).toEqual({ weight: null, reps: null, seconds: 45, source: 'voice' })
    const r = asSet(parseUtterance('80 por 10 rpe 9', CTX))
    expect(parsedToLogInput(r, 'kg', 'text')).toEqual({ weight: 80, reps: 10, rpe: 9, source: 'text' })
  })
})

describe('performance', () => {
  it('parses 2000 utterances fast', () => {
    const t0 = performance.now()
    for (let i = 0; i < 2000; i++) parseUtterance('ochenta y dos y medio kilos por diez repeticiones rpe ocho', CTX)
    expect(performance.now() - t0).toBeLessThan(1000)
  })
})
