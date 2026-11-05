/**
 * "Coach" Q&A for the current exercise (technique doubts, pain, rest, weight…).
 *
 * - `askCoach` uses the optional serverless AI endpoint (`/api/coach`, Claude) when the deploy
 *   has a key, and ALWAYS falls back to `localAnswer` (offline, rule-based, instant) on any
 *   problem: not configured, offline, timeout (15 s), rate limit, server error.
 * - `localAnswer` is pure and works with the exercise's own setup/cues/mistakes/breathing.
 * Answers are short (≤ 6 lines), friendly and actionable, in Spanish (tuteo).
 */
import type { Exercise, Goal, Level, Profile } from './types'
import { alternatives } from './recommend'
import { EQUIPMENT_LABEL, EXERCISES, MUSCLE_LABEL } from '@/data/exercises'

export interface CoachContext {
  exercise?: Exercise
  profile?: Profile
  /** Short free text about recent training, e.g. "Última vez: 3×10 con 60 kg". */
  recentSummary?: string
}

export interface CoachAnswer {
  answer: string
  source: 'ai' | 'local'
}

const ENDPOINT = '/api/coach'
const ASK_TIMEOUT_MS = 15_000
const AVAILABILITY_TIMEOUT_MS = 5_000
/** Retry the availability check after a transient failure (offline, 5xx). */
const AVAILABILITY_RETRY_MS = 2 * 60_000
export const MAX_QUESTION_CHARS = 500
export const MAX_CONTEXT_CHARS = 4096
const MAX_LINES = 6
const MAX_AI_CHARS = 1200

/* ================================================================ availability */

let availability: Promise<boolean> | null = null
let availabilityExpiresAt = 0

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

async function fetchWithTimeout(input: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), ms)
  try {
    return await fetch(input, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function checkAvailability(): Promise<{ enabled: boolean; definitive: boolean }> {
  if (isOffline()) return { enabled: false, definitive: false }
  try {
    const res = await fetchWithTimeout(
      ENDPOINT,
      { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store' },
      AVAILABILITY_TIMEOUT_MS,
    )
    if (res.status === 404 || res.status === 405) return { enabled: false, definitive: true }
    if (!res.ok) return { enabled: false, definitive: false }
    // Local dev / static hosting answers the SPA's index.html: not JSON → no endpoint.
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return { enabled: false, definitive: true }
    const body = (await res.json()) as unknown
    const enabled = !!body && typeof body === 'object' && (body as { enabled?: unknown }).enabled === true
    return { enabled, definitive: true }
  } catch {
    return { enabled: false, definitive: false }
  }
}

/**
 * Whether the AI coach endpoint is available on this deploy. Checked once via GET /api/coach
 * and cached (a network failure is retried after 2 min). Never rejects.
 */
export function coachAvailable(): Promise<boolean> {
  if (availability && Date.now() < availabilityExpiresAt) return availability
  availabilityExpiresAt = Number.POSITIVE_INFINITY // while pending
  const p = checkAvailability().then(({ enabled, definitive }) => {
    if (availability === p) availabilityExpiresAt = definitive ? Number.POSITIVE_INFINITY : Date.now() + AVAILABILITY_RETRY_MS
    return enabled
  })
  availability = p
  return p
}

function markUnavailable(): void {
  availability = Promise.resolve(false)
  availabilityExpiresAt = Date.now() + AVAILABILITY_RETRY_MS
}

/** Test helper: forget the cached availability. */
export function __resetCoachForTests(): void {
  availability = null
  availabilityExpiresAt = 0
}

/* ================================================================ context for the AI */

export interface CoachRequestContext {
  exercise?: {
    name: string
    primary: string
    secondary: string[]
    equipment: string[]
    kind: Exercise['kind']
    level: Level
    setup: string[]
    cues: string[]
    mistakes: string[]
    breathing?: string
  }
  profile?: { goal?: Goal; level?: Level; equipment?: Profile['equipment']; sex?: Profile['sex']; age?: number }
  recentSummary?: string
}

/**
 * Compact, privacy-light context for the AI (no name/email). Guaranteed ≤ 4 KB as JSON:
 * trims the summary first, then the longest lists.
 */
export function buildCoachContext(ctx: CoachContext, now: Date = new Date()): CoachRequestContext {
  const out: CoachRequestContext = {}
  const ex = ctx.exercise
  if (ex) {
    out.exercise = {
      name: ex.name,
      primary: MUSCLE_LABEL[ex.primary] ?? ex.primary,
      secondary: ex.secondary.map((m) => MUSCLE_LABEL[m] ?? m),
      equipment: ex.equipment.map((e) => EQUIPMENT_LABEL[e] ?? e),
      kind: ex.kind,
      level: ex.level,
      setup: ex.setup.slice(0, 3),
      cues: ex.cues.slice(0, 5),
      mistakes: ex.mistakes.slice(0, 4),
      ...(ex.breathing ? { breathing: ex.breathing } : {}),
    }
  }
  const p = ctx.profile
  if (p) {
    const profile: NonNullable<CoachRequestContext['profile']> = {}
    if (p.goal) profile.goal = p.goal
    if (p.level) profile.level = p.level
    if (p.equipment) profile.equipment = p.equipment
    if (p.sex) profile.sex = p.sex
    if (typeof p.birthYear === 'number' && p.birthYear > 1900) profile.age = now.getFullYear() - p.birthYear
    if (Object.keys(profile).length) out.profile = profile
  }
  const summary = ctx.recentSummary?.trim()
  if (summary) out.recentSummary = summary.slice(0, 800)

  const size = () => JSON.stringify(out).length
  if (size() > MAX_CONTEXT_CHARS && out.recentSummary) out.recentSummary = out.recentSummary.slice(0, 200)
  const lists: (keyof Pick<NonNullable<CoachRequestContext['exercise']>, 'mistakes' | 'setup' | 'cues'>)[] = [
    'mistakes',
    'setup',
    'cues',
  ]
  for (const key of lists) {
    while (size() > MAX_CONTEXT_CHARS && out.exercise && out.exercise[key].length > 1) out.exercise[key].pop()
  }
  if (size() > MAX_CONTEXT_CHARS) delete out.recentSummary
  if (size() > MAX_CONTEXT_CHARS && out.exercise) {
    const e = out.exercise
    e.setup = e.setup.map((s) => s.slice(0, 120))
    e.cues = e.cues.map((s) => s.slice(0, 120))
    e.mistakes = e.mistakes.map((s) => s.slice(0, 120))
    if (e.breathing) e.breathing = e.breathing.slice(0, 200)
  }
  return out
}

/* ================================================================ ask */

function clampAnswer(text: string): string {
  const clean = text.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return clean.length > MAX_AI_CHARS ? `${clean.slice(0, MAX_AI_CHARS).replace(/\s+\S*$/, '')}…` : clean
}

/**
 * Answers a question about training / the current exercise. Uses the AI endpoint when
 * available, otherwise (or on any failure / 15 s timeout) the offline answerer. Never rejects.
 */
export async function askCoach(question: string, ctx: CoachContext = {}): Promise<CoachAnswer> {
  const q = question.trim().slice(0, MAX_QUESTION_CHARS)
  const local = (): CoachAnswer => ({ answer: localAnswer(q, ctx), source: 'local' })
  if (!q || isOffline()) return local()
  if (!(await coachAvailable())) return local()
  try {
    const res = await fetchWithTimeout(
      ENDPOINT,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ question: q, context: buildCoachContext(ctx) }),
      },
      ASK_TIMEOUT_MS,
    )
    if (!res.ok) {
      if (res.status === 404 || res.status === 503) markUnavailable()
      return local()
    }
    const body = (await res.json()) as unknown
    const answer =
      body && typeof body === 'object' && typeof (body as { answer?: unknown }).answer === 'string'
        ? (body as { answer: string }).answer.trim()
        : ''
    return answer ? { answer: clampAnswer(answer), source: 'ai' } : local()
  } catch {
    return local()
  }
}

/* ================================================================ local answerer */

export type CoachIntent =
  | 'soreness'
  | 'pain'
  | 'breathing'
  | 'mistakes'
  | 'alternatives'
  | 'warmup'
  | 'rest'
  | 'progression'
  | 'weight'
  | 'reps'
  | 'technique'
  | 'general'

/** Lowercase, no accents/punctuation, single spaces. */
export function normalizeQuestion(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:()"'«»]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Ordered: the first match wins (safety first, specific before generic). */
const INTENT_RULES: readonly [CoachIntent, RegExp][] = [
  ['soreness', /\b(agujeta|doms\b|adolorid|entumecid|tieso|dolor muscular|cuerpo cortado)/],
  [
    'pain',
    /\b(dolor|duele|duelen|dolio|lesion|lesione|lastim|molest|pinchazo|punzada|hernia|tendinitis|tendon|esguince|desgarr|hormigue|mareo|mareado|crujid|cruje|truena|tiron)/,
  ],
  ['breathing', /\b(respir|aire\b|inhal|exhal|espir|soplo|soplar|bracing)/],
  ['mistakes', /\b(error|errores|evitar|equivoc|lo hago mal|hago mal|fallos? comun)/],
  [
    'alternatives',
    /\b(alternativ|sustitu|reemplaz|cambiar|cambio|otro ejercicio|en vez|en lugar|no tengo|ocupad|no hay|parecido|similar)/,
  ],
  ['warmup', /\b(calent|calient|aproximacion|warm ?up|activacion|antes de empezar)/],
  ['rest', /\b(descans|pausa|entre series|cuanto espero|recuperar entre)/],
  [
    'progression',
    /\b(progres|estanc|subir de peso|subo de peso|subir peso|subo peso|cuando subo|cuando subir|aumentar (el )?peso|mejorar|avanzar|plateau|mas fuerte|no avanzo)/,
  ],
  ['weight', /\b(peso|pesas|kilos?|kg|carga|cuanto levant|libras|lbs?)\b/],
  ['reps', /\b(reps?\b|repeticion|series|serie\b|cuantas|cuantos sets|sets?\b|volumen)/],
  [
    'technique',
    /\b(tecnica|como se hace|como lo hago|como hago|como hacer|como lo hago bien|forma|postura|ejecucion|colocar|coloco|posicion|agarre|bien hecho|correctamente|bien)/,
  ],
]

export function detectIntent(question: string): CoachIntent {
  const q = normalizeQuestion(question)
  for (const [intent, re] of INTENT_RULES) if (re.test(q)) return intent
  return 'general'
}

const GOAL_LABEL: Record<Goal, string> = {
  muscle: 'ganar músculo',
  strength: 'ganar fuerza',
  fat_loss: 'perder grasa',
  health: 'salud y forma',
}

const REPS_BY_GOAL: Record<Goal, string> = {
  strength: '3–6 reps en 3–5 series en los básicos',
  muscle: '8–12 reps en 3–4 series',
  fat_loss: '10–15 reps en 3 series con descansos cortos',
  health: '8–15 reps en 2–3 series',
}

const REST_BY_GOAL: Record<Goal, string> = {
  strength: '2–3 min en básicos pesados, 90 s en accesorios',
  muscle: '60–120 s (hasta 2–3 min en básicos pesados)',
  fat_loss: '30–60 s, más si la técnica se resiente',
  health: '60–90 s, lo que necesites para hacer la siguiente serie bien',
}

function formatSeconds(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  if (s < 60) return `${s} s`
  const m = Math.floor(s / 60)
  const r = s % 60
  return r ? `${m} min ${r} s` : `${m} min`
}

/** 'Abrir los codos' → 'abrir los codos' (keeps acronyms like 'RIR'). */
function lowerFirst(s: string): string {
  const t = s.trim().replace(/[.。]+$/, '')
  if (t.length > 1 && t[1] === t[1].toUpperCase() && t[1] !== t[1].toLowerCase()) return t
  return t.charAt(0).toLowerCase() + t.slice(1)
}

const bullet = (s: string) => `• ${s.trim().replace(/\.$/, '')}.`

function lines(...items: (string | null | undefined | false)[]): string {
  return items
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .slice(0, MAX_LINES)
    .join('\n')
}

function alternativeNames(ex: Exercise, profile: Profile | undefined, limit: number): string[] {
  const pool = EXERCISES.some((e) => e.id === ex.id) ? EXERCISES : [...EXERCISES, ex]
  return alternatives(ex.id, pool, profile?.equipment, limit).map((e) => e.name)
}

function answerPain(ex: Exercise | undefined): string {
  return lines(
    'Si sientes dolor agudo, punzante o en una articulación, detén la serie ahora.',
    bullet('No entrenes a través del dolor: baja el peso, acorta el rango o cambia a una variante que no moleste'),
    bullet('Una molestia muscular leve y difusa suele ser normal; hinchazón, hormigueo o dolor que empeora no lo son'),
    ex?.mistakes[0] ? bullet(`Revisa la técnica; un error común aquí es ${lowerFirst(ex.mistakes[0])}`) : null,
    bullet('Si persiste unos días o fue un tirón fuerte, consulta a un profesional (médico o fisioterapeuta)'),
  )
}

function answerSoreness(): string {
  return lines(
    'Las agujetas son normales tras un estímulo nuevo y suelen pasar en 2–4 días.',
    bullet('Puedes entrenar: calienta bien y usa cargas moderadas; moverte suave ayuda'),
    bullet('Si un músculo está muy adolorido, hoy entrena otro grupo'),
    bullet('Duerme bien, hidrátate y come suficiente proteína'),
    bullet('Si el dolor es agudo, en una articulación o no mejora en una semana, consulta a un profesional'),
  )
}

function answerBreathing(ex: Exercise | undefined): string {
  return lines(
    ex?.breathing ? `${ex.name}: ${ex.breathing}` : 'Regla general: suelta el aire en el esfuerzo y tómalo en la fase fácil.',
    ex?.breathing ? bullet('Regla general: suelta el aire en el esfuerzo y tómalo en la fase fácil') : null,
    ex?.isCompound || !ex
      ? bullet('En básicos pesados, toma aire y aprieta el abdomen antes de cada rep (como si fueran a empujarte)')
      : null,
    bullet('No aguantes la respiración varias reps seguidas'),
    bullet('Si te mareas, para, siéntate y respira con calma'),
  )
}

function answerMistakes(ex: Exercise | undefined): string {
  if (!ex || !ex.mistakes.length) {
    return lines(
      'Errores frecuentes en el gym:',
      bullet('Usar más peso del que puedes controlar y acortar el recorrido'),
      bullet('Rebotar o usar impulso en vez de controlar la bajada'),
      bullet('Saltarse el calentamiento'),
      bullet('Grábate de lado con el celular para revisar tu técnica'),
    )
  }
  return lines(
    `Errores comunes en ${ex.name}:`,
    ...ex.mistakes.slice(0, 4).map(bullet),
    ex.mistakes.length < 4 ? bullet('Grábate de lado con el celular para revisarte') : null,
  )
}

function answerTechnique(ex: Exercise | undefined): string {
  if (!ex) {
    return lines(
      'Claves de técnica para cualquier ejercicio:',
      bullet('Controla la bajada (2–3 s) y sube con intención'),
      bullet('Usa todo el rango que puedas controlar sin dolor'),
      bullet('Mantén el abdomen firme y la espalda neutra'),
      bullet('Elige un peso que te permita hacer todas las reps con buena forma'),
    )
  }
  const setup = ex.setup.slice(0, 2).map((s) => bullet(s))
  const cues = ex.cues.slice(0, MAX_LINES - 1 - setup.length).map(bullet)
  return lines(`Así se hace ${ex.name}:`, ...setup, ...cues)
}

function answerAlternatives(ex: Exercise | undefined, profile: Profile | undefined): string {
  if (!ex) {
    return lines(
      'Para elegir una alternativa, busca un ejercicio que trabaje el mismo músculo con el material que tengas libre.',
      bullet('Máquina ocupada: usa mancuernas o polea para el mismo movimiento'),
      bullet('Sin material: hay variantes con peso corporal o banda para casi todo'),
      bullet('Abre la técnica del ejercicio y toca «Cambiar» para ver opciones'),
    )
  }
  const names = alternativeNames(ex, profile, 3)
  if (!names.length) {
    return lines(
      `No encontré una alternativa directa a ${ex.name} con tu material.`,
      bullet(`Busca otro ejercicio de ${(MUSCLE_LABEL[ex.primary] ?? ex.primary).toLowerCase()} en la biblioteca`),
    )
  }
  return lines(
    `Alternativas a ${ex.name} que trabajan lo mismo:`,
    ...names.map(bullet),
    bullet('Toca «Cambiar» para reemplazarlo en tu sesión'),
  )
}

function answerWarmup(ex: Exercise | undefined): string {
  const heavy = !ex || (ex.kind === 'weight_reps' && ex.isCompound)
  return lines(
    'Calentamiento rápido y efectivo:',
    bullet('5 min de cardio suave para subir la temperatura'),
    bullet('Movilidad de las articulaciones que vas a usar'),
    heavy
      ? bullet('2–3 series de aproximación: 50% × 8, 70% × 5 y 85% × 2–3 de tu peso de trabajo')
      : bullet('Una serie ligera de 12–15 reps basta'),
    bullet('Las series de calentamiento no deben cansarte'),
  )
}

function answerRest(ex: Exercise | undefined, goal: Goal | undefined): string {
  return lines(
    ex ? `Para ${ex.name}, descansa unos ${formatSeconds(ex.defaultRestSec)} entre series.` : null,
    goal
      ? bullet(`Para ${GOAL_LABEL[goal]}: ${REST_BY_GOAL[goal]}`)
      : bullet('Fuerza: 2–3 min en básicos. Músculo: 60–120 s. Resistencia: 30–60 s'),
    bullet('Si no llegas a las reps objetivo, descansa un poco más'),
    bullet('Ajusta el temporizador con −15 s / +15 s o salta el descanso cuando estés listo'),
  )
}

function answerWeight(ex: Exercise | undefined): string {
  if (ex?.kind === 'reps') {
    return lines(
      `${ex.name} se hace con tu peso corporal.`,
      bullet('Si haces más reps de las objetivo con facilidad, añade lastre o una variante más difícil'),
      bullet('Si no llegas al mínimo, usa una variante asistida (banda o máquina)'),
      bullet('Deja 1–3 reps en reserva al terminar cada serie'),
    )
  }
  if (ex?.kind === 'time') {
    return lines(
      `${ex.name} se mide por tiempo.`,
      bullet('Elige una duración que puedas mantener con buena forma, dejando unos segundos de reserva'),
      bullet('Cuando sea fácil, añade 5–10 s o una variante más difícil'),
    )
  }
  const inc = ex ? `${ex.increment} kg` : '2–5 kg'
  return lines(
    'Usa un peso con el que completes las reps objetivo dejando 1–3 reps en reserva.',
    bullet(`Si es tu primera vez, empieza ligero y sube ${inc} por serie hasta llegar a ese punto`),
    bullet(`Si completas todas las series en el tope del rango, sube ${inc} la próxima vez`),
    bullet('Si la técnica se rompe, el peso es demasiado alto'),
    bullet('La app te propone el peso según tu última sesión'),
  )
}

function answerReps(ex: Exercise | undefined, goal: Goal | undefined, level: Level | undefined): string {
  if (ex?.kind === 'time') {
    return lines(
      `Para ${ex.name}: 3 series de 20–60 s con buena forma.`,
      bullet('Descansa lo suficiente para mantener la postura en cada serie'),
      bullet('Cuando sea fácil, suma 5–10 s'),
    )
  }
  const g = goal ?? 'muscle'
  return lines(
    goal ? `Para ${GOAL_LABEL[g]}: ${REPS_BY_GOAL[g]}.` : `Lo más versátil: ${REPS_BY_GOAL.muscle}.`,
    bullet('Termina cada serie con 1–3 reps en reserva; la última puede ir más cerca del fallo'),
    level === 'beginner' || !level
      ? bullet('Si empiezas: unas 10 series por músculo a la semana es una gran base')
      : bullet('Avanzado: 10–20 series por músculo a la semana, según cómo te recuperes'),
    bullet('Sigue el objetivo que marca tu rutina; la app cuenta series y reps por ti'),
  )
}

function answerProgression(ex: Exercise | undefined, level: Level | undefined): string {
  const inc = ex?.kind === 'weight_reps' ? `${ex.increment} kg` : 'un poco de peso o reps'
  return lines(
    `Progresión doble: cuando hagas todas las series en el tope del rango, sube ${inc} y vuelve al mínimo de reps.`,
    level === 'beginner' ? bullet('Al empezar puedes progresar casi cada sesión') : null,
    bullet('¿Estancado 2–3 sesiones? Revisa sueño y comida, baja un 10% y vuelve a subir'),
    bullet('Registra cada serie: en Progreso verás la tendencia'),
    bullet('La constancia gana: 3–4 entrenos por semana superan a uno perfecto'),
  )
}

function answerGeneral(ex: Exercise | undefined): string {
  if (ex) {
    return lines(
      `Sobre ${ex.name}:`,
      ...ex.cues.slice(0, 2).map(bullet),
      'Pregúntame por técnica, respiración, errores, peso, reps, descanso o alternativas.',
    )
  }
  return lines(
    'Puedo ayudarte con técnica, respiración, errores comunes, cuánto peso usar, reps y series, descanso, calentamiento, alternativas, agujetas o cómo progresar.',
    'Por ejemplo: «¿Cuánto descanso entre series?»',
  )
}

/**
 * Offline answer (pure): detects the intent by keywords and answers with the exercise's own
 * technique data when available. ≤ 6 short lines. Pain/injury questions always recommend
 * stopping and consulting a professional.
 */
export function localAnswer(question: string, ctx: CoachContext = {}): string {
  const ex = ctx.exercise
  const goal = ctx.profile?.goal
  const level = ctx.profile?.level
  switch (detectIntent(question)) {
    case 'soreness':
      return answerSoreness()
    case 'pain':
      return answerPain(ex)
    case 'breathing':
      return answerBreathing(ex)
    case 'mistakes':
      return answerMistakes(ex)
    case 'alternatives':
      return answerAlternatives(ex, ctx.profile)
    case 'warmup':
      return answerWarmup(ex)
    case 'rest':
      return answerRest(ex, goal)
    case 'progression':
      return answerProgression(ex, level)
    case 'weight':
      return answerWeight(ex)
    case 'reps':
      return answerReps(ex, goal, level)
    case 'technique':
      return answerTechnique(ex)
    case 'general':
      return answerGeneral(ex)
  }
}
