/**
 * Built-in exercise library (Spanish). STUB: implemented by the data agent.
 */
import type { Exercise, MuscleGroup, Equipment } from '../lib/types'

export const EXERCISES: Exercise[] = []

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
