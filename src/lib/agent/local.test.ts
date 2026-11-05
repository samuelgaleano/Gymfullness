import { describe, expect, it } from 'vitest'
import { useApp } from '@/store/app'
import { handleLocally, findDuration } from './local'
import { resetStore, seedPlan, startPlanWorkout } from './testkit'
import type { LocalResult } from './types'

type State = 'idle' | 'workout' | 'rest'
/** [phrase, state, expected] — expected: tool name, `reply:<substring>` or null (falls through to the AI). */
type Row = [string, State, string | null, Record<string, unknown>?]

const TABLE: Row[] = [
  // --- logging sets
  ['80 por 10', 'workout', 'log_set', { weight: 80, reps: 10 }],
  ['ochenta kilos diez reps', 'workout', 'log_set', { weight: 80, reps: 10 }],
  ['80x8', 'workout', 'log_set', { weight: 80, reps: 8 }],
  ['12 reps', 'workout', 'log_set', { reps: 12 }],
  ['100 libras 5 reps', 'workout', 'log_set', { reps: 5 }],
  ['igual', 'workout', 'log_set'],
  ['siguiente', 'workout', 'log_set', {}],
  ['listo', 'workout', 'log_set'],
  ['hecho', 'workout', 'log_set'],
  ['80 por 10', 'idle', 'reply:No hay un entreno'],
  ['siguiente', 'idle', 'reply:No hay un entreno'],
  // --- commands
  ['deshacer', 'workout', 'undo_last_set'],
  ['me equivoqué', 'workout', 'undo_last_set'],
  ['saltar', 'workout', 'skip_exercise'],
  ['siguiente ejercicio', 'workout', 'skip_exercise'],
  ['salta al siguiente ejercicio', 'workout', 'skip_exercise'],
  ['descanso', 'workout', 'start_rest', {}],
  ['descansar 90 segundos', 'workout', 'start_rest', { seconds: 90 }],
  ['descanso de 2 minutos', 'workout', 'start_rest', { seconds: 120 }],
  ['inicia el descanso de un minuto y medio', 'workout', 'start_rest', { seconds: 90 }],
  ['ya', 'rest', 'skip_rest'],
  ['siguiente', 'rest', 'skip_rest'],
  ['sin descanso', 'rest', 'skip_rest'],
  ['más 30 segundos', 'rest', 'adjust_rest', { delta_seconds: 30 }],
  ['+30 s', 'rest', 'adjust_rest', { delta_seconds: 30 }],
  ['terminar entreno', 'workout', 'finish_workout'],
  ['terminar', 'workout', 'finish_workout'],
  // --- body metrics
  ['registra mi peso 78', 'idle', 'log_body_metrics', { weight: 78 }],
  ['anota mi peso 78,5 kilos', 'idle', 'log_body_metrics', { weight: 78.5 }],
  ['me pesé 80', 'idle', 'log_body_metrics', { weight: 80 }],
  ['mi peso es 77', 'idle', 'log_body_metrics', { weight: 77 }],
  ['registra mi peso setenta y ocho', 'idle', 'log_body_metrics', { weight: 78 }],
  ['guarda mi grasa corporal 18', 'idle', 'log_body_metrics', { body_fat: 18 }],
  ['anota cintura 85 y peso 79', 'idle', 'log_body_metrics', { waist: 85, weight: 79 }],
  ['registra mi peso 78', 'workout', 'log_body_metrics', { weight: 78 }],
  ['peso 80', 'workout', 'log_set', { weight: 80 }], // in a workout "peso" is the set weight
  // --- rest left
  ['cuánto descanso me queda', 'rest', 'reply:Te quedan'],
  ['cuánto falta', 'rest', 'reply:Te quedan'],
  ['cuánto descanso me queda', 'workout', 'reply:No hay un descanso'],
  // --- what's next / today
  ['qué sigue', 'workout', 'reply:Ahora'],
  ['qué sigue', 'rest', 'reply:Después del descanso'],
  ['cuál es el siguiente ejercicio', 'workout', 'reply:Luego'],
  ['qué sigue', 'idle', 'get_next_workout'],
  ['qué entreno hoy', 'idle', 'get_next_workout'],
  ['¿Qué me toca hoy?', 'idle', 'get_next_workout'],
  ['qué toca hoy', 'idle', 'get_next_workout'],
  ['empieza el entreno', 'idle', 'start_workout', {}],
  ['vamos a entrenar', 'idle', 'start_workout'],
  ['iniciar entreno libre', 'idle', 'start_workout', { free: true }],
  // --- progress
  ['cómo voy en press de banca', 'idle', 'get_progress', { exercise_id: 'bench-press' }],
  ['mi progreso en dominadas este mes', 'idle', 'get_progress', { exercise_id: 'pull-up', period: 'month' }],
  ['cuál es mi récord en peso muerto', 'idle', 'get_progress', { exercise_id: 'deadlift' }],
  ['cómo voy', 'idle', 'get_progress', {}],
  ['cuántos entrenos llevo', 'idle', 'get_progress'],
  ['mi racha', 'idle', 'get_progress'],
  ['cómo voy con el pecho esta semana', 'idle', 'get_progress', { muscle: 'chest', period: 'week' }],
  // --- swap / add
  ['cámbiame este ejercicio', 'workout', 'reply:Alternativas'],
  ['cambiar ejercicio', 'workout', 'reply:Alternativas'],
  ['no puedo hacer este', 'workout', 'reply:Alternativas'],
  ['cámbialo por sentadilla goblet', 'workout', 'swap_exercise', { to_exercise_id: 'goblet-squat' }],
  ['cámbialo por otro', 'workout', 'swap_exercise', {}],
  ['añade dominadas', 'workout', 'add_exercise', { query: 'pull-up' }],
  ['agrega plancha al entreno', 'workout', 'add_exercise', { query: 'plank' }],
  ['añade sentadilla', 'workout', 'add_exercise', { query: 'back-squat' }],
  ['añade curl', 'workout', 'reply:¿Cuál de estos?'],
  ['añade dominadas', 'idle', 'reply:necesitas un entreno'],
  // --- settings
  ['cambia a libras', 'idle', 'set_setting', { key: 'unit', value: 'lb' }],
  ['usa kilos', 'idle', 'set_setting', { key: 'unit', value: 'kg' }],
  ['pon descanso de 2 minutos', 'idle', 'set_setting', { key: 'defaultRestSec', value: '120' }],
  ['configura el descanso en 90 segundos', 'idle', 'set_setting', { key: 'defaultRestSec', value: '90' }],
  ['desactiva los sonidos', 'idle', 'set_setting', { key: 'sounds', value: 'false' }],
  ['activa la vibración', 'idle', 'set_setting', { key: 'vibration', value: 'true' }],
  ['apaga la voz', 'idle', 'set_setting', { key: 'voiceAnnouncements', value: 'false' }],
  ['quita el descanso automático', 'idle', 'set_setting', { key: 'autoStartRest', value: 'false' }],
  // --- navigation
  ['ve a progreso', 'idle', 'navigate', { route: '/progress' }],
  ['abre rutinas', 'idle', 'navigate', { route: '/routines' }],
  ['llévame al perfil', 'idle', 'navigate', { route: '/profile' }],
  ['muéstrame los ejercicios', 'idle', 'navigate', { route: '/exercises' }],
  // --- coach / technique (offline answers)
  ['¿cómo se hace el press de banca?', 'idle', 'reply:'],
  ['cómo se hace', 'workout', 'reply:'],
  ['técnica', 'workout', 'reply:'],
  ['cuánto descanso debo tomar entre series', 'workout', 'reply:'],
  ['me duele el hombro', 'workout', 'reply:profesional'],
  ['tengo agujetas, ¿qué hago?', 'idle', 'reply:'],
  // --- small talk
  ['hola', 'idle', 'reply:Hola'],
  ['gracias', 'idle', 'reply:De nada'],
  ['ayuda', 'idle', 'reply:Puedo'],
  // --- falls through to the AI
  ['crea una rutina de pecho y tríceps', 'idle', null],
  ['explícame la periodización ondulante', 'idle', null],
  ['tengo 3 días para entrenar', 'idle', null],
  ['más peso', 'workout', null],
  ['cuál es la mejor dieta para ganar volumen y cómo la organizo durante toda la semana con mi trabajo', 'idle', null],
  ['', 'idle', null],
  ['   ', 'idle', null],
]

function setup(state: State) {
  resetStore()
  if (state === 'idle') seedPlan()
  else {
    startPlanWorkout()
    if (state === 'rest') useApp.getState().startRest(60)
  }
}

describe('local intent router — phrase table', () => {
  it('has at least 50 phrases', () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(50)
  })

  for (const [phrase, state, expected, args] of TABLE) {
    it(`[${state}] «${phrase}» → ${expected ?? 'AI'}`, () => {
      setup(state)
      const r: LocalResult = handleLocally(phrase, {})
      if (expected === null) {
        expect(r.handled).toBe(false)
        return
      }
      expect(r.handled).toBe(true)
      if (!r.handled) return
      if (expected.startsWith('reply:')) {
        expect(r.actions).toHaveLength(0)
        const needle = expected.slice(6)
        expect(r.reply.length).toBeGreaterThan(0)
        if (needle) expect(r.reply).toContain(needle)
        return
      }
      expect(r.actions[0]?.name).toBe(expected)
      if (args) expect(r.actions[0].args).toMatchObject(args)
    })
  }
})

describe('local router — safety of destructive actions', () => {
  it('only a full phrase skips the confirmation for finishing', () => {
    setup('workout')
    const full = handleLocally('terminar entreno')
    const bare = handleLocally('terminar')
    expect(full.handled && full.actions[0].explicit).toBe(true)
    expect(bare.handled && bare.actions[0].explicit).toBeFalsy()
  })

  it('settings changes are explicit imperatives', () => {
    setup('idle')
    const r = handleLocally('cambia a libras')
    expect(r.handled && r.actions[0].explicit).toBe(true)
  })

  it('never turns questions or long chatter into sets', () => {
    setup('workout')
    expect(handleLocally('¿cuántas series hago de 10 reps?').handled).toBe(true) // coach answer, not log_set
    const r = handleLocally('¿cuántas series hago de 10 reps?')
    expect(r.handled && r.actions).toHaveLength(0)
    expect(handleLocally('hoy quiero hacer 3 series de 12 con mucho cuidado en la espalda baja').handled).toBe(false)
  })

  it('converts units for sets and body weight', () => {
    setup('workout')
    const r = handleLocally('registra mi peso 176 libras')
    expect(r.handled && r.actions[0].args.weight).toBeCloseTo(79.8, 0)
    const s = handleLocally('100 libras por 5')
    expect(s.handled && s.actions[0].args.weight).toBeCloseTo(45.5, 0)
  })
})

describe('local router — alternatives follow-up', () => {
  it('offers alternatives, then "la 2" swaps to the second', () => {
    setup('workout')
    const offer = handleLocally('cámbiame este ejercicio')
    expect(offer.handled && offer.reply).toContain('2.')
    const pick = handleLocally('la 2')
    expect(pick.handled && pick.actions[0].name).toBe('swap_exercise')
    // consumed
    expect(handleLocally('la 2').handled).toBe(false)
  })

  it('"añade curl" lists options and "el primero" adds it', () => {
    setup('workout')
    handleLocally('añade curl')
    const pick = handleLocally('el primero')
    expect(pick.handled && pick.actions[0].name).toBe('add_exercise')
  })

  it('a number without an offer is never a swap', () => {
    setup('workout')
    const r = handleLocally('2')
    expect(!r.handled || r.actions[0]?.name !== 'swap_exercise').toBe(true)
  })
})

describe('findDuration', () => {
  it.each([
    ['2 minutos', 120],
    ['90 segundos', 90],
    ['un minuto y medio', 90],
    ['dos minutos y medio', 150],
    ['1 minuto 30 segundos', 90],
    ['sesenta segundos', 60],
    ['nada', null],
  ])('%s → %s', (t, v) => expect(findDuration(t)).toBe(v))
})
