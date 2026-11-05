/**
 * Plan generation from onboarding answers + "what's next" logic. STUB: data agent.
 */
import type { EquipmentProfile, Goal, Level, Plan, Routine, WorkoutSession } from './types'

export interface PlanInput {
  goal: Goal
  level: Level
  daysPerWeek: number // 2..6
  equipment: EquipmentProfile
}

export function generatePlan(_input: PlanInput, _now?: number): { plan: Plan; routines: Routine[] } {
  throw new Error('planner.generatePlan not implemented')
}

/** Next routine in the rotation after the most recent completed session of this plan. */
export function nextRoutineId(_plan: Plan | null, _sessions: WorkoutSession[], _routines: Routine[]): string | null {
  throw new Error('planner.nextRoutineId not implemented')
}
