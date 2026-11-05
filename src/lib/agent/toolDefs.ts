/**
 * Tool DEFINITIONS for the AI assistant: plain data, ZERO imports.
 * Single source of truth shared by the browser registry (tools.ts) and the Pages Function
 * (functions/api/agent.ts). Keep this file free of React / store / alias imports.
 */

export type ToolRisk = 'read' | 'write' | 'destructive'

/** The JSON-schema subset used by the tools (works for Anthropic, OpenAI-compatible and Gemini). */
export interface JsonSchema {
  type: 'object' | 'string' | 'number' | 'integer' | 'boolean' | 'array'
  description?: string
  properties?: Record<string, JsonSchema>
  required?: string[]
  enum?: string[]
  minimum?: number
  maximum?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  items?: JsonSchema
}

export interface ToolDef {
  name: ToolName
  /** For the model (English or Spanish-agnostic). */
  description: string
  risk: ToolRisk
  parameters: JsonSchema & { type: 'object' }
}

export const TOOL_NAMES = [
  'get_context',
  'get_next_workout',
  'start_workout',
  'log_set',
  'undo_last_set',
  'skip_exercise',
  'swap_exercise',
  'add_exercise',
  'start_rest',
  'skip_rest',
  'adjust_rest',
  'finish_workout',
  'search_exercises',
  'get_exercise_info',
  'get_progress',
  'log_body_metrics',
  'create_routine',
  'modify_plan_days',
  'set_setting',
  'navigate',
] as const

export type ToolName = (typeof TOOL_NAMES)[number]

/** Routes the assistant may open (static ones; '/exercises' also accepts exercise_id). */
export const NAV_ROUTES = ['/', '/routines', '/exercises', '/workout', '/progress', '/profile'] as const

/** Settings the assistant may change. */
export const SETTING_KEYS = ['unit', 'defaultRestSec', 'autoStartRest', 'sounds', 'vibration', 'voiceAnnouncements'] as const

export const MUSCLES = [
  'chest',
  'back',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'core',
  'cardio',
  'full_body',
] as const

const obj = (properties: Record<string, JsonSchema> = {}, required: string[] = []): ToolDef['parameters'] => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
})

export const TOOL_DEFS: readonly ToolDef[] = [
  {
    name: 'get_context',
    risk: 'read',
    description:
      'Compact snapshot of the app: profile goal/level, settings, plan routines, and the active workout (current exercise, set number, target, next set, rest left, progress). Call it when you need state that is not in the <contexto> block.',
    parameters: obj(),
  },
  {
    name: 'get_next_workout',
    risk: 'read',
    description: "Which routine is next in the user's plan rotation (today's workout) with its exercises, sets and reps.",
    parameters: obj(),
  },
  {
    name: 'start_workout',
    risk: 'write',
    description:
      'Start a workout. Pass routine_id to start a specific routine, free=true for an empty free workout, or nothing to start the next routine of the plan. Fails if a workout is already active.',
    parameters: obj({
      routine_id: { type: 'string', description: 'Routine id from get_context / get_next_workout.' },
      free: { type: 'boolean', description: 'Start an empty free workout.' },
    }),
  },
  {
    name: 'log_set',
    risk: 'write',
    description:
      'Log the current set of the active workout. Omitted fields keep the prefilled values (so an empty call means "as planned"). Weight is in the user unit (kg or lb). Starts the rest timer automatically when enabled.',
    parameters: obj({
      weight: { type: 'number', minimum: 0, maximum: 1000, description: 'Load in the user unit.' },
      reps: { type: 'integer', minimum: 0, maximum: 200, description: 'Repetitions done.' },
      seconds: { type: 'integer', minimum: 0, maximum: 7200, description: 'Duration for timed exercises.' },
      rpe: { type: 'number', minimum: 1, maximum: 10, description: 'Perceived effort 1-10.' },
    }),
  },
  {
    name: 'undo_last_set',
    risk: 'write',
    description: 'Undo the most recently logged set of the active workout.',
    parameters: obj(),
  },
  {
    name: 'skip_exercise',
    risk: 'write',
    description: 'Skip an exercise of the active workout (default: the current one). Logged sets are kept.',
    parameters: obj({ exercise_index: { type: 'integer', minimum: 0, maximum: 60, description: '0-based index in the workout; default current.' } }),
  },
  {
    name: 'swap_exercise',
    risk: 'write',
    description:
      'Replace an exercise of the active workout with another. Give to_exercise_id (from search_exercises), or omit it to pick the best alternative automatically.',
    parameters: obj({
      to_exercise_id: { type: 'string', description: 'Exercise id to switch to; omit for automatic best alternative.' },
      exercise_index: { type: 'integer', minimum: 0, maximum: 60, description: '0-based index; default current.' },
    }),
  },
  {
    name: 'add_exercise',
    risk: 'write',
    description:
      'Add an exercise at the end of the active workout. query is an exercise id or a name ("sentadilla goblet"). If several match, candidates are returned: ask the user or call again with the exact id.',
    parameters: obj({ query: { type: 'string', maxLength: 80, description: 'Exercise id or name.' } }, ['query']),
  },
  {
    name: 'start_rest',
    risk: 'write',
    description: 'Start the rest timer now. seconds defaults to the current exercise rest.',
    parameters: obj({ seconds: { type: 'integer', minimum: 5, maximum: 900, description: 'Rest length in seconds.' } }),
  },
  {
    name: 'skip_rest',
    risk: 'write',
    description: 'End the running rest timer.',
    parameters: obj(),
  },
  {
    name: 'adjust_rest',
    risk: 'write',
    description: 'Add or remove seconds on the running rest timer (negative removes).',
    parameters: obj({ delta_seconds: { type: 'integer', minimum: -300, maximum: 300, description: 'Seconds to add (+) or remove (-).' } }, ['delta_seconds']),
  },
  {
    name: 'finish_workout',
    risk: 'destructive',
    description: 'Finish and save the active workout. The user is asked to confirm first.',
    parameters: obj(),
  },
  {
    name: 'search_exercises',
    risk: 'read',
    description: 'Search the exercise library by name/alias/muscle. Returns ids you can use in other tools.',
    parameters: obj(
      {
        query: { type: 'string', maxLength: 80, description: 'Free text, e.g. "press inclinado".' },
        muscle: { type: 'string', enum: [...MUSCLES], description: 'Optional muscle filter.' },
        limit: { type: 'integer', minimum: 1, maximum: 10, description: 'Max results (default 6).' },
      },
      ['query'],
    ),
  },
  {
    name: 'get_exercise_info',
    risk: 'read',
    description: 'Technique info for one exercise: muscles, equipment, setup, cues, common mistakes, breathing, alternatives.',
    parameters: obj({ exercise_id: { type: 'string', description: 'Exercise id (or exact name).' } }, ['exercise_id']),
  },
  {
    name: 'get_progress',
    risk: 'read',
    description:
      'Training progress from the user history. With exercise_id: e1RM trend, best sets, PR. With muscle: weekly sets. With neither: overall streak, weekly volume, recent PRs and body-weight trend.',
    parameters: obj({
      exercise_id: { type: 'string', description: 'Exercise id (or name).' },
      muscle: { type: 'string', enum: [...MUSCLES] },
      period: { type: 'string', enum: ['week', 'month', '3months', 'year', 'all'], description: 'Default month.' },
    }),
  },
  {
    name: 'log_body_metrics',
    risk: 'write',
    description: 'Save body measurements for today (or date). Weight in the user unit; lengths in cm; body_fat in %. At least one metric.',
    parameters: obj({
      weight: { type: 'number', minimum: 0, maximum: 2000, description: 'Body weight in the user unit.' },
      body_fat: { type: 'number', minimum: 0, maximum: 100 },
      waist: { type: 'number', minimum: 0, maximum: 400 },
      chest: { type: 'number', minimum: 0, maximum: 400 },
      arm: { type: 'number', minimum: 0, maximum: 200 },
      thigh: { type: 'number', minimum: 0, maximum: 300 },
      hips: { type: 'number', minimum: 0, maximum: 400 },
      neck: { type: 'number', minimum: 0, maximum: 200 },
      date: { type: 'string', maxLength: 10, description: 'YYYY-MM-DD, default today.' },
    }),
  },
  {
    name: 'create_routine',
    risk: 'destructive',
    description:
      'Create a NEW routine (never overwrites). exercises use ids from search_exercises; sets/reps/rest default to sensible values for the user goal. The user is asked to confirm first.',
    parameters: obj(
      {
        name: { type: 'string', maxLength: 60, description: 'Routine name.' },
        focus: { type: 'string', maxLength: 80, description: 'Short focus, e.g. "Pecho · Tríceps".' },
        exercises: {
          type: 'array',
          minItems: 1,
          maxItems: 12,
          items: obj(
            {
              exercise_id: { type: 'string' },
              sets: { type: 'integer', minimum: 1, maximum: 10 },
              reps_min: { type: 'integer', minimum: 1, maximum: 50 },
              reps_max: { type: 'integer', minimum: 1, maximum: 50 },
              rest_sec: { type: 'integer', minimum: 10, maximum: 600 },
            },
            ['exercise_id'],
          ),
        },
        add_to_plan: { type: 'boolean', description: 'Append the routine to the weekly plan rotation.' },
      },
      ['name', 'exercises'],
    ),
  },
  {
    name: 'modify_plan_days',
    risk: 'destructive',
    description:
      'Change training days per week (2-6): generates a fresh plan from the user profile. Existing routines are kept in the library. The user is asked to confirm first.',
    parameters: obj({ days: { type: 'integer', minimum: 1, maximum: 7 } }, ['days']),
  },
  {
    name: 'set_setting',
    risk: 'destructive',
    description:
      'Change one app setting. Keys: unit (kg|lb), defaultRestSec (10-600), autoStartRest, sounds, vibration, voiceAnnouncements (true|false). Value is always text.',
    parameters: obj(
      {
        key: { type: 'string', enum: [...SETTING_KEYS] },
        value: { type: 'string', maxLength: 10, description: 'kg|lb, a number of seconds, or true|false.' },
      },
      ['key', 'value'],
    ),
  },
  {
    name: 'navigate',
    risk: 'read',
    description: 'Open a screen of the app. route is one of the allowed paths; for "/exercises" you may add exercise_id to open its detail.',
    parameters: obj(
      {
        route: { type: 'string', enum: [...NAV_ROUTES] },
        exercise_id: { type: 'string', description: 'Only with route "/exercises".' },
      },
      ['route'],
    ),
  },
]

/** Short stable hash of the tool list (names + risks) so client and server can detect version skew. */
export function toolsDigest(defs: readonly ToolDef[] = TOOL_DEFS): string {
  const s = defs.map((d) => `${d.name}:${d.risk}`).join('|')
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export const isToolName = (n: unknown): n is ToolName => typeof n === 'string' && (TOOL_NAMES as readonly string[]).includes(n)
