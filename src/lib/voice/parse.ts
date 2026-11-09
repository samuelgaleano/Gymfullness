/**
 * Voice/text set parser — PURE. Turns "ochenta kilos diez repeticiones",
 * "80 por 10", "subí a 85, 8 reps", "igual", "siguiente" into structured data.
 *
 * Design notes
 * - Speech engines return digits ("80 x 10") or words ("ochenta por diez"), with
 *   or without punctuation, sometimes split ("veinti uno") or glued ("80kg").
 *   Everything is first normalized to lowercase ASCII words, then number words are
 *   folded into numeric tokens, then units/operators/markers label the numbers.
 * - Spanish first (LatAm + Spain), English supported.
 * - Never throws. Unrecognised input → { type: 'unknown' }.
 * - Missing weight/reps are filled from the context (the previous set), so
 *   "12 reps" means "same weight, 12 reps".
 * - `confidence` is lowered for ambiguous parses so the UI can ask to confirm.
 */
import type { LogSetInput, ParsedVoice, Unit, VoiceCommand, VoiceContext } from '../types'
import { convertWeight, formatWeight, roundWeight } from '../units'

export type ParsedSet = Extract<ParsedVoice, { type: 'set' }>
export type ParsedCommand = Extract<ParsedVoice, { type: 'command' }>

/* ------------------------------------------------------------------------ */
/* Limits                                                                   */
/* ------------------------------------------------------------------------ */

export const VOICE_LIMITS = {
  reps: { min: 1, max: 100 },
  weight: { min: 0, max: 1000 },
  seconds: { min: 1, max: 3600 },
  rpe: { min: 1, max: 10 },
} as const

/* ------------------------------------------------------------------------ */
/* Normalization                                                            */
/* ------------------------------------------------------------------------ */

/**
 * Lowercase, strip accents/punctuation, split glued numbers ("80kg", "80x10"),
 * unify decimal commas ("82,5" → "82.5") and "mm:ss" times ("1:30" → "90 segundos").
 */
export function normalizeText(text: string): string {
  let s = (text ?? '').toLowerCase()
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '')
  s = s.replace(/½/g, ' y medio ').replace(/¼/g, ' y cuarto ').replace(/¾/g, ' y tres cuartos ')
  s = s.replace(/[×✕✖*]/g, ' x ')
  // mm:ss → seconds
  s = s.replace(/(^|[^\d])(\d{1,2}):([0-5]\d)(?!\d)/g, (_m, pre: string, mm: string, ss: string) => {
    return `${pre} ${Number(mm) * 60 + Number(ss)} segundos `
  })
  // decimal comma: "82,5" / "2,25" → dot. "80,10" is a list ("80, 10").
  s = s.replace(/(\d),(\d{1,2})(?!\d)/g, (_m, a: string, b: string) =>
    b.length === 1 || b === '25' || b === '50' || b === '75' ? `${a}.${b}` : `${a} ${b}`,
  )
  // attached ordinals: "1ra", "2da", "3er", "1º" → dropped (set references are ignored)
  s = s.replace(/(^|[^\d.])\d{1,2}(?:era|ero|ra|ro|da|do|er|ta|to|va|vo|na|no|ma|mo|st|nd|rd|th|º|°|ª)(?![a-z])/g, '$1 ')
  // leading minus sign → "menos" (typed "-5")
  s = s.replace(/^\s*-\s*(?=\d)/, ' menos ')
  // split digits from letters: "80kg" → "80 kg", "x10" → "x 10", "rpe8" → "rpe 8"
  s = s.replace(/(\d)([a-z])/g, '$1 $2').replace(/([a-z])(\d)/g, '$1 $2')
  s = s.replace(/\+/g, ' mas ')
  // punctuation → space, keeping decimal points between digits
  s = s.replace(/(\d)\.(\d)/g, '$1\u0000$2')
  s = s.replace(/[^a-z0-9\u0000\s]/g, ' ')
  s = s.replace(/\u0000/g, '.')
  return s.replace(/\s+/g, ' ').trim()
}

/* ------------------------------------------------------------------------ */
/* Vocabulary                                                               */
/* ------------------------------------------------------------------------ */

const ES_UNITS = new Map<string, number>([
  ['cero', 0], ['un', 1], ['uno', 1], ['una', 1], ['dos', 2], ['tres', 3], ['cuatro', 4],
  ['cinco', 5], ['seis', 6], ['siete', 7], ['ocho', 8], ['nueve', 9],
])
const ES_TEENS = new Map<string, number>([
  ['diez', 10], ['once', 11], ['doce', 12], ['trece', 13], ['catorce', 14], ['quince', 15],
  ['dieciseis', 16], ['diecisiete', 17], ['dieciocho', 18], ['diecinueve', 19], ['veinte', 20],
  ['veintiun', 21], ['veintiuno', 21], ['veintiuna', 21], ['veintidos', 22], ['veintitres', 23],
  ['veinticuatro', 24], ['veinticinco', 25], ['veintiseis', 26], ['veintisiete', 27],
  ['veintiocho', 28], ['veintinueve', 29],
])
const ES_TENS = new Map<string, number>([
  ['treinta', 30], ['cuarenta', 40], ['cincuenta', 50], ['sesenta', 60], ['setenta', 70],
  ['ochenta', 80], ['noventa', 90],
])
const ES_HUNDREDS = new Map<string, number>([
  ['ciento', 100], ['doscientos', 200], ['doscientas', 200], ['trescientos', 300], ['trescientas', 300],
  ['cuatrocientos', 400], ['cuatrocientas', 400], ['quinientos', 500], ['quinientas', 500],
  ['seiscientos', 600], ['seiscientas', 600], ['setecientos', 700], ['setecientas', 700],
  ['ochocientos', 800], ['ochocientas', 800], ['novecientos', 900], ['novecientas', 900],
])
const EN_UNITS = new Map<string, number>([
  ['zero', 0], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5], ['six', 6],
  ['seven', 7], ['eight', 8], ['nine', 9],
])
const EN_TEENS = new Map<string, number>([
  ['ten', 10], ['eleven', 11], ['twelve', 12], ['thirteen', 13], ['fourteen', 14], ['fifteen', 15],
  ['sixteen', 16], ['seventeen', 17], ['eighteen', 18], ['nineteen', 19],
])
const EN_TENS = new Map<string, number>([
  ['twenty', 20], ['thirty', 30], ['forty', 40], ['fourty', 40], ['fifty', 50], ['sixty', 60],
  ['seventy', 70], ['eighty', 80], ['ninety', 90],
])

const KG = new Set(['kg', 'kgs', 'k', 'kilo', 'kilos', 'quilo', 'quilos', 'kilogramo', 'kilogramos', 'kilogram', 'kilograms', 'kilito', 'kilitos'])
const LB = new Set(['lb', 'lbs', 'libra', 'libras', 'pound', 'pounds'])
const REPS = new Set(['rep', 'reps', 'repe', 'repes', 'repeticion', 'repeticiones', 'repetition', 'repetitions', 'veces', 'times'])
const SEC = new Set(['s', 'seg', 'segs', 'segundo', 'segundos', 'sec', 'secs', 'second', 'seconds'])
const MIN = new Set(['min', 'mins', 'minuto', 'minutos', 'minute', 'minutes'])
const WEIGHT_WORDS = new Set(['peso', 'carga', 'weight'])
const SET_WORDS = new Set(['serie', 'series', 'set', 'sets', 'ronda', 'rondas', 'round'])
const RPE_WORDS = new Set(['rpe', 'esfuerzo', 'intensidad', 'effort'])
const RPE_JOIN = new Set(['de', 'en', 'of', 'at', 'a'])
const OPS_X = new Set(['x', 'por', 'by', 'times', 'for'])
const OPS_CON = new Set(['con', 'de', 'with', 'at', 'a'])
const UP = new Set([
  'subi', 'subo', 'sube', 'subele', 'subir', 'subimos', 'subile', 'aumente', 'aumento', 'aumenta', 'aumentale',
  'aumentar', 'agregue', 'agrega', 'agregale', 'agregar', 'anadi', 'anade', 'anadele', 'anadir', 'sume', 'suma',
  'sumale', 'sumar', 'mas', 'increase', 'increased', 'add', 'added', 'up', 'plus', 'raise', 'raised',
])
const DOWN = new Set([
  'baje', 'bajo', 'baja', 'bajale', 'bajar', 'bajamos', 'bajele', 'quite', 'quita', 'quitale', 'quitar', 'reduje',
  'reduce', 'reducir', 'disminui', 'disminuye', 'menos', 'resta', 'restale', 'decrease', 'decreased', 'drop',
  'dropped', 'down', 'minus', 'lower', 'lowered', 'reduced',
])
const ABS_MARK = new Set(['a', 'hasta', 'to'])
const PUT = new Set(['puse', 'pon', 'ponle', 'ponele', 'ponerle', 'meti', 'metele', 'mete', 'cargue', 'carga', 'agregue', 'sume', 'anadi'])
const REL_SKIP = new Set(['le', 'lo', 'la', 'el', 'al', 'peso', 'unos', 'unas', 'otros', 'otras', 'de', 'by', 'the', 'otro'])
const ADD_TIME_MARK = new Set([
  'mas', 'more', 'extra', 'agrega', 'agregale', 'agregar', 'anade', 'anadele', 'anadir', 'suma', 'sumale', 'sumar',
  'dame', 'add', 'give', 'otros', 'otro', 'aumenta', 'extiende', 'alarga',
])
const SUB_TIME_MARK = new Set(['menos', 'quita', 'quitale', 'quitar', 'resta', 'restale', 'restar', 'less', 'minus', 'remove', 'reduce'])
const REST_WORDS = new Set(['descanso', 'descansar', 'descansa', 'descansos', 'rest'])
const TIME_WORDS = new Set(['tiempo', 'time'])
const RPE_EASY = new Set(['facil', 'easy', 'sencillo', 'sencilla', 'suave', 'comodo', 'comoda'])
const RPE_HARD = new Set(['dificil', 'duro', 'dura', 'hard', 'tough', 'durisimo', 'durisima', 'pesadisimo', 'pesadisima'])
const MEDIO = new Set(['medio', 'media'])
const EQUIPMENT = new Set(['mancuerna', 'mancuernas', 'barra', 'pesa', 'pesas', 'disco', 'discos', 'kettlebell', 'rusa', 'maquina', 'polea', 'dumbbell', 'dumbbells', 'bar', 'plate', 'plates'])

/** Words that carry no meaning for a set (never lower confidence). */
const FILLERS = new Set([
  'eh', 'ehh', 'ehm', 'em', 'emm', 'mm', 'mmm', 'um', 'umm', 'uh', 'ah', 'este', 'esta', 'esto', 'eso', 'bueno',
  'pues', 'entonces', 'vale', 'ok', 'okay', 'oka', 'va', 'ya', 'listo', 'lista', 'hecho', 'hecha', 'hice', 'hizo',
  'hago', 'hicimos', 'hiciste', 'saque', 'logre', 'complete', 'fueron', 'fue', 'son', 'eran', 'salieron', 'salio',
  'me', 'la', 'el', 'los', 'las', 'lo', 'le', 'y', 'e', 'o', 'que', 'en', 'mi', 'mis', 'tu', 'total', 'anota',
  'anotar', 'apunta', 'apuntar', 'registra', 'registrar', 'guarda', 'guardar', 'pon', 'ponme', 'poner', 'puse',
  'log', 'logged', 'did', 'done', 'i', 'the', 'and', 'of', 'just', 'so', 'like', 'alright', 'yeah', 'si', 'solo',
  'nada', 'como', 'unos', 'unas', 'aprox', 'aproximadamente', 'casi', 'tio', 'tia', 'guey', 'wey', 'parce', 'pana',
  'che', 'hermano', 'bro', 'perfecto', 'genial', 'bien', 'muy', 'otra', 'otro', 'ultima', 'ultimo', 'primera',
  'primero', 'segunda', 'tercera', 'tercero', 'cuarta', 'cuarto', 'quinta', 'sexta', 'ahora', 'ahorita', 'vez',
  'esa', 'ese', 'esas', 'esos', 'un', 'una', 'termine', 'acabe', 'siguiente', 'next', 'ready', 'go', 'mancuerna',
  'mancuernas', 'barra', 'maquina', 'polea', 'cada', 'lado', 'mano', 'pesa', 'pesas', 'it', 'was', 'were', 'got',
  'my', 'set', 'number', 'numero', 'pero', 'mismo', 'misma', 'igual', 'same', 'repite', 'dale', 'venga', 'ahi',
  'alli', 'aqui', 'tengo', 'tenia', 'hay', 'quedo', 'quedaron', 'nuevo', 'nueva', 'sin', 'okey', 'okei', 'oye', 'nomas', 'nada mas',
  'mira', 'creo', 'fallo', 'about', 'around', 'almost',
])

/* ------------------------------------------------------------------------ */
/* Number words                                                             */
/* ------------------------------------------------------------------------ */

interface NumRead {
  v: number
  end: number
}

const DIGITS = /^\d+(?:\.\d+)?$/

function readEs99(w: readonly string[], i: number): NumRead | null {
  const t = w[i]
  if (t === undefined) return null
  if (t === 'veinti' || t === 'dieci') {
    const u = ES_UNITS.get(w[i + 1] ?? '')
    if (u !== undefined && u >= 1 && (t === 'veinti' || u >= 6)) return { v: (t === 'veinti' ? 20 : 10) + u, end: i + 2 }
    return { v: t === 'veinti' ? 20 : 10, end: i + 1 }
  }
  const teen = ES_TEENS.get(t)
  if (teen !== undefined) {
    if ((teen === 10 || teen === 20) && w[i + 1] === 'y') {
      const u = ES_UNITS.get(w[i + 2] ?? '')
      if (u !== undefined && u >= 1) return { v: teen + u, end: i + 3 }
    }
    return { v: teen, end: i + 1 }
  }
  const tens = ES_TENS.get(t)
  if (tens !== undefined) {
    if (w[i + 1] === 'y') {
      const u = ES_UNITS.get(w[i + 2] ?? '')
      if (u !== undefined && u >= 1) return { v: tens + u, end: i + 3 }
    }
    return { v: tens, end: i + 1 }
  }
  const u = ES_UNITS.get(t)
  if (u !== undefined) return { v: u, end: i + 1 }
  return null
}

function readEn99(w: readonly string[], i: number): NumRead | null {
  const t = w[i]
  if (t === undefined) return null
  const tens = EN_TENS.get(t)
  if (tens !== undefined) {
    const u = EN_UNITS.get(w[i + 1] ?? '')
    if (u !== undefined && u >= 1) return { v: tens + u, end: i + 2 }
    return { v: tens, end: i + 1 }
  }
  const teen = EN_TEENS.get(t)
  if (teen !== undefined) return { v: teen, end: i + 1 }
  const u = EN_UNITS.get(t)
  if (u !== undefined) return { v: u, end: i + 1 }
  return null
}

function readEn(w: readonly string[], i: number): NumRead | null {
  let v: number
  let j: number
  if ((w[i] === 'a' || w[i] === 'one') && w[i + 1] === 'hundred') {
    v = 100
    j = i + 2
  } else if (w[i] === 'hundred') {
    v = 100
    j = i + 1
  } else {
    const a = readEn99(w, i)
    if (!a) return null
    if (w[a.end] !== 'hundred' || a.v < 1 || a.v > 9) {
      // gym-speak: "one thirty five pounds" = 135, "two twenty five for five" = 225
      if (a.v >= 1 && a.v <= 9 && a.end === i + 1) {
        const b = readEn99(w, a.end)
        const after = w[b ? b.end : -1]
        if (b && b.v >= 10 && after !== undefined && (LB.has(after) || KG.has(after) || OPS_X.has(after))) {
          return { v: a.v * 100 + b.v, end: b.end }
        }
      }
      return a
    }
    v = a.v * 100
    j = a.end + 1
  }
  const k = w[j] === 'and' ? j + 1 : j
  const b = readEn99(w, k)
  if (b) return { v: v + b.v, end: b.end }
  return { v, end: j }
}

const isUnitWord = (t: string | undefined): boolean =>
  t !== undefined && (KG.has(t) || LB.has(t) || REPS.has(t) || SEC.has(t) || MIN.has(t))

/** Integer part of a number starting at i (digits, Spanish or English words). */
function readInteger(w: readonly string[], i: number): NumRead | null {
  const t = w[i]
  if (t === undefined) return null
  if (DIGITS.test(t)) return { v: parseFloat(t), end: i + 1 }

  // "un"/"una" are articles unless a unit/fraction follows or they end the phrase.
  if (t === 'un' || t === 'una') {
    const next = w[i + 1]
    const numeric = next === undefined || isUnitWord(next) || (next === 'y' && MEDIO.has(w[i + 2] ?? ''))
    return numeric ? { v: 1, end: i + 1 } : null
  }
  // English article "a": only "a hundred" / "a minute".
  if (t === 'a') {
    if (w[i + 1] === 'hundred') return readEn(w, i)
    if (w[i + 1] === 'minute') return { v: 1, end: i + 1 }
    return null
  }
  // "medio kilo", "medio minuto", "half a minute"
  if (MEDIO.has(t) && isUnitWord(w[i + 1])) return { v: 0.5, end: i + 1 }
  if (t === 'half' && w[i + 1] === 'a' && MIN.has(w[i + 2] ?? '')) return { v: 0.5, end: i + 2 }

  const h = ES_HUNDREDS.get(t)
  if (h !== undefined) {
    const r = readEs99(w, i + 1)
    return r ? { v: h + r.v, end: r.end } : { v: h, end: i + 1 }
  }
  // split hundreds: "dos cientos"
  const u = ES_UNITS.get(t)
  if (u !== undefined && u >= 2 && (w[i + 1] === 'cientos' || w[i + 1] === 'cientas')) {
    const r = readEs99(w, i + 2)
    return r ? { v: u * 100 + r.v, end: r.end } : { v: u * 100, end: i + 2 }
  }
  if (t === 'cien') return { v: 100, end: i + 1 }
  if (t === 'mil' || t === 'thousand') return { v: 1000, end: i + 1 }
  return readEs99(w, i) ?? readEn(w, i)
}

/** "y medio", "y cuarto", "and a half" right after a number. */
function readFraction(w: readonly string[], j: number): NumRead | null {
  if (w[j] === 'y' || w[j] === 'and') {
    if (MEDIO.has(w[j + 1] ?? '')) return { v: 0.5, end: j + 2 }
    if (w[j + 1] === 'cuarto') return { v: 0.25, end: j + 2 }
    if (w[j + 1] === 'tres' && w[j + 2] === 'cuartos') return { v: 0.75, end: j + 3 }
    if (w[j + 1] === 'a' && w[j + 2] === 'half') return { v: 0.5, end: j + 3 }
    if (w[j + 1] === 'half') return { v: 0.5, end: j + 2 }
  }
  return null
}

/** "punto cinco", "coma veinticinco", "point five" right after a number. */
function readDecimal(w: readonly string[], j: number): NumRead | null {
  const m = w[j]
  if (m !== 'punto' && m !== 'coma' && m !== 'point') return null
  const t = w[j + 1]
  if (t === undefined) return null
  if (/^\d+$/.test(t)) return { v: parseFloat(`0.${t}`), end: j + 2 }
  const r = readEs99(w, j + 1) ?? readEn99(w, j + 1)
  if (!r) return null
  return { v: r.v < 10 ? r.v / 10 : r.v / 100, end: r.end }
}

/**
 * "veintidós con cinco" → 22.5. Only when it reads like a weight: the integer ends
 * in 2 or 7 (22.5, 27.5 … are real plate loads), or a weight unit follows and the
 * integer is > 20. "12 con 5" stays as 12 reps with 5 kg.
 */
function readConDecimal(w: readonly string[], j: number, intPart: number): NumRead | null {
  if (w[j] !== 'con' || !Number.isInteger(intPart)) return null
  const t = w[j + 1]
  const isFive = t === '5' || t === 'cinco' || t === 'five'
  if (!isFive) return null
  const after = w[j + 2]
  if (after !== undefined && (REPS.has(after) || SEC.has(after) || MIN.has(after))) return null
  const weightUnitFollows = after !== undefined && (KG.has(after) || LB.has(after))
  const platey = intPart >= 17 && intPart % 5 === 2
  if (platey || (weightUnitFollows && intPart > 20)) return { v: 0.5, end: j + 2 }
  return null
}

/**
 * Convert a phrase of number words/digits into a number. Returns null unless the
 * whole phrase is a number. "ciento cuarenta" → 140, "dos y medio" → 2.5,
 * "veinti uno" → 21, "one hundred twenty" → 120, "82,5" → 82.5.
 */
export function wordsToNumber(text: string): number | null {
  const w = normalizeText(text).split(' ').filter(Boolean)
  if (w.length === 0) return null
  if (w.length === 1 && (w[0] === 'un' || w[0] === 'una')) return 1
  const r = readNumberAt(w, 0)
  return r && r.end === w.length ? r.v : null
}

function readNumberAt(w: readonly string[], i: number): NumRead | null {
  const r = readInteger(w, i)
  if (!r) return null
  let { v, end } = r
  const f = readFraction(w, end)
  if (f) return { v: v + f.v, end: f.end }
  const d = readDecimal(w, end)
  if (d && Number.isInteger(v)) return { v: v + d.v, end: d.end }
  const c = readConDecimal(w, end, v)
  if (c) {
    v += c.v
    end = c.end
  }
  return { v, end }
}

/* ------------------------------------------------------------------------ */
/* Tokens                                                                   */
/* ------------------------------------------------------------------------ */

type Label = 'kg' | 'lb' | 'weight' | 'reps' | 'sec' | 'min' | 'rpe'

interface NumTok {
  k: 'n'
  v: number
  label: Label | null
  drop: boolean
  /** relative weight/reps delta sign (from "subí 5" / "bajé 2.5") */
  rel: 0 | 1 | -1
  /** explicitly absolute target ("subí a 85") */
  abs: boolean
  /** came from a single digit token ("8010"), not words */
  digits: boolean
}
interface WordTok {
  k: 'w'
  w: string
  used: boolean
}
type Tok = NumTok | WordTok

const PHRASES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bpor favor\b|\bporfa\b|\bplease\b/g, ' '],
  [/\b(?:el |la )?mism[oa] (?:peso|carga)\b|\bigual (?:de )?(?:peso|carga)\b|\bpeso igual\b|\bsame weight\b/g, ' __sw '],
  [/\b(?:las |los )?mism[ao]s (?:reps?|repes?|repeticiones)\b|\bigual (?:de )?(?:reps?|repes?|repeticiones)\b|\bsame reps\b/g, ' __sr '],
  [/\b(?:hasta (?:el )?|al |a )?fallo\b|\bto failure\b|\bfailure\b/g, ' __fail '],
  [/\bmuy facil\b|\bvery easy\b|\bsuper facil\b/g, ' __veryeasy '],
  [/\bsin (?:peso|carga|lastre)\b|\bpeso corporal\b|\bbody ?weight\b|\bno weight\b/g, ' __bw '],
  [/\b(?:another one|one more|otra mas|una mas|otra serie)\b/g, ' __again '],
  [/\b(?:por|cada|each|per) (?:cada )?(?:lado|mano|brazo|pierna|side|hand|arm|leg)\b/g, ' '],
  [/\br p e\b/g, ' rpe '],
  [/\br i r\b/g, ' rir '],
]

function tokenize(norm: string): Tok[] {
  let s = norm
  for (const [re, rep] of PHRASES) s = s.replace(re, rep)
  const w = s.split(' ').filter(Boolean)
  const out: Tok[] = []
  let i = 0
  while (i < w.length) {
    const t = w[i]!
    // implicit "1" for a bare singular minute: "minuto y medio", "minute"
    if ((t === 'minuto' || t === 'minute') && out[out.length - 1]?.k !== 'n') {
      out.push(num(1))
      out.push({ k: 'w', w: t, used: false })
      i++
      continue
    }
    const r = readNumberAt(w, i)
    if (r) {
      out.push(num(r.v, r.end === i + 1 && /^\d+$/.test(t)))
      i = r.end
      continue
    }
    out.push({ k: 'w', w: t, used: false })
    i++
  }
  return out
}

const num = (v: number, digits = false): NumTok => ({ k: 'n', v, label: null, drop: false, rel: 0, abs: false, digits })
const isNum = (t: Tok | undefined): t is NumTok => t !== undefined && t.k === 'n'
const isWord = (t: Tok | undefined): t is WordTok => t !== undefined && t.k === 'w'
const wordIs = (t: Tok | undefined, set: ReadonlySet<string>): t is WordTok => isWord(t) && !t.used && set.has(t.w)

/* ------------------------------------------------------------------------ */
/* Commands                                                                 */
/* ------------------------------------------------------------------------ */

/** Ordered: first match wins. Patterns run on normalized text. */
const COMMANDS: ReadonlyArray<readonly [VoiceCommand, RegExp]> = [
  [
    'skip_rest',
    /\b(sin descanso|no (quiero )?descans\w*|(salta|saltar|saltate|salto|omite|omitir|quita|quitar|corta|cortar|termina|terminar|acaba|acabar|para|parar|deten|detener|cancela|cancelar) (el |la |mi |este )?(descanso|timer|temporizador|cronometro)|fin del descanso|ya descanse|skip (the )?rest|no rest|end (the )?rest|stop (the )?(rest|timer))\b/,
  ],
  ['add_time', /\b(mas tiempo|mas descanso|(un )?poco mas|otro poco|dame (un )?(poco|mas|tiempo|chance|momento)|esperame|espera|aguanta|more time|more rest|extra time|extend|wait|hold on)\b/],
  ['next', /\b((termine|termina|terminar|acabe|acaba|complete|hice) (la |mi |esta |esa )?serie|serie (hecha|lista|terminada|completa|completada)|fin (de la |de )?serie)\b/],
  [
    'finish',
    /\b((termina|terminar|termine|terminamos|finaliza|finalizar|finalice|acaba|acabar|acabe|acabamos|cierra|cerrar) (el |la |mi |con el |con la )?(entreno|entrenamiento|rutina|sesion|workout|gym|dia)|fin|se acabo|por hoy|acabe|acabamos|terminamos|finalizar|terminar|acabar|finish( (the )?workout)?|end (the )?workout|i m done|im done|that s all)\b/,
  ],
  [
    'skip',
    /\b(salt(a|ar|ate|alo|emos|amos|o)|omit\w*|skip\w*|siguiente ejercicio|proximo ejercicio|next exercise|pasa(r|mos|r al|mos al)? (al |el |de |a )?(siguiente |proximo )?ejercicio|no (lo |este )?(hago|hare|voy a hacer)|paso|pass)\b/,
  ],
  [
    'undo',
    /\b(deshac\w*|deshaz|borr\w*|elimin\w*|me equivoque|equivoque|equivocado|equivocacion|error|cancel\w*|undo|delete|remove|quita(r)? (la )?ultima|no era (asi|eso)|corr[ei]g\w*|retrocede)\b/,
  ],
  [
    'technique',
    /\b(tecnica|como (se |lo |la )?(hace|hago|haces|ejecuta|ejecuto|realiza|hacerlo|hacer)|forma correcta|postura|ejecucion|explica\w*|ayuda|dudas?|tips?|consejos?|technique|how (do|to|should)|form)\b/,
  ],
  [
    'swap',
    /\b(cambi\w* (de |el |este |otro )?ejercicio|cambi(a|ar|alo|emos|o)|otro ejercicio|otra maquina|alternativ\w*|reemplaz\w*|sustitu\w*|ocupad[oa]s?|no hay (maquina|banco|barra|rack|mancuernas|polea)|me duele|duele|dolor|molestia|me molesta|swap|change( exercise)?|another exercise|alternative|replace|busy|taken|hurts)\b/,
  ],
  [
    'repeat',
    /\b(igual( que (antes|la anterior|la otra))?|lo mismo|la misma|lo de antes|repit\w*|repet\w*|otra igual|otra vez|otra mas|una mas|otra serie|another one|one more|mism[oa]s? (peso|carga|reps?|repeticiones)|same( again| as before)?|again|repeat)\b/,
  ],
  ['next', /\b(siguiente|proxim[oa]|listo|lista|listos|hecho|hecha|ya esta|ya termine|termine|terminado|terminada|complet[oa]|completado|next|done|finished|ready)\b/],
  ['rest', /\b(descans\w*|rest|reposo|pausa|pause|timer|temporizador|cronometro)\b/],
  ['skip_rest', /\b(ya|sigue|seguir|sigamos|seguimos|vamos|vamonos|dale|venga|continu\w*|empez\w*|empec\w*|arranc\w*|go|lets go|let s go|resume|start)\b/],
]

const LESS_TIME = /\b(menos tiempo|menos descanso|less time|less rest|shorter)\b/

/** Questions that must not trigger an action ("¿qué sigue?"). */
const QUESTION = /\b(que|cual|what|which)\b.*\b(sigue|toca|falta|next)\b|\bcuanto (me )?falta\b/

function matchCommand(norm: string, raw: string): ParsedCommand | null {
  if (!norm || QUESTION.test(norm)) return null
  if (LESS_TIME.test(norm)) return { type: 'command', command: 'add_time', seconds: -15, raw }
  for (const [command, re] of COMMANDS) if (re.test(norm)) return { type: 'command', command, raw }
  return null
}

/* ------------------------------------------------------------------------ */
/* Main parser                                                              */
/* ------------------------------------------------------------------------ */

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const round2 = (v: number) => Math.round(v * 100) / 100

/**
 * Parse one utterance ("80 kilos 10 repeticiones", "igual", "siguiente") in the
 * context of the current set. Pure and fast; never throws.
 */
export function parseUtterance(text: string, ctx: VoiceContext): ParsedVoice {
  const raw = typeof text === 'string' ? text.trim() : ''
  try {
    return parseInner(raw, ctx)
  } catch {
    return { type: 'unknown', raw }
  }
}

function parseInner(raw: string, ctx: VoiceContext): ParsedVoice {
  const norm = dedupeRepeat(normalizeText(raw))
  if (!norm) return { type: 'unknown', raw }
  const toks = tokenize(norm)

  const at = (i: number): Tok | undefined => toks[i]
  const words = new Set(toks.filter(isWord).map((t) => t.w))
  const sameWeight = words.has('__sw')
  const sameReps = words.has('__sr')
  const bodyweight = words.has('__bw')
  for (const t of toks) if (isWord(t) && (t.w === '__sw' || t.w === '__sr' || t.w === '__bw' || t.w === '__again')) t.used = true

  /* ---- RPE ---- */
  let rpe: number | null = null
  let rpeFromWord = false
  for (let j = 0; j < toks.length; j++) {
    const t = at(j)
    if (!isWord(t) || t.used) continue
    if (RPE_WORDS.has(t.w) || t.w === 'rir') {
      const isRir = t.w === 'rir'
      let k = j + 1
      if (wordIs(at(k), RPE_JOIN)) k++
      let target: NumTok | null = null
      const fwd = at(k)
      if (isNum(fwd) && fwd.label === null) target = fwd
      else {
        // "8 de esfuerzo"
        const b1 = at(j - 1)
        const b2 = at(j - 2)
        if (isWord(b1) && b1.w === 'de' && isNum(b2) && b2.label === null) {
          target = b2
          b1.used = true
        }
      }
      t.used = true
      if (target) {
        target.label = 'rpe'
        rpe = isRir ? 10 - target.v : target.v
      }
    } else if (t.w === '__fail') {
      t.used = true
      rpe = 10
      rpeFromWord = true
    } else if (t.w === '__veryeasy') {
      t.used = true
      rpe = 5
      rpeFromWord = true
    } else if (RPE_EASY.has(t.w)) {
      t.used = true
      rpe = 6
      rpeFromWord = true
    } else if (RPE_HARD.has(t.w)) {
      t.used = true
      rpe = 9
      rpeFromWord = true
    }
  }

  /* ---- set references: "serie 2: 80 por 10", "3 series de 10" ---- */
  const isIndex = (n: NumTok) => Number.isInteger(n.v) && n.v >= 1 && n.v <= 12 && n.label === null
  for (let j = 0; j < toks.length; j++) {
    const t = at(j)
    if (!isWord(t) || !SET_WORDS.has(t.w)) continue
    t.used = true
    const next = at(j + 1)
    if (isNum(next) && isIndex(next) && (isNum(at(j + 2)) || j + 2 >= toks.length)) next.drop = true
    const prev = at(j - 1)
    if (isNum(prev) && isIndex(prev)) prev.drop = true
  }

  /* ---- weight words: "peso 80", "80 de peso" ---- */
  for (let j = 0; j < toks.length; j++) {
    const t = at(j)
    if (!wordIs(t, WEIGHT_WORDS)) continue
    const b1 = at(j - 1)
    const b2 = at(j - 2)
    let target: NumTok | null = null
    if (isWord(b1) && b1.w === 'de' && isNum(b2) && b2.label === null && !b2.drop) {
      target = b2
      b1.used = true
    } else {
      let k = j + 1
      if (isWord(at(k)) && ((at(k) as WordTok).w === 'de' || (at(k) as WordTok).w === 'of')) k++
      const f = at(k)
      if (isNum(f) && f.label === null && !f.drop) target = f
      else if (isNum(b1) && b1.label === null && !b1.drop) target = b1
    }
    if (target) {
      target.label = 'weight'
      t.used = true
    }
  }

  /* ---- unit after number: "80 kilos", "10 reps", "45 segundos" ---- */
  for (let j = 0; j < toks.length; j++) {
    const n = at(j)
    if (!isNum(n) || n.label !== null || n.drop) continue
    let u = at(j + 1)
    if (!isWord(u) || u.used) continue
    // "30 more seconds" / "30 mas segundos": skip the marker, keep it for add_time
    const u2 = at(j + 2)
    if ((u.w === 'more' || u.w === 'mas' || u.w === 'extra') && isWord(u2) && !u2.used && (SEC.has(u2.w) || MIN.has(u2.w))) u = u2
    let label: Label | null = null
    if (KG.has(u.w)) label = 'kg'
    else if (LB.has(u.w)) label = 'lb'
    else if (SEC.has(u.w)) label = 'sec'
    else if (MIN.has(u.w)) label = 'min'
    else if (REPS.has(u.w) && !(u.w === 'times' && isNum(at(j + 2)))) label = 'reps'
    if (!label) continue
    n.label = label
    u.used = true
    const ui = toks.indexOf(u)
    // "80 kilos y medio", "un minuto y medio"
    const y = at(ui + 1)
    const m = at(ui + 2)
    if (label !== 'reps' && isWord(y) && (y.w === 'y' || y.w === 'and') && isWord(m) && MEDIO.has(m.w)) {
      n.v += 0.5
      y.used = true
      m.used = true
    }
    // "un minuto treinta" → 90 s
    if (label === 'min') {
      const s = at(ui + 1)
      const after = at(ui + 2)
      if (isNum(s) && s.label === null && s.v < 60 && !(isWord(after) && isUnitWord(after.w))) s.label = 'sec'
    }
  }

  /* ---- unit before number: "reps 10", "repeticiones: 12" ---- */
  for (let j = 0; j < toks.length; j++) {
    const n = at(j)
    if (!isNum(n) || n.label !== null || n.drop) continue
    const p = at(j - 1)
    if (!isWord(p) || p.used) continue
    if (REPS.has(p.w) && p.w !== 'times' && p.w !== 'veces') {
      n.label = 'reps'
      p.used = true
    } else if (KG.has(p.w) || LB.has(p.w)) {
      n.label = KG.has(p.w) ? 'kg' : 'lb'
      p.used = true
    }
  }

  /* ---- relative changes: "subí 5 kilos", "bajé dos y medio", "subí a 85" ---- */
  let relReps = 0
  for (let j = 0; j < toks.length; j++) {
    const t = at(j)
    if (!isWord(t) || t.used) continue
    const up = UP.has(t.w)
    const down = DOWN.has(t.w)
    if (!up && !down) continue
    // forward: marker … number
    let abs = false
    let target: NumTok | null = null
    for (let k = j + 1; k < Math.min(toks.length, j + 5); k++) {
      const x = at(k)
      if (isNum(x)) {
        if (!x.drop) target = x
        break
      }
      if (!isWord(x)) break
      if (ABS_MARK.has(x.w)) {
        abs = true
        x.used = true
        continue
      }
      if (REL_SKIP.has(x.w)) continue
      break
    }
    // backward (post-marker): "5 kilos más", "2.5 kg menos"
    if (!target && (t.w === 'mas' || t.w === 'menos' || t.w === 'more' || t.w === 'less')) {
      const u = at(j - 1)
      const n = at(j - 2)
      if (isWord(u) && isNum(n) && (n.label === 'kg' || n.label === 'lb')) target = n
      // "dos y medio más", "le puse 5 más"
      else if (isNum(u) && u.label === null && !u.drop && u.v < 30) {
        const putBefore = toks.slice(0, j - 1).some((x) => isWord(x) && PUT.has(x.w))
        if (!Number.isInteger(u.v) || putBefore) target = u
      }
    }
    if (!target || target.rel !== 0 || target.abs) continue
    if (target.label === 'sec' || target.label === 'min' || target.label === 'rpe') continue
    t.used = true
    if (target.label === 'reps') {
      if (!abs) {
        relReps += (up ? 1 : -1) * target.v
        target.drop = true
      }
      continue
    }
    if (abs || target.v >= 30) {
      target.abs = true
      if (target.label === null) target.label = 'weight'
    } else {
      target.rel = up ? 1 : -1
    }
  }

  const live = toks.filter((t): t is NumTok => isNum(t) && !t.drop && t.label !== 'rpe')

  /* ---- time adjustments & rest commands ---- */
  const timeSec = live
    .filter((n) => n.label === 'sec' || n.label === 'min')
    .reduce((acc, n) => acc + (n.label === 'min' ? n.v * 60 : n.v), 0)
  const hasTime = timeSec > 0
  const hasWeightOrReps = live.some((n) => n.label === 'kg' || n.label === 'lb' || n.label === 'weight' || n.label === 'reps' || n.rel !== 0) || relReps !== 0
  const bare = live.filter((n) => n.label === null && n.rel === 0 && !n.abs)
  const anyWord = (set: ReadonlySet<string>) => toks.some((t) => isWord(t) && set.has(t.w))
  const restWord = anyWord(REST_WORDS)
  const timeWord = anyWord(TIME_WORDS)
  const addMark = anyWord(ADD_TIME_MARK)
  const subMark = anyWord(SUB_TIME_MARK)
  const noRest = /\bsin descanso\b/.test(norm)

  if (!hasWeightOrReps && bare.length <= 1 && (hasTime || restWord || timeWord) && (addMark || subMark) && !noRest) {
    const bareSec = bare.length ? toSeconds(bare[0]!.v) : 0
    const secs = Math.round(hasTime ? timeSec : bareSec)
    const signed = subMark && !addMark ? -Math.abs(secs || 15) : secs
    return secs || subMark ? { type: 'command', command: 'add_time', seconds: signed, raw } : { type: 'command', command: 'add_time', raw }
  }
  if (!hasWeightOrReps && restWord && !noRest && ((hasTime && bare.length === 0) || (!hasTime && bare.length === 1))) {
    const secs = Math.round(hasTime ? timeSec : toSeconds(bare[0]!.v))
    return { type: 'command', command: 'rest', seconds: clamp(secs, 5, 3600), raw }
  }
  if (!hasWeightOrReps && words.has('dame') && bare.length === 1 && !hasTime) {
    return { type: 'command', command: 'add_time', seconds: Math.round(toSeconds(bare[0]!.v)), raw }
  }

  // a duration alone is not a set for rep-based exercises ("30 segundos")
  if (ctx.kind !== 'time' && hasTime && !hasWeightOrReps && bare.length === 0) return { type: 'unknown', raw }

  /* ---- no numbers: RPE-only set or command ---- */
  if (live.length === 0 && relReps === 0) {
    if (rpe !== null && (rpeFromWord || toks.some((t) => isNum(t) && t.label === 'rpe'))) {
      return finalizeSet({ ctx, raw, rpe, base: 0.55, penalty: unknownPenalty(toks) })
    }
    return matchCommand(norm, raw) ?? { type: 'unknown', raw }
  }

  /* ---- assign numbers ---- */
  let weight: number | null | undefined
  let reps: number | undefined
  let seconds: number | undefined
  let unitSaid: Unit | undefined
  let relDelta = 0
  let relUnit: Unit | undefined
  let base = 0.9
  let extraPenalty = 0

  for (const n of live) {
    if (n.rel !== 0) {
      relDelta += n.rel * n.v
      if (n.label === 'kg' || n.label === 'lb') relUnit = n.label
      continue
    }
    switch (n.label) {
      case 'kg':
      case 'lb':
        if (weight === undefined) {
          weight = n.v
          unitSaid = n.label
        } else extraPenalty += 0.15
        break
      case 'weight':
        if (weight === undefined) weight = n.v
        else extraPenalty += 0.15
        break
      case 'reps':
        if (reps === undefined) reps = n.v
        else extraPenalty += 0.15
        break
      default:
        break
    }
  }
  if (hasTime) seconds = timeSec

  const hasRel = relDelta !== 0 || live.some((n) => n.rel !== 0)
  const weightKnown = () => weight !== undefined || hasRel || sameWeight || bodyweight
  const repsKnown = () => reps !== undefined || relReps !== 0 || sameReps
  const labeledCount = live.filter((n) => n.label !== null || n.rel !== 0).length

  if (ctx.kind === 'time') {
    for (const n of bare) {
      if (seconds === undefined) seconds = n.v
      else if (!weightKnown()) weight = n.v
      else extraPenalty += 0.15
    }
    base = seconds === undefined ? 0.35 : labeledCount > 0 ? 0.95 : 0.85
  } else if (bare.length >= 2 && !weightKnown() && !repsKnown()) {
    const a = bare[0]!
    const b = bare[1]!
    const c = bare[2]
    const op = opBetween(toks, a, b)
    let w = a.v
    let r = b.v
    if (c && bare.length === 3 && op === 'x' && opBetween(toks, b, c) === 'con') {
      // "5 por 5 con 100": sets × reps with weight
      weight = c.v
      reps = b.v
      base = 0.6
    } else {
      if (op === 'con') {
        w = b.v
        r = a.v
      }
      base = op === 'juxt' ? 0.82 : op === 'far' ? 0.7 : 0.92
    }
    const rDec = !Number.isInteger(r)
    const wDec = !Number.isInteger(w)
    if (weight === undefined) {
      if ((rDec && !wDec) || (r > 30 && w <= 30 && Number.isInteger(w))) {
        ;[w, r] = [r, w]
        base -= 0.12
      }
      weight = w
      reps = r
      extraPenalty += Math.min(0.3, (bare.length - 2) * 0.15)
    }
  } else {
    // fill whichever field is missing, in order
    for (const n of bare) {
      if (!weightKnown() && repsKnown()) {
        weight = n.v
      } else if (weightKnown() && !repsKnown()) {
        reps = n.v
      } else if (!weightKnown() && !repsKnown()) {
        const single = classifySingle(n, toks, ctx)
        if (single.as === 'weight') weight = single.v
        else if (single.as === 'split') {
          weight = single.v
          reps = single.reps
        } else reps = single.v
        base = single.conf
        continue
      } else {
        extraPenalty += 0.15
        continue
      }
      base = labeledCount > 0 ? 0.93 : 0.85
    }
    if (bare.length === 0) {
      if (weight !== undefined && reps !== undefined) base = 0.97
      else if (hasRel) base = 0.88
      else base = 0.9
    }
    if ((sameWeight || bodyweight) && reps !== undefined && weight === undefined) base = Math.max(base, 0.92)
    if (sameReps && weight !== undefined && reps === undefined) base = Math.max(base, 0.92)
  }

  if (bodyweight && weight === undefined && !hasRel) weight = null

  /* ---- resolve relative changes ---- */
  let relative = false
  let unresolved = false
  if (hasRel && weight === undefined) {
    relative = true
    if (ctx.lastWeight === null || ctx.lastWeight === undefined) {
      unresolved = true
    } else {
      const delta = relUnit && relUnit !== ctx.unit ? convertWeight(relDelta, relUnit, ctx.unit) : relDelta
      const next = ctx.lastWeight + delta
      weight = relUnit && relUnit !== ctx.unit ? roundWeight(next, ctx.unit) : round2(next)
      unitSaid = ctx.unit
    }
  }
  if (relReps !== 0 && reps === undefined) {
    relative = true
    if (ctx.lastReps === null || ctx.lastReps === undefined) unresolved = true
    else reps = ctx.lastReps + relReps
  }

  return finalizeSet({
    ctx,
    raw,
    weight,
    reps,
    seconds,
    rpe,
    unit: unitSaid,
    relative,
    base: unresolved ? 0.3 : base,
    penalty: unknownPenalty(toks) + extraPenalty,
  })
}

/** "80 por 10 80 por 10" → "80 por 10" (some Android builds repeat the phrase). */
function dedupeRepeat(norm: string): string {
  const w = norm.split(' ')
  if (w.length >= 4 && w.length % 2 === 0) {
    const half = w.length / 2
    const a = w.slice(0, half).join(' ')
    if (a === w.slice(half).join(' ')) return a
  }
  return norm
}

/** Bare number in a rest context: ≤ 10 means minutes ("descanso 2"), else seconds. */
function toSeconds(v: number): number {
  return v <= 10 ? v * 60 : v
}

type Op = 'x' | 'con' | 'juxt' | 'far'

function opBetween(toks: readonly Tok[], a: NumTok, b: NumTok): Op {
  const ia = toks.indexOf(a)
  const ib = toks.indexOf(b)
  if (ib === ia + 1) return 'juxt'
  if (ib === ia + 2) {
    const m = toks[ia + 1]
    if (isWord(m)) {
      if (OPS_X.has(m.w)) return 'x'
      if (OPS_CON.has(m.w)) return 'con'
      if (m.w === 'y' || m.w === 'e' || m.w === 'and' || FILLERS.has(m.w)) return 'juxt'
    }
  }
  return 'far'
}

interface SingleResult {
  as: 'weight' | 'reps' | 'split'
  v: number
  reps?: number
  conf: number
}

/** One bare number with no labels: decide weight vs reps. */
function classifySingle(n: NumTok, toks: readonly Tok[], ctx: VoiceContext): SingleResult {
  const v = n.v
  if (ctx.kind === 'reps') return { as: 'reps', v, conf: 0.88 }
  const i = toks.indexOf(n)
  const prev = toks[i - 1]
  // "con 80", "mancuernas de 20" → weight ("serie de 12" stays reps)
  if (isWord(prev) && (prev.w === 'con' || prev.w === 'with' || prev.w === 'at')) return { as: 'weight', v, conf: 0.8 }
  const prev2 = toks[i - 2]
  if (isWord(prev) && prev.w === 'de' && isWord(prev2) && EQUIPMENT.has(prev2.w)) return { as: 'weight', v, conf: 0.8 }
  if (!Number.isInteger(v)) return { as: 'weight', v, conf: 0.82 }
  // Engines sometimes glue "ochenta diez" into "8010": split weight|reps.
  if (v > 500 && n.digits) {
    const split = splitGlued(v)
    if (split) return { as: 'split', v: split.weight, reps: split.reps, conf: 0.45 }
  }
  if (v > 500) return { as: 'weight', v, conf: 0.4 }
  if (v >= 30) return { as: 'weight', v, conf: 0.75 }
  const lw = ctx.lastWeight
  const lr = ctx.lastReps
  if (lw !== null && lw !== undefined && lw > 0) {
    const nearWeight = Math.abs(v - lw) <= Math.max(2.5, lw * 0.15)
    const nearReps = lr !== null && lr !== undefined && Math.abs(v - lr) <= 3
    if (nearWeight && !nearReps) return { as: 'weight', v, conf: 0.6 }
  }
  return { as: 'reps', v, conf: 0.72 }
}

function splitGlued(v: number): { weight: number; reps: number } | null {
  const s = String(v)
  for (const repsLen of [2, 1]) {
    if (s.length <= repsLen) continue
    const rs = s.slice(-repsLen)
    const ws = s.slice(0, -repsLen)
    if (rs.startsWith('0')) continue
    const r = Number(rs)
    const w = Number(ws)
    if (r >= 1 && r <= 30 && w >= 1 && w <= 500) return { weight: w, reps: r }
  }
  return null
}

function unknownPenalty(toks: readonly Tok[]): number {
  let unknown = 0
  for (const t of toks) {
    if (!isWord(t) || t.used) continue
    const w = t.w
    if (
      FILLERS.has(w) ||
      OPS_X.has(w) ||
      OPS_CON.has(w) ||
      UP.has(w) ||
      DOWN.has(w) ||
      ABS_MARK.has(w) ||
      REL_SKIP.has(w) ||
      MEDIO.has(w) ||
      isUnitWord(w) ||
      WEIGHT_WORDS.has(w) ||
      REST_WORDS.has(w) ||
      EQUIPMENT.has(w) ||
      w.startsWith('__')
    )
      continue
    unknown++
  }
  return Math.min(0.25, unknown * 0.06)
}

interface FinalizeInput {
  ctx: VoiceContext
  raw: string
  weight?: number | null
  reps?: number
  seconds?: number
  rpe?: number | null
  unit?: Unit
  relative?: boolean
  base: number
  penalty: number
}

function finalizeSet(f: FinalizeInput): ParsedSet {
  const { ctx } = f
  let conf = f.base - f.penalty
  const L = VOICE_LIMITS

  let weight: number | null | undefined = f.weight
  let reps: number | null | undefined = f.reps
  let seconds: number | null | undefined = f.seconds
  let rpe: number | null | undefined = f.rpe ?? undefined

  if (weight !== undefined && weight !== null) {
    const c = clamp(round2(weight), L.weight.min, L.weight.max)
    if (c !== round2(weight)) conf -= 0.3
    weight = c
  }
  if (reps !== undefined && reps !== null) {
    const rounded = Math.round(reps)
    if (rounded !== reps) conf -= 0.15
    const c = clamp(rounded, L.reps.min, L.reps.max)
    if (c !== rounded) conf -= 0.3
    reps = c
  }
  if (seconds !== undefined && seconds !== null) {
    const rounded = Math.round(seconds)
    const c = clamp(rounded, L.seconds.min, L.seconds.max)
    if (c !== rounded) conf -= 0.3
    seconds = c
  }
  if (rpe !== undefined && rpe !== null) rpe = clamp(Math.round(rpe * 2) / 2, L.rpe.min, L.rpe.max)

  // fill from context: unsaid values mean "same as last set"
  if (weight === undefined) {
    weight = ctx.lastWeight ?? null
    if (ctx.kind === 'weight_reps' && weight === null && !f.relative) conf -= 0.2
  }
  if (ctx.kind !== 'time' && reps === undefined) {
    reps = ctx.lastReps ?? null
    if (reps === null) conf -= 0.2
  }
  if (ctx.kind === 'time' && seconds === undefined) conf -= 0.3

  const out: ParsedSet = {
    type: 'set',
    weight,
    reps: ctx.kind === 'time' ? (reps ?? null) : reps,
    confidence: round2(clamp(conf, 0.05, 1)),
    raw: f.raw,
  }
  if (seconds !== undefined) out.seconds = seconds
  if (rpe !== undefined && rpe !== null) out.rpe = rpe
  out.unit = f.unit ?? ctx.unit
  if (f.relative) out.relative = true
  return out
}

/* ------------------------------------------------------------------------ */
/* Helpers for the UI                                                       */
/* ------------------------------------------------------------------------ */

/**
 * Pick the transcript alternative that parses best (speech engines return up to
 * N guesses). Earlier alternatives win ties. Returns null for an empty list.
 */
export function pickBestTranscript(
  alternatives: readonly string[],
  ctx: VoiceContext,
): { text: string; parsed: ParsedVoice; index: number } | null {
  let best: { text: string; parsed: ParsedVoice; index: number; score: number } | null = null
  alternatives.forEach((text, index) => {
    if (!text || !text.trim()) return
    const parsed = parseUtterance(text, ctx)
    const s = (parsed.type === 'set' ? parsed.confidence : parsed.type === 'command' ? 0.85 : 0) - index * 0.05
    if (!best || s > best.score) best = { text, parsed, index, score: s }
  })
  if (!best) return null
  const { text, parsed, index } = best
  return { text, parsed, index }
}

/**
 * Convert a parsed set into engine input in the session's unit
 * (e.g. "100 libras" in a kg session → 45.5 kg). Source = 'voice'.
 */
export function parsedToLogInput(p: ParsedSet, sessionUnit: Unit, source: LogSetInput['source'] = 'voice'): LogSetInput {
  let weight = p.weight ?? null
  if (weight !== null && p.unit && p.unit !== sessionUnit) weight = roundWeight(convertWeight(weight, p.unit, sessionUnit), sessionUnit)
  const input: LogSetInput = { weight, reps: p.reps ?? null, source }
  if (p.seconds !== undefined) input.seconds = p.seconds
  if (p.rpe !== undefined) input.rpe = p.rpe
  return input
}

const COMMAND_LABELS: Record<VoiceCommand, string> = {
  next: 'Siguiente',
  skip: 'Saltar ejercicio',
  undo: 'Deshacer',
  rest: 'Descanso',
  skip_rest: 'Seguir',
  add_time: 'Más tiempo',
  finish: 'Terminar entreno',
  technique: 'Técnica',
  swap: 'Cambiar ejercicio',
  repeat: 'Igual que la anterior',
}

/** "45 s", "90 s" → "1:30 min", "2 min". */
export function formatSeconds(sec: number): string {
  const s = Math.round(Math.abs(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r === 0 ? `${m} min` : `${m}:${String(r).padStart(2, '0')} min`
}

/**
 * Short Spanish confirmation for the transcript bubble / toast:
 * "80 kg × 10", "12 reps", "45 s", "Siguiente", "+30 s", "No entendí".
 */
export function formatParsed(p: ParsedVoice, unit: Unit): string {
  if (p.type === 'unknown') return 'No entendí'
  if (p.type === 'command') {
    if (p.command === 'add_time' && p.seconds) return `${p.seconds > 0 ? '+' : '−'}${formatSeconds(p.seconds)}`
    if (p.command === 'rest' && p.seconds) return `Descanso ${formatSeconds(p.seconds)}`
    return COMMAND_LABELS[p.command]
  }
  const u = p.unit ?? unit
  const parts: string[] = []
  const hasW = p.weight !== null && p.weight !== undefined
  const hasR = p.reps !== null && p.reps !== undefined
  if (hasW && hasR) parts.push(`${formatWeight(p.weight)} ${u} × ${p.reps}`)
  else if (hasW) parts.push(`${formatWeight(p.weight)} ${u}`)
  else if (hasR) parts.push(`${p.reps} ${p.reps === 1 ? 'rep' : 'reps'}`)
  if (p.seconds !== null && p.seconds !== undefined) parts.push(formatSeconds(p.seconds))
  if (p.rpe !== null && p.rpe !== undefined) parts.push(`RPE ${formatWeight(p.rpe)}`)
  return parts.length ? parts.join(' · ') : 'Serie'
}
