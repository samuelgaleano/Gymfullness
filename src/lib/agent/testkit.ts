/** Test helpers (shared by the agent tests). */
import { useApp, defaultSettings } from '@/store/app'
import { generatePlan } from '../planner'
import { clearPending, executeTool } from './tools'
import { __resetLocalForTests } from './local'
import type { ToolOutcome, ToolRuntime } from './types'

export function resetStore(): void {
  useApp.getState().resetAll()
  useApp.setState({ settings: defaultSettings(), hydrated: true })
  clearPending()
  __resetLocalForTests()
}

export function seedPlan(days = 3) {
  const { plan, routines } = generatePlan({ goal: 'muscle', level: 'beginner', daysPerWeek: days, equipment: 'gym' })
  useApp.getState().setPlan(plan, routines)
  useApp.getState().updateProfile({ goal: 'muscle', level: 'beginner', equipment: 'gym', onboarded: true })
  return { plan, routines }
}

export function startPlanWorkout(index = 0) {
  const { plan } = seedPlan()
  return useApp.getState().startWorkout(plan.routineIds[index])
}

let n = 0
export const tool = (name: string, args: Record<string, unknown> = {}, rt: ToolRuntime = {}): ToolOutcome =>
  executeTool({ id: `t${++n}`, name, args }, rt)
