/**
 * LOCAL INTENT ROUTER — free, offline, instant. `handleLocally(text, ctx)` turns clear commands and simple
 * questions into tool calls (executed by run.ts with origin 'local') plus an optional ready-made reply.
 * Anything ambiguous or open-ended returns { handled: false } and falls through to the AI.
 *
 * `reply: ''` means "use the summaries of the executed tools". Rules run in a fixed order: specific
 * phrases first, the loose set/command parser last (and only for short, non-question utterances).
 */
import type { Exercise, MuscleGroup, Unit, VoiceContext, WorkoutSession } from '../types'
import { useApp, getExercise, allExercises, selectRoutines } from '@/store/app'
import { getCursorInfo } from '../workout/engine'
import { normalizeText as norm, parseUtterance, parsedToLogInput, wordsToNumber, formatSeconds as fmtVoiceSeconds } from '../voice/parse'
import { detectIntent, localAnswer } from '../coach'
import { alternatives } from '../recommend'
import { convertWeight, formatWeight } from '../units'
import { uid } from '../id'
import { resolveExerciseQuery, clean } from './tools'
import type { AgentContext, LocalResult, ToolCall } from './types'

/* ================================================================ small helpers */

const st = () => useApp.getState()
const call = (name: string, args: Record<string, unknown> = {}, explicit = false): ToolCall => ({
  id: uid('l_'),
  name,
  args,
  ...(explicit ? { explicit: true } : {}),
})
const say = (reply: string): LocalResult => ({ handled: true, actions: [], reply })
const run = (actions: ToolCall[], reply = ''): LocalResult => ({ handled: true, actions, reply })

interface C {
  raw: string
  n: string
  tokens: string[]
  isQuestion: boolean
  ctx: AgentContext
}

const QUESTION_START = /^(que|cual|cuales|cuanto|cuanta|cuantos|cuantas|como|por que|porque|donde|cuando|quien|puedo|debo|deberia|conviene|sirve)\b/

const NO_SESSION = 'No hay un entreno en curso. Empieza uno y dime tus series (por ejemplo «80 por 10»).'

/* ---------------- number / duration extraction ---------------- */

const isDigits = (t: string) => /^\d+(\.\d+)?$/.test(t)

/** Number ending right before index `end` (exclusive): digits or up to 4 number words. */
function numberBefore(tokens: string[], end: number): number | null {
  if (end <= 0) return null
  if (isDigits(tokens[end - 1])) return Number(tokens[end - 1])
  for (let len = 4; len >= 1; len--) {
    if (end - len < 0) continue
    const v = wordsToNumber(tokens.slice(end - len, end).join(' '))
    if (v !== null && v !== undefined) return v
  }
  return null
}

/** First number starting at/after `from` (skipping up to `skip` filler tokens). */
function numberAfter(tokens: string[], from: number, fillers: Set<string>, skip = 4): number | null {
  for (let i = from; i < tokens.length && i <= from + skip; i++) {
    const t = tokens[i]
    if (isDigits(t)) return Number(t)
    for (let len = 4; len >= 1; len--) {
      if (i + len > tokens.length) continue
      const v = wordsToNumber(tokens.slice(i, i + len).join(' '))
      if (v !== null && v !== undefined) return v
    }
    if (!fillers.has(t)) return null
  }
  return null
}

const MIN_UNITS = new Set(['minuto', 'minutos', 'min', 'mins'])
const SEC_UNITS = new Set(['segundo', 'segundos', 'seg', 'segs'])

/** "2 minutos", "90 segundos", "1 minuto 30", "minuto y medio", "dos minutos y medio" → seconds. */
export function findDuration(n: string): number | null {
  const tokens = n.split(' ')
  let total = 0
  let found = false
  tokens.forEach((t, i) => {
    const isMin = MIN_UNITS.has(t)
    if (!isMin && !SEC_UNITS.has(t)) return
    const v = numberBefore(tokens, i)
    if (isMin) {
      if (v === null && tokens[i + 1] === 'y' && (tokens[i + 2] === 'medio' || tokens[i + 2] === 'media')) {
        total += 90
        found = true
        return
      }
      if (v === null) return
      total += v * 60
      if (tokens[i + 1] === 'y' && (tokens[i + 2] === 'medio' || tokens[i + 2] === 'media')) total += 30
    } else {
      if (v === null) return
      total += v
    }
    found = true
  })
  return found && total > 0 ? Math.round(total) : null
}

/* ---------------- exercise lookup in free text ---------------- */

const nameCache = new WeakMap<Exercise, string[]>()
function namesOf(ex: Exercise): string[] {
  let v = nameCache.get(ex)
  if (!v) {
    v = [ex.name, ...ex.aliases].map(norm).filter((s) => s.length >= 4)
    nameCache.set(ex, v)
  }
  return v
}

/** Longest exercise name/alias that appears in the text (word boundaries, optional plural). */
export function findExerciseIn(n: string): Exercise | undefined {
  const hay = ` ${n} `
  let best: Exercise | undefined
  let bestLen = 0
  for (const ex of allExercises()) {
    for (const name of namesOf(ex)) {
      if (name.length <= bestLen) continue
      if (hay.includes(` ${name} `) || hay.includes(` ${name}s `) || hay.includes(` ${name}es `)) {
        best = ex
        bestLen = name.length
      }
    }
  }
  return best
}

/** Exercise named in the text: exact mention, else the phrase after "en/de/sobre". */
function exerciseFromText(n: string): Exercise | undefined {
  const direct = findExerciseIn(n)
  if (direct) return direct
  const m = /\b(?:en|de|del|sobre|con|para)\s+(?:el |la |los |las |mi |mis )?([a-z0-9 ]{4,40})$/.exec(n)
  if (!m) return undefined
  const r = resolveExerciseQuery(m[1])
  return r.kind === 'one' ? r.ex : r.kind === 'many' ? r.candidates[0] : undefined
}

const MUSCLE_WORDS: [RegExp, MuscleGroup][] = [
  [/\bpecho\b/, 'chest'],
  [/\bespalda\b/, 'back'],
  [/\bhombros?\b/, 'shoulders'],
  [/\bbiceps\b/, 'biceps'],
  [/\btriceps\b/, 'triceps'],
  [/\bantebrazos?\b/, 'forearms'],
  [/\b(cuadriceps|piernas?)\b/, 'quads'],
  [/\b(isquios?|isquiotibiales|femorales?)\b/, 'hamstrings'],
  [/\bgluteos?\b/, 'glutes'],
  [/\b(gemelos?|pantorrillas?)\b/, 'calves'],
  [/\b(abdominales|abdomen|core)\b/, 'core'],
]
const muscleIn = (n: string): MuscleGroup | undefined => MUSCLE_WORDS.find(([re]) => re.test(n))?.[1]

/* ---------------- workout state helpers ---------------- */

function currentExercise(c: C): Exercise | undefined {
  if (c.ctx.exerciseId) {
    const e = getExercise(c.ctx.exerciseId)
    if (e) return e
  }
  const s = st().activeSession
  const cur = s ? getCursorInfo(s).exercise : null
  return cur ? getExercise(cur.exerciseId) : undefined
}

function voiceContext(s: WorkoutSession): VoiceContext {
  const info = getCursorInfo(s)
  const set = info.exercise?.sets[info.setIndex]
  const ex = info.exercise ? getExercise(info.exercise.exerciseId) : undefined
  return { lastWeight: set?.weight ?? null, lastReps: set?.reps ?? null, unit: s.unit, kind: ex?.kind ?? 'weight_reps' }
}

function lastDoneSet(s: WorkoutSession) {
  const info = getCursorInfo(s)
  let best: { weight: number | null; reps: number | null; seconds?: number | null; t: number } | null = null
  for (const x of info.exercise?.sets ?? []) {
    if (x.done && (!best || (x.completedAt ?? 0) >= best.t)) best = { weight: x.weight, reps: x.reps, seconds: x.seconds, t: x.completedAt ?? 0 }
  }
  return best
}

/* ---------------- alternatives offer (so "la 2" works next) ---------------- */

type Offer = { kind: 'swap' | 'add'; ids: string[]; at: number }
let offered: Offer | null = null
const OFFER_TTL_MS = 3 * 60_000

/** Test helper. */
export function __resetLocalForTests(): void {
  offered = null
}

function offerAlternatives(c: C): LocalResult {
  const s = st().activeSession
  if (!s) return say(NO_SESSION)
  const cur = getCursorInfo(s).exercise
  if (!cur) return say('Este entreno no tiene ejercicios todavía.')
  const inSession = new Set(s.exercises.map((e) => e.exerciseId))
  const alts = alternatives(cur.exerciseId, allExercises(), st().profile.equipment ?? st().plan?.equipment, 8)
    .filter((e) => !inSession.has(e.id))
    .slice(0, 3)
  const name = clean(getExercise(cur.exerciseId)?.name) || 'este ejercicio'
  if (!alts.length) return say(`No encontré alternativas a ${name} con tu equipo.`)
  offered = { kind: 'swap', ids: alts.map((e) => e.id), at: Date.now() }
  void c
  return say(`Alternativas a ${name}:\n${alts.map((e, i) => `${i + 1}. ${clean(e.name)}`).join('\n')}\nDime cuál (por ejemplo «la 2») y lo cambio.`)
}

function offerCandidates(kind: 'swap' | 'add', list: Exercise[]): LocalResult {
  offered = { kind, ids: list.map((e) => e.id), at: Date.now() }
  return say(`¿Cuál de estos?\n${list.map((e, i) => `${i + 1}. ${clean(e.name)}`).join('\n')}\nDime el número y lo ${kind === 'swap' ? 'cambio' : 'añado'}.`)
}

const ORDINALS: Record<string, number> = {
  '1': 1, uno: 1, primero: 1, primera: 1, '2': 2, dos: 2, segundo: 2, segunda: 2, '3': 3, tres: 3, tercero: 3, tercera: 3,
  '4': 4, cuatro: 4, cuarto: 4, cuarta: 4, '5': 5, cinco: 5,
}

function ruleOffered(c: C): LocalResult | null {
  if (!offered || Date.now() - offered.at > OFFER_TTL_MS) return null
  const m = /^(?:por favor )?(?:el |la |opcion |la opcion |el numero |numero |la numero )?(\d|uno|dos|tres|cuatro|cinco|primero|primera|segundo|segunda|tercero|tercera|cuarto|cuarta)(?: por favor| gracias)?$/.exec(c.n)
  const idx = m ? ORDINALS[m[1]] : /^(ese|esa|el primero|la primera)$/.test(c.n) ? 1 : 0
  if (!idx) return null
  const id = offered.ids[idx - 1]
  if (!id) return say(`Solo te ofrecí ${offered.ids.length} opciones.`)
  const kind = offered.kind
  offered = null
  return kind === 'swap' ? run([call('swap_exercise', { to_exercise_id: id })]) : run([call('add_exercise', { query: id })])
}

/* ================================================================ rules */

const HELP =
  'Puedo registrar tus series («80 por 10»), moverte en el entreno («siguiente», «deshacer», «descanso»), cambiar o añadir ejercicios, decirte qué toca hoy, cómo vas en un ejercicio, guardar tu peso y resolver dudas de técnica.'

function ruleSmallTalk(c: C): LocalResult | null {
  if (c.tokens.length <= 3 && /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|ey|que tal|hola que tal)$/.test(c.n)) {
    return say('¡Hola! Dime «80 por 10» para registrar una serie o pregúntame lo que necesites.')
  }
  if (c.tokens.length <= 5 && /^(muchas |ok |vale |genial |perfecto )?gracias/.test(c.n)) return say('¡De nada! A darle.')
  if (c.tokens.length <= 7 && /\b(ayuda|que puedes hacer|que sabes hacer|que haces|como funciona|como te uso)\b/.test(c.n)) return say(HELP)
  return null
}

/* ---------------- safety: always answered locally, deterministic, never by a model that might improvise ---------------- */

const SAFE_PREGNANCY =
  'Entrenar durante el embarazo o el posparto puede ser seguro, pero depende de tu caso. Consúltalo con tu médico u obstetra antes de empezar o cambiar tu rutina. Si sientes mareo, sangrado, dolor o falta de aire, detente y busca atención médica.'
const SAFE_EATING =
  'Gracias por contármelo. No puedo darte pautas de comida ni de peso en esto: si sientes que comes muy poco, compensas lo que comes o te castigas con el ejercicio, habla con un médico o un psicólogo. No estás solo y se puede mejorar con apoyo profesional.'
const SAFE_URGENT =
  'Detén el ejercicio ahora. El dolor en el pecho, el mareo fuerte, el desmayo o la falta de aire pueden ser urgentes: siéntate, avisa a alguien y busca atención médica. Si es intenso o no pasa, llama a emergencias.'
const SAFE_DRUGS = 'No te puedo orientar sobre esteroides, anabólicos ni fármacos para rendir. Habla con un médico; yo te ayudo con entrenamiento, descanso y hábitos.'

function ruleSafety(c: C): LocalResult | null {
  const { n } = c
  if (/\b(dolor (en el |de |del )?pecho|presion en el pecho|infarto|desmay\w*|me desvanezco|palpitaciones|me falta (el )?aire|no puedo respirar|mareo fuerte)\b/.test(n)) return say(SAFE_URGENT)
  if (/\b(embarazada|embarazo|gestacion|postparto|posparto|lactancia|estoy esperando)\b/.test(n)) return say(SAFE_PREGNANCY)
  if (/\b(anorexi\w*|bulimi\w*|atracon(es)?|purgarme|purgar|vomitar (para|despues)|provocarme el vomito|laxantes|castigarme (con|por)|compensar (lo que|la comida)|ayuno extremo)\b/.test(n) || /\b(no (he )?comido|dejar de comer|no comer|saltarme (las )?comidas|casi no como)\b.*\b(para|por) (bajar|adelgazar|perder|compensar|quemar)/.test(n)) return say(SAFE_EATING)
  if (/\b(esteroides?|anabolicos?|clembuterol|trembolona|testosterona|sarm|sarms|dopaje)\b/.test(n)) return say(SAFE_DRUGS)
  return null
}

const DATA_VERB = /\b(borra|borrar|borrame|elimina|eliminar|eliminame|resetea|resetear|reinicia|reiniciar|vacia|vaciar|limpia|limpiar)\b/
const DATA_NOUN = /\b(todo|todos|todas|historial|datos|entrenos|rutinas|progreso|cuenta|registros|app)\b/

/** The assistant never deletes data: it points to Perfil instead (whatever the wording, even when injected). */
function ruleNoDelete(c: C): LocalResult | null {
  if (!DATA_VERB.test(c.n) || !DATA_NOUN.test(c.n) || c.tokens.length > 12) return null
  return say('Por seguridad no borro datos desde el chat. Si quieres borrar o exportar tu información, hazlo desde Perfil.')
}

const SETTING_VERB = /\b(pon|poner|ponme|ponle|cambia|cambiar|cambiame|configura|ajusta|ajustar|establece|fija|deja|dejalo|predeterminado|por defecto|siempre)\b/
const START_NOW = /\b(ahora|ya|inicia|iniciar|empieza|empezar|arranca|arrancar|comienza|comenzar)\b/

function ruleSettings(c: C): LocalResult | null {
  const { n } = c
  if (c.isQuestion) return null
  if (/\bno\b/.test(n)) return null // negations ("ya no quiero sonidos") are ambiguous: let the AI ask
  // units: "cambia a libras", "usa kilos"
  if (!/\d/.test(n) && /\b(cambia|cambiar|cambiame|pon|ponme|usa|usar|pasa|pasar|pasalo|pasame|configura|quiero|prefiero|ponlo|dejalo|cambialo)\b/.test(n)) {
    const lb = /\b(libras?|lbs?)\b/.test(n)
    const kg = /\b(kilos?|kgs?|kilogramos?)\b/.test(n)
    if (lb !== kg) return run([call('set_setting', { key: 'unit', value: lb ? 'lb' : 'kg' }, true)])
  }
  // default rest vs rest now
  if (/\bdescans(o|ar|a|e)\b/.test(n) || (/\b(pon|ponme|ponle)\b/.test(n) && /\bde descanso\b/.test(n))) {
    const dur = findDuration(n)
    if (dur) {
      const asDefault = /\b(por defecto|predeterminado|siempre|a partir de ahora|default)\b/.test(n)
      // during a workout "ponme 2 minutos de descanso" means a rest now, unless they say it is the default
      if (SETTING_VERB.test(n) && !START_NOW.test(n) && (asDefault || !st().activeSession)) return run([call('set_setting', { key: 'defaultRestSec', value: String(dur) }, true)])
      return run([call('start_rest', { seconds: dur })])
    }
  }
  // toggles
  const on = /\b(activa|activar|enciende|encender|prende|prender|habilita|habilitar|pon|ponme|quiero)\b/.test(n)
  const off = /\b(desactiva|desactivar|apaga|apagar|quita|quitar|silencia|silenciar|deshabilita|deshabilitar|sin)\b/.test(n)
  if (on !== off) {
    const value = String(on)
    if (/\b(sonidos?|beeps?|pitidos?)\b/.test(n)) return run([call('set_setting', { key: 'sounds', value }, true)])
    if (/\b(vibracion|vibrar|vibra)\b/.test(n)) return run([call('set_setting', { key: 'vibration', value }, true)])
    if (/\b(voz|anuncios?|avisos?|audio)\b/.test(n)) return run([call('set_setting', { key: 'voiceAnnouncements', value }, true)])
    if (/\b(descanso automatico|inicio automatico|autodescanso|descanso solo)\b/.test(n)) return run([call('set_setting', { key: 'autoStartRest', value }, true)])
  }
  return null
}

const BODY_VERB = /\b(registra|registrar|registre|anota|anotar|apunta|apuntar|guarda|guardar|actualiza|actualizar)\b/
const BODY_FILLER = new Set(['es', 'de', 'en', 'a', 'esta', 'hoy', 'corporal', 'mi', 'del', 'la', 'el', 'fue', 'son', 'marca', 'pesa', 'kilos', 'kg', 'libras', 'lb', 'lbs', 'cm', 'por', 'ciento', 'porciento', 'un', 'de', 'ahora', 'actual'])
const BODY_WORDS: [string, RegExp][] = [
  ['weight', /^(peso|pese|pesaba)$/],
  ['body_fat', /^grasa$/],
  ['waist', /^cintura$/],
  ['hips', /^(cadera|caderas)$/],
  ['chest', /^pecho$/],
  ['arm', /^(brazo|biceps)$/],
  ['thigh', /^muslo$/],
  ['neck', /^cuello$/],
]

function ruleBody(c: C): LocalResult | null {
  const { n, tokens } = c
  const gate = BODY_VERB.test(n) || /\bmi (peso|grasa|cintura|cadera|brazo|muslo|cuello|pecho)\b/.test(n) || /\b(me pese|me peso|pese|pesaje|peso corporal)\b/.test(n)
  if (!gate || c.isQuestion) return null
  // "pesé 80 por 10" in a workout is a set, not a weigh-in
  if (st().activeSession && !BODY_VERB.test(n) && /\b\d+\s*(por|x)\s*\d+\b/.test(n)) return null
  const args: Record<string, unknown> = {}
  tokens.forEach((t, i) => {
    for (const [key, re] of BODY_WORDS) {
      if (!re.test(t) || args[key] !== undefined) continue
      const v = numberAfter(tokens, i + 1, BODY_FILLER)
      if (v !== null) args[key] = v
    }
  })
  if (!Object.keys(args).length) return null
  const bodyWeight = args.weight
  if (typeof bodyWeight === 'number') {
    const unit: Unit = st().settings.unit
    const lb = /\b(libras?|lbs?)\b/.test(n)
    const kg = /\b(kilos?|kgs?|kilogramos?)\b/.test(n)
    if (lb && unit === 'kg') args.weight = Math.round(convertWeight(bodyWeight, 'lb', 'kg') * 10) / 10
    if (kg && unit === 'lb') args.weight = Math.round(convertWeight(bodyWeight, 'kg', 'lb') * 10) / 10
  }
  return run([call('log_body_metrics', args)])
}

function ruleRestLeft(c: C): LocalResult | null {
  const { n } = c
  if (!/\b(descanso|tiempo|falta|queda|quedan|faltan)\b/.test(n)) return null
  if (!/\b(cuanto|cuantos|cuanta|que tanto)\b/.test(n) || !/\b(me queda|me quedan|queda|quedan|falta|faltan|me resta)\b/.test(n)) return null
  const s = st().activeSession
  if (!s) return say(NO_SESSION)
  if (!s.rest) return say('No hay un descanso en curso.')
  const left = Math.max(0, Math.ceil((s.rest.endsAt - Date.now()) / 1000))
  return say(left > 0 ? `Te quedan ${fmtVoiceSeconds(left)} de descanso.` : 'El descanso ya terminó. ¡A la siguiente serie!')
}

function ruleRemaining(c: C): LocalResult | null {
  const { n } = c
  if (!/\bcuantas series\b.*\b(faltan|quedan|llevo|me falta)\b/.test(n) && !/\b(cuanto (me )?falta para terminar|cuantas me faltan)\b/.test(n)) return null
  const s = st().activeSession
  if (!s) return null
  const info = getCursorInfo(s)
  const left = Math.max(0, info.totalSessionSets - info.doneSets)
  return say(left > 0 ? `Llevas ${info.doneSets} de ${info.totalSessionSets} series; te ${left === 1 ? 'falta 1' : `faltan ${left}`}.` : 'Ya hiciste todas las series. Dime «terminar entreno» para guardarlo.')
}

/** "súmale 30", "quítale 15 segundos", "dame 2 minutos" while resting; "dame 2 minutos" otherwise starts a rest. */
function ruleRestAdjust(c: C): LocalResult | null {
  const s = st().activeSession
  if (!s || c.isQuestion) return null
  const m = /^(?:por favor |oye )?(suma|sumale|sumame|agrega|agregale|anade|anadele|ponle|dame|dale|mas|quita|quitale|resta|restale|menos)\s+(.+?)(\s+mas)?$/.exec(c.n)
  if (!m) return null
  const neg = /^(quita|quitale|resta|restale|menos)$/.test(m[1])
  let secs = findDuration(m[2])
  const bare = /^\d{1,3}$/.test(m[2]) ? Number(m[2]) : null
  if (!secs && bare !== null && bare >= 5 && bare <= 300 && s.rest) secs = bare
  if (!secs) return null
  if (s.rest) return run([call('adjust_rest', { delta_seconds: Math.min(300, secs) * (neg ? -1 : 1) })])
  if (neg) return null
  return /^(dame|ponle|dale)$/.test(m[1]) && !m[3] ? run([call('start_rest', { seconds: secs })]) : null
}

function describeNow(s: WorkoutSession): string {
  const info = getCursorInfo(s)
  if (info.isFinished) return 'Ya terminaste todas las series. Dime «terminar entreno» para guardarlo.'
  const ex = info.exercise ? getExercise(info.exercise.exerciseId) : undefined
  const set = info.exercise?.sets[info.setIndex]
  const target = set?.weight ? ` (${formatWeight(set.weight)} ${s.unit}${set.reps ? ` × ${set.reps}` : ''})` : set?.reps ? ` (${set.reps} reps)` : ''
  let line = `${s.rest ? 'Después del descanso' : 'Ahora'}: ${clean(ex?.name) || 'ejercicio'}, serie ${info.setNumber} de ${info.totalSets}${target}.`
  if (info.next) {
    const nx = getExercise(info.next.exercise.exerciseId)
    line += info.isLastSetOfExercise ? ` Luego: ${clean(nx?.name) || 'siguiente ejercicio'}.` : ` Luego: serie ${info.next.setIndex + 1}.`
  }
  return line
}

function ruleNext(c: C): LocalResult | null {
  const { n } = c
  if (/^(que|cual) (sigue|viene|toca|es el siguiente|es lo siguiente|hay ahora|hago ahora|me toca ahora)\b/.test(n) && !/\b(hoy)\b/.test(n)) {
    const s = st().activeSession
    if (s) return say(describeNow(s))
    return run([call('get_next_workout')])
  }
  if (/^(cual es el siguiente|que ejercicio (sigue|viene|toca)|que viene despues|y luego|y despues)\b/.test(n)) {
    const s = st().activeSession
    return s ? say(describeNow(s)) : run([call('get_next_workout')])
  }
  // today's workout
  if (
    (/\bhoy\b/.test(n) && /\b(entreno|entrenar|entrenamiento|rutina|toca|hago|corresponde|trabajo|ejercicios)\b/.test(n) && (c.isQuestion || /^(dime|dame|muestrame|y)\b/.test(n))) ||
    /\b(que (me )?toca|que rutina (me )?toca|mi entreno de hoy|entreno de hoy)\b/.test(n)
  ) {
    return run([call('get_next_workout')])
  }
  // bare "let's go" while idle
  if (!st().activeSession && /^(empezamos|empecemos|comencemos|arranquemos|vamos a darle|a darle|quiero entrenar|quiero empezar|vamos a entrenar|a entrenar)$/.test(n)) {
    return run([call('start_workout', {})])
  }
  // start a workout
  if (/\b(empieza|empezar|empecemos|inicia|iniciar|comienza|comenzar|arranca|arrancar|vamos a|a entrenar)\b/.test(n) && /\b(entreno|entrenamiento|rutina|entrenar|workout|sesion)\b/.test(n) && !c.isQuestion) {
    if (st().activeSession) return say('Ya tienes un entreno en curso.')
    if (/\blibre\b/.test(n)) return run([call('start_workout', { free: true })])
    const named = selectRoutines(st()).find((r) => {
      const rn = norm(r.name)
      return rn.length >= 3 && ` ${n} `.includes(` ${rn} `)
    })
    return run([call('start_workout', named ? { routine_id: named.id } : {})])
  }
  return null
}

const PROGRESS_RE = /\b(como voy|como vengo|como me va|mi progreso|progreso|record|records|prs?|maximo|1rm|e1rm|evolucion|racha|cuantos entrenos|cuantas sesiones|cuantas veces (entrene|he entrenado|fui|he ido)|cuantos dias (entrene|he entrenado|fui)|estadisticas|cuanto levanto|cuanto levante|cuanto cargo|cuanto puedo levantar|historial)\b/
const NAV_VERB = /^(?:por favor |ok |oye )*(ve|vete|ir|vamos|llevame|abre|abrir|abreme|muestrame|mostrar|ensename|quiero ver|quiero ir|ver)\b/

function periodIn(n: string): string | undefined {
  if (/\b(3 meses|tres meses|trimestre)\b/.test(n)) return '3months'
  if (/\b(este ano|ultimo ano|un ano|ano)\b/.test(n)) return 'year'
  if (/\b(este mes|ultimo mes|mes)\b/.test(n)) return 'month'
  if (/\b(esta semana|semana)\b/.test(n)) return 'week'
  if (/\b(todo|siempre|historico)\b/.test(n)) return 'all'
  return undefined
}

function ruleProgress(c: C): LocalResult | null {
  const { n } = c
  if (!PROGRESS_RE.test(n)) return null
  const period = periodIn(n)
  const withPeriod = (a: Record<string, unknown>) => (period ? { ...a, period } : a)
  const ex = exerciseFromText(n)
  if (ex) return run([call('get_progress', withPeriod({ exercise_id: ex.id }))])
  const m = muscleIn(n)
  if (m) return run([call('get_progress', withPeriod({ muscle: m }))])
  if (NAV_VERB.test(n) && /\b(progreso|estadisticas|historial)\b/.test(n)) return run([call('navigate', { route: '/progress' })])
  return run([call('get_progress', withPeriod({}))])
}

function ruleUndoPhrases(c: C): LocalResult | null {
  if (!/^(?:por favor )?(quita|borra|elimina|anula|cancela|deshaz|corrige)(?:me)? (la |esa |mi )?(ultima |anterior )?(serie|repeticion|registro)( anterior)?$/.test(c.n)) return null
  return st().activeSession ? run([call('undo_last_set')]) : say(NO_SESSION)
}

function ruleSwap(c: C): LocalResult | null {
  const { n } = c
  // "cámbialo por X" / "cambia a X" / "sustituye por X"
  const m = /\b(cambia|cambiar|cambialo|cambiame|sustituye|sustituyelo|reemplaza|reemplazalo|remplaza|intercambia)\b(?: (?:este|ese|el|esto|ejercicio|ahora))*\s+(?:por|con|a)\s+(?:el |la |un |una |uno |el ejercicio )?(.+)$/.exec(n)
  if (m && !/\b(libras?|lbs?|kilos?|kgs?)\b/.test(m[2])) {
    const s = st().activeSession
    if (!s) return say(NO_SESSION)
    if (/^(otro|otra|algo parecido|uno parecido|una alternativa|alternativa|algo similar|uno similar)$/.test(m[2])) return run([call('swap_exercise', {})])
    const r = resolveExerciseQuery(m[2])
    if (r.kind === 'one') return run([call('swap_exercise', { to_exercise_id: r.ex.id })])
    if (r.kind === 'many') return offerCandidates('swap', r.candidates.slice(0, 4))
    return say(`No encontré «${clean(m[2], 40)}» en la biblioteca.`)
  }
  if (
    /^(cambiar|cambia|cambiame|cambialo|sustituye|otro|otra)( (este|el|ese|esto))?( ejercicio)?$/.test(n) ||
    /\b(cambia|cambiar|cambiame|cambialo)\b.*\b(este|ese|esto)\b/.test(n) ||
    /\b(otro ejercicio|una alternativa|alternativas?|algo parecido|algo similar)\b/.test(n) ||
    /\bno puedo hacer (este|esto|ese)\b/.test(n) ||
    /\b(no (hay|tengo|esta)|esta ocupad[oa])\b.*\b(maquina|equipo|barra|mancuernas?|banco|polea|rack)\b/.test(n)
  ) {
    if (c.isQuestion && !/\b(cambia|cambiar|alternativ)/.test(n)) return null
    return offerAlternatives(c)
  }
  return null
}

const ADD_RE =
  /^(?:(?:por favor|oye|ok|quiero|quisiera|necesito|puedes|podrias|me puedes|me podrias|ahora)\s+)*(?:anade|anadir|anademe|anadele|agrega|agregar|agregame|agregale|mete|metele|suma|sumar|incluye|incluir|pon|ponme|ponle)\s+(?:(?:un|una|el|la|otro|otra|mas|ejercicio|ejercicios|de|al entreno|a mi entreno)\s+)*(.+)$/
const NOT_EXERCISE = /\b(descanso|peso|kilos?|libras?|segundos?|minutos?|reps?|repeticiones|series?|sonido|vibracion)\b/

function ruleAdd(c: C): LocalResult | null {
  const m = ADD_RE.exec(c.n)
  if (!m) return null
  let q = m[1].replace(/\s+(al entreno|a mi entreno|a la rutina|al final|por favor|tambien)$/g, '').trim()
  q = q.replace(/\s+(al entreno|a mi entreno|por favor)$/g, '').trim()
  if (!q || /\d/.test(q) || NOT_EXERCISE.test(q) || q.split(' ').length > 6) return null
  const r = resolveExerciseQuery(q)
  if (r.kind === 'none') return null
  if (!st().activeSession) return say('Para añadir un ejercicio necesitas un entreno en curso. Empieza uno primero.')
  if (r.kind === 'one') return run([call('add_exercise', { query: r.ex.id })])
  return offerCandidates('add', r.candidates.slice(0, 4))
}

const NAV_TARGETS: [RegExp, string][] = [
  [/\b(progreso|estadisticas|historial|graficas?)\b/, '/progress'],
  [/\b(rutinas?|plan)\b/, '/routines'],
  [/\b(ejercicios|biblioteca)\b/, '/exercises'],
  [/\b(perfil|ajustes|configuracion)\b/, '/profile'],
  [/\b(inicio|home|hoy)\b/, '/'],
  [/\b(entreno|entrenamiento)\b/, '/workout'],
]

function ruleNavigate(c: C): LocalResult | null {
  if (!NAV_VERB.test(c.n) || c.tokens.length > 8) return null
  for (const [re, route] of NAV_TARGETS) if (re.test(c.n)) return run([call('navigate', { route })])
  return null
}

const TECH_WORDS = /\b(tecnica|como se hace|como hago|como lo hago|errores|respiracion|respirar|calentamiento|calentar|agujetas|duele|dolor|molestia|descansar entre|postura|agarre)\b/

function ruleCoach(c: C): LocalResult | null {
  if (c.tokens.length > 14) return null
  if (!(c.isQuestion || TECH_WORDS.test(c.n))) return null
  const intent = detectIntent(c.raw)
  if (intent === 'general') return null
  // long, specific questions are better answered by the AI (the pain/soreness safety answers always stay local)
  if (c.tokens.length > 9 && intent !== 'pain' && intent !== 'soreness') return null
  const profile = st().profile
  return say(localAnswer(c.raw, { exercise: currentExercise(c), profile }))
}

function ruleParser(c: C): LocalResult | null {
  if (c.isQuestion || c.tokens.length > 8) return null
  const s = st().activeSession
  const p = parseUtterance(c.raw, s ? voiceContext(s) : { lastWeight: null, lastReps: null, unit: st().settings.unit, kind: 'weight_reps' })
  if (p.type === 'unknown') return null

  if (p.type === 'command') {
    // loose command matching only for short utterances ("explícame la periodización…" is not a command)
    if (c.tokens.length > 5) return null
    if (!s) return c.tokens.length <= 2 ? say(NO_SESSION) : null
    const info = getCursorInfo(s)
    // "no quiero terminar el entreno" must never finish (or skip/undo) anything
    if (/\b(no|nunca|ni|todavia no|aun no)\b/.test(c.n) && (p.command === 'finish' || p.command === 'skip' || p.command === 'undo')) {
      return say('Entendido, lo dejo como está.')
    }
    switch (p.command) {
      case 'next':
        if (s.rest) return run([call('skip_rest')])
        if (info.isFinished) return say('Ya terminaste todas las series. Dime «terminar entreno» para guardarlo.')
        return run([call('log_set')])
      case 'repeat': {
        if (info.isFinished) return say('Ya terminaste todas las series.')
        const prev = lastDoneSet(s)
        const args: Record<string, unknown> = {}
        if (prev) {
          if (prev.weight != null) args.weight = prev.weight
          if (prev.reps != null) args.reps = prev.reps
          if (prev.seconds != null) args.seconds = prev.seconds
        }
        return run([call('log_set', args)])
      }
      case 'skip':
        return run([call('skip_exercise')])
      case 'undo':
        return run([call('undo_last_set')])
      case 'rest':
        return run([call('start_rest', p.seconds ? { seconds: p.seconds } : {})])
      case 'skip_rest':
        if (!s.rest) {
          if (/\b(hice|hecha|hecho|listo|lista|termine|esta)\b/.test(c.n) && !info.isFinished) return run([call('log_set')])
          return say('No hay un descanso en curso. Dime «80 por 10» para registrar la serie.')
        }
        return run([call('skip_rest')])
      case 'add_time':
        return run([call('adjust_rest', { delta_seconds: p.seconds ?? 30 })])
      case 'finish':
        // only a full phrase ("terminar entreno") skips the confirmation
        return run([call('finish_workout', {}, /\b(entreno|entrenamiento|sesion|workout)\b/.test(c.n))])
      case 'technique':
        return say(localAnswer('¿Cómo se hace este ejercicio? técnica', { exercise: currentExercise(c), profile: st().profile }))
      case 'swap':
        return offerAlternatives(c)
    }
    return null
  }

  // set
  if (p.confidence < 0.7 || (p.weight == null && p.reps == null && p.seconds == null)) return null
  if (!s) return c.tokens.length <= 5 ? say(NO_SESSION) : null
  const input = parsedToLogInput(p, s.unit, 'text')
  const args: Record<string, unknown> = {}
  if (input.weight != null) args.weight = input.weight
  if (input.reps != null) args.reps = input.reps
  if (input.seconds != null) args.seconds = input.seconds
  if (input.rpe != null) args.rpe = input.rpe
  return run([call('log_set', args)])
}

/* ================================================================ entry point */

const RULES: ((c: C) => LocalResult | null)[] = [
  ruleOffered,
  ruleSafety,
  ruleNoDelete,
  ruleSmallTalk,
  ruleRestAdjust,
  ruleUndoPhrases,
  ruleRemaining,
  ruleSettings,
  ruleBody,
  ruleRestLeft,
  ruleNext,
  ruleProgress,
  ruleSwap,
  ruleAdd,
  ruleNavigate,
  ruleCoach,
  ruleParser,
]

export function handleLocally(text: string, ctx: AgentContext = {}): LocalResult {
  try {
    const raw = (text ?? '').trim()
    if (!raw || raw.length > 200) return { handled: false }
    const n = norm(raw)
    if (!n) return { handled: false }
    const tokens = n.split(' ')
    if (tokens.length > 18) return { handled: false }
    const isQuestion = raw.includes('?') || raw.includes('¿') || QUESTION_START.test(n)
    const c: C = { raw, n, tokens, isQuestion, ctx }
    for (const rule of RULES) {
      const r = rule(c)
      if (r) return r
    }
  } catch {
    /* a router bug must never break the chat: fall through to the AI */
  }
  return { handled: false }
}

/** Spanish help text (also used by the offline fallback). */
export const LOCAL_HELP = HELP
