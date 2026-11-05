/**
 * Gymfullness — shared data model (THE CONTRACT).
 * Every module imports its types from here. Change only with care: the store,
 * engine, sync and every screen depend on these shapes.
 *
 * Conventions
 * - Timestamps are epoch milliseconds (number).
 * - Calendar dates are local 'YYYY-MM-DD' strings.
 * - Weights are stored in the user's display unit at the time of logging, with
 *   the unit saved on the session (session.unit). Convert with lib/units.ts.
 * - Every syncable record has `updatedAt` and an optional `deleted` tombstone.
 */

export type ID = string
export type Unit = 'kg' | 'lb'

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'cardio'
  | 'full_body'

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'bodyweight'
  | 'kettlebell'
  | 'band'
  | 'smith'
  | 'ez_bar'
  | 'pullup_bar'
  | 'bench'

/** What a set measures. */
export type ExerciseKind =
  | 'weight_reps' // weight × reps (press banca)
  | 'reps' // bodyweight reps (dominadas, flexiones)
  | 'time' // hold / duration (plancha)

export type Level = 'beginner' | 'intermediate' | 'advanced'
export type Goal = 'muscle' | 'strength' | 'fat_loss' | 'health'
/** Where the user trains — drives templates and exercise alternatives. */
export type EquipmentProfile = 'gym' | 'home_dumbbells' | 'bodyweight'

export interface Exercise {
  id: string // kebab-case, stable, e.g. 'bench-press'
  name: string // Spanish display name, e.g. 'Press de banca'
  aliases: string[] // other names (es/en) used for search and voice
  primary: MuscleGroup
  secondary: MuscleGroup[]
  equipment: Equipment[] // ALL equipment required
  kind: ExerciseKind
  level: Level
  isCompound: boolean
  defaultRestSec: number
  /** Suggested load increment in kg when progressing (e.g. 2.5 barbell, 2 dumbbell, 5 machine). */
  increment: number
  setup: string[] // how to set up, 1–3 short bullets
  cues: string[] // execution cues, 2–5 short bullets (imperative, Spanish)
  mistakes: string[] // common mistakes, 2–4 short bullets
  breathing?: string
  /** Search phrase for a technique video, e.g. 'como hacer press de banca tecnica'. */
  videoQuery?: string
  custom?: boolean // user-created
}

export interface RoutineItem {
  id: ID
  exerciseId: string
  sets: number
  repsMin: number
  repsMax: number
  restSec: number
  /** For kind === 'time': target seconds per set. */
  targetSeconds?: number
  note?: string
}

export interface Routine {
  id: ID
  name: string // 'Día A · Empuje'
  focus?: string // 'Pecho · Hombros · Tríceps'
  items: RoutineItem[]
  templateId?: string
  createdAt: number
  updatedAt: number
  deleted?: boolean
}

/** The user's training plan: an ordered rotation of routines. */
export interface Plan {
  routineIds: ID[]
  daysPerWeek: number
  goal: Goal
  level: Level
  equipment: EquipmentProfile
  updatedAt: number
}

export type SetSource = 'tap' | 'voice' | 'text' | 'auto'

export interface SetLog {
  id: ID
  weight: number | null // in session.unit; null for bodyweight/time
  reps: number | null
  seconds?: number | null // for 'time' exercises
  rpe?: number | null // 1–10, optional
  done: boolean
  completedAt?: number
  source?: SetSource
  isWarmup?: boolean
  isPR?: boolean // set by engine when a set beats the previous best e1RM / reps
}

export interface SessionTarget {
  sets: number
  repsMin: number
  repsMax: number
  restSec: number
  targetSeconds?: number
  /** Suggested working weight (progression engine), in session.unit. */
  weight?: number | null
  /** Short human reason for the suggestion, e.g. 'Subiste reps la última vez: +2.5 kg'. */
  reason?: string
}

export interface SessionExercise {
  id: ID
  exerciseId: string
  routineItemId?: ID
  target: SessionTarget
  sets: SetLog[] // pre-created (done=false) from target.sets; user can add/remove
  note?: string
  swappedFrom?: string // original exerciseId if the user swapped it
  skipped?: boolean
}

export interface RestState {
  startedAt: number
  endsAt: number
  durationSec: number
  /** exercise/set the rest leads INTO (for "Siguiente" preview). */
  nextExIndex: number
  nextSetIndex: number
}

export interface WorkoutSession {
  id: ID
  routineId?: ID | null
  name: string
  unit: Unit
  startedAt: number
  endedAt?: number | null
  exercises: SessionExercise[]
  /** Where the user is: current exercise index and set index within it. */
  cursor: { ex: number; set: number }
  rest?: RestState | null
  notes?: string
  feeling?: 1 | 2 | 3 | 4 | 5
  updatedAt: number
  deleted?: boolean
}

export interface BodyLog {
  id: ID
  date: string // YYYY-MM-DD
  weight?: number | null // in Settings.unit at time of logging (store unit with it)
  unit: Unit
  bodyFat?: number | null // %
  waist?: number | null // cm
  chest?: number | null
  arm?: number | null
  thigh?: number | null
  hips?: number | null
  neck?: number | null
  note?: string
  updatedAt: number
  deleted?: boolean
}

export type ThemePref = 'auto' | 'dark' | 'light'

export interface Settings {
  unit: Unit
  defaultRestSec: number
  autoStartRest: boolean
  voiceAnnouncements: boolean // speak "Siguiente: …", "Descanso terminado"
  sounds: boolean // beeps at end of rest
  vibration: boolean
  keepAwake: boolean // Screen Wake Lock during workouts
  countdownBeeps: boolean // 3-2-1 beeps before rest ends
  speechLang: string // BCP-47, e.g. 'es-CO'
  theme: ThemePref
  updatedAt: number
}

export interface Profile {
  name?: string
  goal?: Goal
  level?: Level
  daysPerWeek?: number
  equipment?: EquipmentProfile
  heightCm?: number | null
  birthYear?: number | null
  sex?: 'male' | 'female' | 'other' | null
  onboarded: boolean
  updatedAt: number
}

export interface AuthUser {
  uid: string
  name: string | null
  email: string | null
  photoURL: string | null
}

/** Everything the user owns — used for export/import and cloud sync. */
export interface UserData {
  version: 1
  profile: Profile
  settings: Settings
  plan: Plan | null
  routines: Routine[]
  sessions: WorkoutSession[] // completed sessions only
  bodyLogs: BodyLog[]
  customExercises: Exercise[]
}

/* ---------- Engine contracts (implemented in lib/workout/engine.ts) ---------- */

export interface LogSetInput {
  weight?: number | null
  reps?: number | null
  seconds?: number | null
  rpe?: number | null
  source?: SetSource
  /** Defaults to the cursor position. */
  exIndex?: number
  setIndex?: number
}

export interface LogSetResult {
  session: WorkoutSession
  isPR: boolean
  exerciseCompleted: boolean
  workoutCompleted: boolean
  /** Rest seconds to start (0 when workout completed). */
  restSec: number
}

export interface CursorInfo {
  exIndex: number
  setIndex: number
  exercise: SessionExercise | null
  setNumber: number // 1-based
  totalSets: number // for current exercise
  next: { exIndex: number; setIndex: number; exercise: SessionExercise } | null
  /** 0..1 over all non-skipped sets of the session. */
  progress: number
  doneSets: number
  totalSessionSets: number
  isLastSetOfExercise: boolean
  isFinished: boolean
}

export interface ProgressionSuggestion {
  weight: number | null
  reps: number | null
  reason: string
}

export interface SessionSummary {
  sessionId: ID
  name: string
  startedAt: number
  endedAt: number
  durationSec: number
  totalSets: number
  totalReps: number
  volume: number // Σ weight × reps (working sets), in session.unit
  unit: Unit
  prs: { exerciseId: string; name: string; weight: number | null; reps: number | null; e1rm: number | null }[]
  exercises: {
    exerciseId: string
    name: string
    sets: { weight: number | null; reps: number | null; seconds?: number | null; isPR?: boolean }[]
    volume: number
    bestE1rm: number | null
  }[]
  muscles: Partial<Record<MuscleGroup, number>> // sets per muscle (primary=1, secondary=0.5)
}

/* ---------- Voice contracts (implemented in lib/voice/parse.ts) ---------- */

export type VoiceCommand =
  | 'next' // "siguiente", "listo", "hecho"
  | 'skip' // "saltar", "omitir"
  | 'undo' // "deshacer", "borrar", "me equivoqué"
  | 'rest' // "descanso" (start rest now)
  | 'skip_rest' // "ya", "seguir", "sin descanso"
  | 'add_time' // "más tiempo", "30 segundos más"
  | 'finish' // "terminar entreno", "fin"
  | 'technique' // "técnica", "cómo se hace"
  | 'swap' // "cambiar ejercicio", "otro ejercicio"
  | 'repeat' // "repite", "igual", "lo mismo" — same as last set

export type ParsedVoice =
  | {
      type: 'set'
      weight?: number | null
      reps?: number | null
      seconds?: number | null
      rpe?: number | null
      unit?: Unit
      /** e.g. "subí 5 kilos": delta applied to last weight, already resolved into weight. */
      relative?: boolean
      confidence: number // 0..1
      raw: string
    }
  | { type: 'command'; command: VoiceCommand; seconds?: number; raw: string }
  | { type: 'unknown'; raw: string }

export interface VoiceContext {
  lastWeight: number | null // weight of the previous set (or suggested)
  lastReps: number | null
  unit: Unit
  kind: ExerciseKind
}
