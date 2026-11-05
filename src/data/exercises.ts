/**
 * Built-in exercise library (Spanish UI, English ids).
 * Definitions live in ./library/* grouped by muscle; this module flattens them, derives the
 * technique-video query and exposes lookups + the movement pattern of every exercise.
 */
import type { Equipment, Exercise, MuscleGroup } from '../lib/types'
import type { ExerciseDef, MovementPattern } from './library/defs'
import { CHEST } from './library/chest'
import { BACK } from './library/back'
import { SHOULDERS } from './library/shoulders'
import { ARMS } from './library/arms'
import { QUADS } from './library/quads'
import { POSTERIOR } from './library/posterior'
import { CARDIO, CORE, FULL_BODY } from './library/core'

export type { MovementPattern } from './library/defs'

const DEFS: ExerciseDef[] = [...CHEST, ...BACK, ...SHOULDERS, ...ARMS, ...QUADS, ...POSTERIOR, ...CORE, ...CARDIO, ...FULL_BODY]

/** 'como hacer <nombre> tecnica correcta' (YouTube search phrase). */
export function videoQueryFor(name: string): string {
  return `como hacer ${name.toLowerCase().replace(/[()]/g, '').replace(/\s+/g, ' ').trim()} tecnica correcta`
}

function toExercise({ pattern: _pattern, ...def }: ExerciseDef): Exercise {
  return { ...def, videoQuery: videoQueryFor(def.name) }
}

export const EXERCISES: Exercise[] = DEFS.map(toExercise)

export const EXERCISE_BY_ID: ReadonlyMap<string, Exercise> = new Map(EXERCISES.map((e) => [e.id, e]))

export function getBuiltinExercise(id: string): Exercise | undefined {
  return EXERCISE_BY_ID.get(id)
}

/** Movement pattern of every built-in exercise (custom exercises have none). */
export const PATTERN_OF: Record<string, MovementPattern> = Object.fromEntries(DEFS.map((d) => [d.id, d.pattern]))

export function patternOf(id: string): MovementPattern | undefined {
  return Object.prototype.hasOwnProperty.call(PATTERN_OF, id) ? PATTERN_OF[id] : undefined
}

export const MUSCLE_LABEL: Record<MuscleGroup, string> = {
  chest: 'Pecho',
  back: 'Espalda',
  shoulders: 'Hombros',
  biceps: 'Bíceps',
  triceps: 'Tríceps',
  forearms: 'Antebrazo',
  quads: 'Cuádriceps',
  hamstrings: 'Isquios',
  glutes: 'Glúteos',
  calves: 'Gemelos',
  core: 'Core',
  cardio: 'Cardio',
  full_body: 'Cuerpo completo',
}

export const EQUIPMENT_LABEL: Record<Equipment, string> = {
  barbell: 'Barra',
  dumbbell: 'Mancuernas',
  machine: 'Máquina',
  cable: 'Polea',
  bodyweight: 'Peso corporal',
  kettlebell: 'Kettlebell',
  band: 'Banda',
  smith: 'Smith',
  ez_bar: 'Barra Z',
  pullup_bar: 'Barra de dominadas',
  bench: 'Banco',
}
