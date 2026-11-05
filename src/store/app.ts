/**
 * Central app store (local-first). Persisted to IndexedDB via idb-keyval.
 * Screens read state with selectors: `useApp((s) => s.sessions)`.
 * All mutations go through the actions below so `updatedAt` stays correct for sync.
 * Workout logic lives in lib/workout/engine.ts (pure) — actions just apply it.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval'
import type {
  BodyLog,
  Exercise,
  ID,
  LogSetInput,
  LogSetResult,
  Plan,
  Profile,
  Routine,
  SetLog,
  Settings,
  UserData,
  WorkoutSession,
} from '@/lib/types'
import { uid } from '@/lib/id'
import * as engine from '@/lib/workout/engine'
import { EXERCISES } from '@/data/exercises'

const idbStorage: StateStorage = {
  getItem: async (name) => (await idbGet<string>(name)) ?? null,
  setItem: async (name, value) => {
    await idbSet(name, value)
  },
  removeItem: async (name) => {
    await idbDel(name)
  },
}

/** Memory fallback when IndexedDB is unavailable (private mode on some browsers). */
const memory = new Map<string, string>()
const memoryStorage: StateStorage = {
  getItem: (n) => memory.get(n) ?? null,
  setItem: (n, v) => void memory.set(n, v),
  removeItem: (n) => void memory.delete(n),
}

function pickStorage(): StateStorage {
  try {
    if (typeof indexedDB !== 'undefined') return idbStorage
  } catch {
    /* ignore */
  }
  return memoryStorage
}

function detectSpeechLang(): string {
  const l = typeof navigator !== 'undefined' ? navigator.language : 'es-ES'
  return l?.toLowerCase().startsWith('es') ? l : 'es-ES'
}

export const defaultSettings = (): Settings => ({
  unit: 'kg',
  defaultRestSec: 90,
  autoStartRest: true,
  voiceAnnouncements: true,
  sounds: true,
  vibration: true,
  keepAwake: true,
  countdownBeeps: true,
  speechLang: detectSpeechLang(),
  theme: 'auto',
  updatedAt: 0,
})

export const defaultProfile = (): Profile => ({ onboarded: false, updatedAt: 0 })

export interface AppState {
  hydrated: boolean
  profile: Profile
  settings: Settings
  plan: Plan | null
  routines: Routine[] // includes tombstones (deleted: true) — use selectors below
  sessions: WorkoutSession[] // completed sessions (endedAt set), includes tombstones
  bodyLogs: BodyLog[] // includes tombstones
  customExercises: Exercise[]
  activeSession: WorkoutSession | null // in-progress workout, survives reloads

  // profile / settings / plan
  updateProfile: (patch: Partial<Profile>) => void
  updateSettings: (patch: Partial<Settings>) => void
  setPlan: (plan: Plan | null, routines?: Routine[]) => void

  // routines
  upsertRoutine: (routine: Routine) => void
  deleteRoutine: (id: ID) => void

  // custom exercises
  upsertCustomExercise: (ex: Exercise) => void

  // body
  upsertBodyLog: (log: Omit<BodyLog, 'id' | 'updatedAt'> & { id?: ID }) => void
  deleteBodyLog: (id: ID) => void

  // history
  updateSession: (id: ID, patch: Partial<WorkoutSession>) => void
  deleteSession: (id: ID) => void

  // active workout
  startWorkout: (routineId: ID | null) => WorkoutSession
  logSet: (input: LogSetInput) => LogSetResult | null
  undoLastSet: () => void
  updateActiveSet: (exIndex: number, setIndex: number, patch: Partial<SetLog>) => void
  addSet: (exIndex: number) => void
  removeSet: (exIndex: number, setIndex: number) => void
  skipExercise: (exIndex: number) => void
  swapExercise: (exIndex: number, newExerciseId: string) => void
  addExercise: (exerciseId: string) => void
  moveExercise: (from: number, to: number) => void
  setCursor: (exIndex: number, setIndex?: number) => void
  startRest: (sec: number) => void
  adjustRest: (deltaSec: number) => void
  endRest: () => void
  patchActive: (patch: Partial<WorkoutSession>) => void
  finishWorkout: () => WorkoutSession | null
  discardWorkout: () => void

  // data
  exportData: () => UserData
  importData: (data: UserData, mode: 'replace' | 'merge') => void
  resetAll: () => void
}

const now = () => Date.now()

/** Exercise lookup: built-ins + user custom. Use `useApp.getState()` outside React. */
export function getExercise(id: string): Exercise | undefined {
  return EXERCISE_INDEX().get(id) ?? useApp.getState().customExercises.find((e) => e.id === id)
}
let _index: Map<string, Exercise> | null = null
function EXERCISE_INDEX(): Map<string, Exercise> {
  if (!_index || _index.size !== EXERCISES.length) _index = new Map(EXERCISES.map((e) => [e.id, e]))
  return _index
}
export function allExercises(): Exercise[] {
  return [...EXERCISES, ...useApp.getState().customExercises]
}

function upsertById<T extends { id: ID }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id)
  if (i === -1) return [...list, item]
  const copy = list.slice()
  copy[i] = item
  return copy
}

export const useApp = create<AppState>()(
  persist(
    (set, get) => {
      /** Apply an engine transform to the active session. */
      const mutateActive = (fn: (s: WorkoutSession) => WorkoutSession) => {
        const s = get().activeSession
        if (!s) return
        set({ activeSession: { ...fn(s), updatedAt: now() } })
      }
      const history = () => get().sessions.filter((s) => !s.deleted)

      return {
        hydrated: false,
        profile: defaultProfile(),
        settings: defaultSettings(),
        plan: null,
        routines: [],
        sessions: [],
        bodyLogs: [],
        customExercises: [],
        activeSession: null,

        updateProfile: (patch) => set((st) => ({ profile: { ...st.profile, ...patch, updatedAt: now() } })),
        updateSettings: (patch) => set((st) => ({ settings: { ...st.settings, ...patch, updatedAt: now() } })),
        setPlan: (plan, routines) =>
          set((st) => {
            let list = st.routines
            if (routines) for (const r of routines) list = upsertById(list, { ...r, updatedAt: now() })
            return { plan: plan ? { ...plan, updatedAt: now() } : null, routines: list }
          }),

        upsertRoutine: (routine) => set((st) => ({ routines: upsertById(st.routines, { ...routine, updatedAt: now() }) })),
        deleteRoutine: (id) =>
          set((st) => ({
            routines: st.routines.map((r) => (r.id === id ? { ...r, deleted: true, updatedAt: now() } : r)),
            plan: st.plan ? { ...st.plan, routineIds: st.plan.routineIds.filter((x) => x !== id), updatedAt: now() } : null,
          })),

        upsertCustomExercise: (ex) => set((st) => ({ customExercises: upsertById(st.customExercises, { ...ex, custom: true }) })),

        upsertBodyLog: (log) =>
          set((st) => {
            // one log per date: merge into existing non-deleted log of the same date
            const existing = log.id
              ? st.bodyLogs.find((b) => b.id === log.id)
              : st.bodyLogs.find((b) => b.date === log.date && !b.deleted)
            const merged: BodyLog = {
              ...(existing ?? {}),
              ...log,
              id: existing?.id ?? log.id ?? uid('b_'),
              updatedAt: now(),
            } as BodyLog
            return { bodyLogs: upsertById(st.bodyLogs, merged) }
          }),
        deleteBodyLog: (id) =>
          set((st) => ({ bodyLogs: st.bodyLogs.map((b) => (b.id === id ? { ...b, deleted: true, updatedAt: now() } : b)) })),

        updateSession: (id, patch) =>
          set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: now() } : s)) })),
        deleteSession: (id) =>
          set((st) => ({ sessions: st.sessions.map((s) => (s.id === id ? { ...s, deleted: true, updatedAt: now() } : s)) })),

        startWorkout: (routineId) => {
          const st = get()
          const routine = routineId ? st.routines.find((r) => r.id === routineId && !r.deleted) ?? null : null
          const session = engine.createSession(routine, getExercise, history(), st.settings.unit)
          set({ activeSession: session })
          return session
        },
        logSet: (input) => {
          const s = get().activeSession
          if (!s) return null
          const res = engine.logSet(s, input, history())
          set({ activeSession: { ...res.session, updatedAt: now() } })
          return res
        },
        undoLastSet: () => mutateActive((s) => engine.undoLastSet(s)),
        updateActiveSet: (e, i, patch) => mutateActive((s) => engine.updateSet(s, e, i, patch)),
        addSet: (e) => mutateActive((s) => engine.addSet(s, e)),
        removeSet: (e, i) => mutateActive((s) => engine.removeSet(s, e, i)),
        skipExercise: (e) => mutateActive((s) => engine.skipExercise(s, e)),
        swapExercise: (e, id) => mutateActive((s) => engine.swapExercise(s, e, id, getExercise, history())),
        addExercise: (id) =>
          mutateActive((s) => engine.addExercise(s, id, getExercise, history(), get().settings.defaultRestSec)),
        moveExercise: (from, to) => mutateActive((s) => engine.moveExercise(s, from, to)),
        setCursor: (e, i) => mutateActive((s) => engine.setCursor(s, e, i)),
        startRest: (sec) => mutateActive((s) => engine.startRest(s, sec)),
        adjustRest: (d) => mutateActive((s) => engine.adjustRest(s, d)),
        endRest: () => mutateActive((s) => engine.endRest(s)),
        patchActive: (patch) => mutateActive((s) => ({ ...s, ...patch })),
        finishWorkout: () => {
          const s = get().activeSession
          if (!s) return null
          const done = { ...engine.finishSession(s), updatedAt: now() }
          const hasWork = done.exercises.some((e) => e.sets.some((x) => x.done))
          set((st) => ({ activeSession: null, sessions: hasWork ? [...st.sessions, done] : st.sessions }))
          return hasWork ? done : null
        },
        discardWorkout: () => set({ activeSession: null }),

        exportData: () => {
          const st = get()
          return {
            version: 1,
            profile: st.profile,
            settings: st.settings,
            plan: st.plan,
            routines: st.routines,
            sessions: st.sessions,
            bodyLogs: st.bodyLogs,
            customExercises: st.customExercises,
          }
        },
        importData: (data, mode) =>
          set((st) => {
            if (mode === 'replace') {
              return {
                profile: data.profile ?? st.profile,
                settings: { ...defaultSettings(), ...data.settings },
                plan: data.plan ?? null,
                routines: data.routines ?? [],
                sessions: data.sessions ?? [],
                bodyLogs: data.bodyLogs ?? [],
                customExercises: data.customExercises ?? [],
              }
            }
            const merge = <T extends { id: ID; updatedAt?: number }>(a: T[], b: T[] = []) => {
              const map = new Map(a.map((x) => [x.id, x]))
              for (const x of b) {
                const cur = map.get(x.id)
                if (!cur || (x.updatedAt ?? 0) > (cur.updatedAt ?? 0)) map.set(x.id, x)
              }
              return [...map.values()]
            }
            return {
              profile: (data.profile?.updatedAt ?? 0) > st.profile.updatedAt ? data.profile : st.profile,
              settings: (data.settings?.updatedAt ?? 0) > st.settings.updatedAt ? { ...st.settings, ...data.settings } : st.settings,
              plan: (data.plan?.updatedAt ?? 0) > (st.plan?.updatedAt ?? 0) ? data.plan : st.plan,
              routines: merge(st.routines, data.routines),
              sessions: merge(st.sessions, data.sessions),
              bodyLogs: merge(st.bodyLogs, data.bodyLogs),
              customExercises: merge(st.customExercises as (Exercise & { updatedAt?: number })[], data.customExercises),
            }
          }),
        resetAll: () =>
          set({
            profile: defaultProfile(),
            settings: defaultSettings(),
            plan: null,
            routines: [],
            sessions: [],
            bodyLogs: [],
            customExercises: [],
            activeSession: null,
          }),
      }
    },
    {
      name: 'gymfullness:v1',
      version: 1,
      storage: createJSONStorage(pickStorage),
      partialize: (s) => {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { hydrated, ...rest } = s
        return Object.fromEntries(Object.entries(rest).filter(([, v]) => typeof v !== 'function')) as Partial<AppState>
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>
        return { ...current, ...p, settings: { ...current.settings, ...(p.settings ?? {}) } }
      },
      onRehydrateStorage: () => () => {
        useApp.setState({ hydrated: true })
      },
    },
  ),
)

/* ---------------- selectors ----------------
 * IMPORTANT (zustand v5): a selector that returns a NEW array/object every call
 * causes an infinite render loop. Use these hooks (they wrap useShallow) instead of
 * `useApp((s) => s.routines.filter(...))`.
 */

export const selectRoutines = (s: AppState) => s.routines.filter((r) => !r.deleted)
/** Completed, non-deleted sessions, oldest → newest. */
export const selectSessions = (s: AppState) =>
  s.sessions.filter((x) => !x.deleted && x.endedAt).sort((a, b) => a.startedAt - b.startedAt)
export const selectBodyLogs = (s: AppState) =>
  s.bodyLogs.filter((b) => !b.deleted).sort((a, b) => a.date.localeCompare(b.date))

export const useRoutines = () => useApp(useShallow(selectRoutines))
export const useSessions = () => useApp(useShallow(selectSessions))
export const useBodyLogs = () => useApp(useShallow(selectBodyLogs))
