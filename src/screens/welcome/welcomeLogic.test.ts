import { beforeEach, describe, expect, it } from 'vitest'
import { useApp } from '@/store/app'
import { ensureDefaultPlan, finishOnboarding, hasUserData, waitForRemoteData } from './welcomeLogic'

beforeEach(() => {
  useApp.getState().resetAll()
})

describe('welcomeLogic', () => {
  it('ensureDefaultPlan creates a 3-day gym beginner plan with routines', () => {
    expect(hasUserData()).toBe(false)
    ensureDefaultPlan()
    const s = useApp.getState()
    expect(s.plan?.goal).toBe('muscle')
    expect(s.plan?.daysPerWeek).toBe(3)
    expect(s.plan?.routineIds.length).toBeGreaterThan(0)
    expect(s.routines.length).toBe(s.plan?.routineIds.length)
    expect(s.profile.level).toBe('beginner')
    expect(hasUserData()).toBe(true)
  })

  it('ensureDefaultPlan keeps an existing plan', () => {
    ensureDefaultPlan()
    const before = useApp.getState().plan
    ensureDefaultPlan()
    expect(useApp.getState().plan).toBe(before)
  })

  it('finishOnboarding stores a trimmed name, or none', () => {
    finishOnboarding('  Ana  ')
    expect(useApp.getState().profile).toMatchObject({ onboarded: true, name: 'Ana' })
    useApp.getState().resetAll()
    finishOnboarding('   ')
    expect(useApp.getState().profile.name).toBeUndefined()
    expect(useApp.getState().profile.onboarded).toBe(true)
  })

  it('waitForRemoteData resolves false when the sync ends empty', async () => {
    const r = await waitForRemoteData({ isSyncing: () => false, lastSyncAt: () => 10, since: 5, timeoutMs: 3000, intervalMs: 50 })
    expect(r).toBe(false)
  })

  it('waitForRemoteData resolves true when data arrives', async () => {
    setTimeout(() => ensureDefaultPlan(), 100)
    const r = await waitForRemoteData({ isSyncing: () => true, lastSyncAt: () => null, since: 5, timeoutMs: 3000, intervalMs: 50 })
    expect(r).toBe(true)
  })
})
