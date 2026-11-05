/**
 * Routine templates per equipment profile. Each day lists 5–7 exercise ids in execution order
 * (compound → isolation) plus one core exercise last. Sets/reps/rest are NOT stored here: the planner
 * applies the user's goal + level scheme (see lib/planner.ts).
 */
import type { Equipment, EquipmentProfile } from '../lib/types'

export type TemplateSplit = 'full_body' | 'upper_lower' | 'ppl' | 'quick'

export interface TemplateDay {
  /** Routine name, e.g. 'Día A · Full body'. */
  name: string
  /** Short focus line, e.g. 'Pecho · Espalda · Piernas'. */
  focus: string
  /** Built-in exercise ids, in order. */
  exerciseIds: string[]
}

export interface RoutineTemplate {
  id: string
  name: string
  description: string
  equipment: EquipmentProfile
  split: TemplateSplit
  /** Weekly frequencies this template is designed for. */
  daysPerWeek: number[]
  /** Approximate session length in minutes. */
  minutes: number
  days: TemplateDay[]
}

/**
 * Equipment that templates of each profile may use. Narrower than what recommend.ts allows
 * for alternatives: a template must be doable by everyone who picked that profile.
 */
export const TEMPLATE_EQUIPMENT: Record<EquipmentProfile, readonly Equipment[]> = {
  gym: ['barbell', 'dumbbell', 'machine', 'cable', 'smith', 'ez_bar', 'bench', 'bodyweight', 'pullup_bar', 'kettlebell'],
  home_dumbbells: ['dumbbell', 'bench', 'bodyweight'],
  bodyweight: ['bodyweight'],
}

export const SPLIT_LABEL: Record<TemplateSplit, string> = {
  full_body: 'Full body',
  upper_lower: 'Torso / Pierna',
  ppl: 'Empuje / Tirón / Pierna',
  quick: 'Rápido 30 min',
}

const DESC = {
  full_body: 'Todo el cuerpo en cada sesión, alternando dos rutinas. Ideal para empezar o si entrenas 2–3 días.',
  upper_lower: 'Alterna días de torso y de pierna. Cada músculo se entrena dos veces por semana con 4 días.',
  ppl: 'Empuje (pecho, hombro, tríceps), tirón (espalda, bíceps) y pierna. Para 3 o 6 días por semana.',
  quick: 'Full body exprés de unos 30 minutos: pocos ejercicios, los más rentables. Para días con poco tiempo.',
}

export const TEMPLATES: RoutineTemplate[] = [
  /* ======================= GIMNASIO ======================= */
  {
    id: 'gym-full-body',
    name: 'Full body A/B',
    description: DESC.full_body,
    equipment: 'gym',
    split: 'full_body',
    daysPerWeek: [2, 3],
    minutes: 60,
    days: [
      {
        name: 'Día A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: ['back-squat', 'bench-press', 'seated-cable-row', 'romanian-deadlift', 'lateral-raise', 'dumbbell-curl', 'plank'],
      },
      {
        name: 'Día B · Full body',
        focus: 'Espalda · Piernas · Pecho',
        exerciseIds: ['deadlift', 'incline-dumbbell-press', 'lat-pulldown', 'leg-press', 'face-pull', 'triceps-pushdown', 'cable-crunch'],
      },
    ],
  },
  {
    id: 'gym-upper-lower',
    name: 'Torso / Pierna',
    description: DESC.upper_lower,
    equipment: 'gym',
    split: 'upper_lower',
    daysPerWeek: [4, 5],
    minutes: 60,
    days: [
      {
        name: 'Día A · Torso',
        focus: 'Pecho · Espalda · Brazos',
        exerciseIds: ['bench-press', 'barbell-row', 'incline-dumbbell-press', 'lat-pulldown', 'triceps-pushdown', 'dumbbell-curl', 'cable-crunch'],
      },
      {
        name: 'Día B · Pierna',
        focus: 'Cuádriceps · Isquios · Gemelos',
        exerciseIds: ['back-squat', 'romanian-deadlift', 'leg-press', 'leg-extension', 'lying-leg-curl', 'standing-calf-raise', 'plank'],
      },
      {
        name: 'Día C · Torso',
        focus: 'Hombros · Espalda · Pecho',
        exerciseIds: [
          'overhead-press',
          'pull-up',
          'dumbbell-bench-press',
          'seated-cable-row',
          'lateral-raise',
          'face-pull',
          'hammer-curl',
          'hanging-leg-raise',
        ],
      },
      {
        name: 'Día D · Pierna',
        focus: 'Glúteos · Isquios · Cuádriceps',
        exerciseIds: ['deadlift', 'bulgarian-split-squat', 'hip-thrust', 'seated-leg-curl', 'seated-calf-raise', 'pallof-press'],
      },
    ],
  },
  {
    id: 'gym-ppl',
    name: 'Empuje / Tirón / Pierna',
    description: DESC.ppl,
    equipment: 'gym',
    split: 'ppl',
    daysPerWeek: [3, 5, 6],
    minutes: 60,
    days: [
      {
        name: 'Día A · Empuje',
        focus: 'Pecho · Hombros · Tríceps',
        exerciseIds: ['bench-press', 'overhead-press', 'incline-dumbbell-press', 'cable-crossover', 'lateral-raise', 'triceps-pushdown', 'cable-crunch'],
      },
      {
        name: 'Día B · Tirón',
        focus: 'Espalda · Bíceps · Hombro posterior',
        exerciseIds: ['barbell-row', 'pull-up', 'seated-cable-row', 'face-pull', 'barbell-curl', 'hammer-curl', 'hanging-leg-raise'],
      },
      {
        name: 'Día C · Pierna',
        focus: 'Cuádriceps · Isquios · Glúteos',
        exerciseIds: ['back-squat', 'romanian-deadlift', 'leg-press', 'lying-leg-curl', 'leg-extension', 'standing-calf-raise', 'plank'],
      },
    ],
  },
  {
    id: 'gym-quick',
    name: 'Rápido 30 min',
    description: DESC.quick,
    equipment: 'gym',
    split: 'quick',
    daysPerWeek: [2, 3, 4],
    minutes: 30,
    days: [
      {
        name: 'Rápido A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: ['leg-press', 'machine-chest-press', 'lat-pulldown', 'seated-leg-curl', 'lateral-raise', 'plank'],
      },
      {
        name: 'Rápido B · Full body',
        focus: 'Piernas · Hombros · Espalda',
        exerciseIds: ['goblet-squat', 'machine-shoulder-press', 'seated-cable-row', 'lying-leg-curl', 'pec-deck', 'cable-crunch'],
      },
    ],
  },

  /* ================== CASA CON MANCUERNAS ================== */
  {
    id: 'home-full-body',
    name: 'Full body A/B',
    description: DESC.full_body,
    equipment: 'home_dumbbells',
    split: 'full_body',
    daysPerWeek: [2, 3],
    minutes: 50,
    days: [
      {
        name: 'Día A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: [
          'goblet-squat',
          'dumbbell-bench-press',
          'dumbbell-row',
          'dumbbell-romanian-deadlift',
          'lateral-raise',
          'dumbbell-curl',
          'plank',
        ],
      },
      {
        name: 'Día B · Full body',
        focus: 'Glúteos · Pecho · Espalda',
        exerciseIds: [
          'bulgarian-split-squat',
          'incline-dumbbell-press',
          'dumbbell-row',
          'dumbbell-hip-thrust',
          'rear-delt-fly',
          'overhead-triceps-extension',
          'dead-bug',
        ],
      },
    ],
  },
  {
    id: 'home-upper-lower',
    name: 'Torso / Pierna',
    description: DESC.upper_lower,
    equipment: 'home_dumbbells',
    split: 'upper_lower',
    daysPerWeek: [4, 5],
    minutes: 50,
    days: [
      {
        name: 'Día A · Torso',
        focus: 'Pecho · Espalda · Brazos',
        exerciseIds: [
          'dumbbell-bench-press',
          'dumbbell-row',
          'dumbbell-shoulder-press',
          'lateral-raise',
          'dumbbell-curl',
          'overhead-triceps-extension',
          'plank',
        ],
      },
      {
        name: 'Día B · Pierna',
        focus: 'Cuádriceps · Isquios · Gemelos',
        exerciseIds: ['goblet-squat', 'dumbbell-romanian-deadlift', 'dumbbell-lunge', 'sliding-leg-curl', 'dumbbell-calf-raise', 'side-plank'],
      },
      {
        name: 'Día C · Torso',
        focus: 'Pecho · Espalda · Hombros',
        exerciseIds: [
          'incline-dumbbell-press',
          'dumbbell-row',
          'arnold-press',
          'dumbbell-fly',
          'rear-delt-fly',
          'hammer-curl',
          'triceps-kickback',
          'lying-leg-raise',
        ],
      },
      {
        name: 'Día D · Pierna',
        focus: 'Glúteos · Isquios · Cuádriceps',
        exerciseIds: ['bulgarian-split-squat', 'dumbbell-hip-thrust', 'single-leg-rdl', 'step-up', 'dumbbell-calf-raise', 'dead-bug'],
      },
    ],
  },
  {
    id: 'home-ppl',
    name: 'Empuje / Tirón / Pierna',
    description: DESC.ppl,
    equipment: 'home_dumbbells',
    split: 'ppl',
    daysPerWeek: [3, 5, 6],
    minutes: 50,
    days: [
      {
        name: 'Día A · Empuje',
        focus: 'Pecho · Hombros · Tríceps',
        exerciseIds: [
          'dumbbell-bench-press',
          'dumbbell-shoulder-press',
          'incline-dumbbell-press',
          'dumbbell-fly',
          'lateral-raise',
          'overhead-triceps-extension',
          'crunch',
        ],
      },
      {
        name: 'Día B · Tirón',
        focus: 'Espalda · Bíceps · Isquios',
        exerciseIds: [
          'dumbbell-row',
          'dumbbell-romanian-deadlift',
          'dumbbell-pullover',
          'rear-delt-fly',
          'dumbbell-curl',
          'hammer-curl',
          'dead-bug',
        ],
      },
      {
        name: 'Día C · Pierna',
        focus: 'Cuádriceps · Glúteos · Isquios',
        exerciseIds: ['goblet-squat', 'bulgarian-split-squat', 'dumbbell-hip-thrust', 'sliding-leg-curl', 'dumbbell-calf-raise', 'plank'],
      },
    ],
  },
  {
    id: 'home-quick',
    name: 'Rápido 30 min',
    description: DESC.quick,
    equipment: 'home_dumbbells',
    split: 'quick',
    daysPerWeek: [2, 3, 4],
    minutes: 30,
    days: [
      {
        name: 'Rápido A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: ['goblet-squat', 'dumbbell-bench-press', 'dumbbell-row', 'dumbbell-romanian-deadlift', 'lateral-raise', 'plank'],
      },
      {
        name: 'Rápido B · Full body',
        focus: 'Piernas · Hombros · Glúteos',
        exerciseIds: ['dumbbell-lunge', 'dumbbell-shoulder-press', 'dumbbell-row', 'dumbbell-hip-thrust', 'dumbbell-fly', 'dead-bug'],
      },
    ],
  },

  /* ======================= SIN EQUIPO ======================= */
  {
    id: 'bw-full-body',
    name: 'Full body A/B',
    description: DESC.full_body,
    equipment: 'bodyweight',
    split: 'full_body',
    daysPerWeek: [2, 3],
    minutes: 40,
    days: [
      {
        name: 'Día A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: ['bodyweight-squat', 'push-up', 'inverted-row', 'glute-bridge', 'bench-dips', 'superman', 'plank'],
      },
      {
        name: 'Día B · Full body',
        focus: 'Piernas · Hombros · Espalda',
        exerciseIds: [
          'bodyweight-lunge',
          'pike-push-up',
          'inverted-row',
          'single-leg-glute-bridge',
          'prone-ytw',
          'bodyweight-calf-raise',
          'dead-bug',
        ],
      },
    ],
  },
  {
    id: 'bw-upper-lower',
    name: 'Torso / Pierna',
    description: DESC.upper_lower,
    equipment: 'bodyweight',
    split: 'upper_lower',
    daysPerWeek: [4, 5],
    minutes: 40,
    days: [
      {
        name: 'Día A · Torso',
        focus: 'Pecho · Espalda · Hombros',
        exerciseIds: ['push-up', 'inverted-row', 'pike-push-up', 'bench-dips', 'prone-ytw', 'plank'],
      },
      {
        name: 'Día B · Pierna',
        focus: 'Cuádriceps · Glúteos · Isquios',
        exerciseIds: ['bodyweight-squat', 'bodyweight-lunge', 'glute-bridge', 'sliding-leg-curl', 'bodyweight-calf-raise', 'side-plank'],
      },
      {
        name: 'Día C · Torso',
        focus: 'Pecho · Tríceps · Espalda',
        exerciseIds: ['decline-push-up', 'inverted-row', 'pike-push-up', 'diamond-push-up', 'superman', 'dead-bug'],
      },
      {
        name: 'Día D · Pierna',
        focus: 'Cuádriceps · Glúteos · Gemelos',
        exerciseIds: [
          'bodyweight-bulgarian-split-squat',
          'jump-squat',
          'single-leg-glute-bridge',
          'sliding-leg-curl',
          'wall-sit',
          'bodyweight-calf-raise',
          'bicycle-crunch',
        ],
      },
    ],
  },
  {
    id: 'bw-ppl',
    name: 'Empuje / Tirón / Pierna',
    description: DESC.ppl,
    equipment: 'bodyweight',
    split: 'ppl',
    daysPerWeek: [3, 5, 6],
    minutes: 40,
    days: [
      {
        name: 'Día A · Empuje',
        focus: 'Pecho · Hombros · Tríceps',
        exerciseIds: ['push-up', 'pike-push-up', 'decline-push-up', 'diamond-push-up', 'bench-dips', 'plank'],
      },
      {
        name: 'Día B · Tirón',
        focus: 'Espalda · Isquios · Glúteos',
        exerciseIds: ['inverted-row', 'sliding-leg-curl', 'glute-bridge', 'superman', 'prone-ytw', 'bird-dog'],
      },
      {
        name: 'Día C · Pierna',
        focus: 'Cuádriceps · Glúteos · Gemelos',
        exerciseIds: [
          'bodyweight-squat',
          'bodyweight-bulgarian-split-squat',
          'single-leg-glute-bridge',
          'wall-sit',
          'bodyweight-calf-raise',
          'crunch',
        ],
      },
    ],
  },
  {
    id: 'bw-quick',
    name: 'Rápido 30 min',
    description: DESC.quick,
    equipment: 'bodyweight',
    split: 'quick',
    daysPerWeek: [2, 3, 4],
    minutes: 30,
    days: [
      {
        name: 'Rápido A · Full body',
        focus: 'Piernas · Pecho · Espalda',
        exerciseIds: ['bodyweight-squat', 'push-up', 'inverted-row', 'glute-bridge', 'bench-dips', 'plank'],
      },
      {
        name: 'Rápido B · Full body',
        focus: 'Piernas · Hombros · Espalda',
        exerciseIds: ['bodyweight-lunge', 'pike-push-up', 'inverted-row', 'single-leg-glute-bridge', 'prone-ytw', 'dead-bug'],
      },
    ],
  },
]

export const TEMPLATE_BY_ID: ReadonlyMap<string, RoutineTemplate> = new Map(TEMPLATES.map((t) => [t.id, t]))

export function getTemplate(id: string): RoutineTemplate | undefined {
  return TEMPLATE_BY_ID.get(id)
}

/** Templates for a profile (all profiles when undefined), in catalog order. */
export function templatesFor(equipment?: EquipmentProfile): RoutineTemplate[] {
  return equipment ? TEMPLATES.filter((t) => t.equipment === equipment) : TEMPLATES.slice()
}
