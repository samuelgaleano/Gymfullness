/**
 * Small shared helpers for the routine screens (also used by Home): time estimates,
 * label maps and a guarded "start this routine" hook.
 */
import { useCallback } from 'react'
import { useLocation } from 'wouter'
import type { Exercise, Routine } from '@/lib/types'
import { getExercise, useApp } from '@/store/app'
import { EQUIPMENT_OPTIONS, GOAL_OPTIONS, LEVEL_OPTIONS } from '@/lib/planner'
import { toast } from '@/ui'

export const GOAL_LABEL = Object.fromEntries(GOAL_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>
export const LEVEL_LABEL = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>
export const PLACE_LABEL = Object.fromEntries(EQUIPMENT_OPTIONS.map((o) => [o.value, o.label])) as Record<string, string>

const SET_WORK_SEC = 40 // average time under tension + setup per set
const DEFAULT_HOLD_SEC = 30

/** Rough session length in minutes (work + rest), rounded to 5 min, never below 5. */
export function estimateMinutes(routine: Pick<Routine, 'items'>, lookup: (id: string) => Exercise | undefined = getExercise): number {
  let sec = 0
  for (const it of routine.items) {
    const ex = lookup(it.exerciseId)
    const work = ex?.kind === 'time' ? (it.targetSeconds ?? DEFAULT_HOLD_SEC) : SET_WORK_SEC
    sec += it.sets * work + Math.max(0, it.sets - 1) * it.restSec + 30 // 30 s to change station
  }
  return Math.max(5, Math.round(sec / 60 / 5) * 5)
}

export function exerciseCountLabel(n: number): string {
  return `${n} ${n === 1 ? 'ejercicio' : 'ejercicios'}`
}

/**
 * Starts a workout (routine id, or null for a free session) and opens the live screen.
 * If a session is already running it just resumes it instead of replacing it.
 */
export function useStartWorkout() {
  const [, navigate] = useLocation()
  return useCallback(
    (routineId: string | null) => {
      const st = useApp.getState()
      if (st.activeSession) {
        toast.show('Ya tienes un entreno en curso')
      } else {
        st.startWorkout(routineId)
      }
      navigate('/workout')
    },
    [navigate],
  )
}
