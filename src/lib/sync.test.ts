import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BodyLog, Exercise, Plan, Profile, Routine, Settings, UserData, WorkoutSession } from './types'

/* ------------------------------------------------------------------ fake Firestore */

class FakeTimestamp {
  constructor(
    readonly seconds: number,
    readonly nanoseconds: number,
  ) {}
}
const SERVER_TS = { __serverTimestamp: true }
type Doc = Record<string, unknown>
interface FakeQuery {
  path: string
  where?: { field: string; op: string; value: FakeTimestamp }
}

const fake = {
  server: new Map<string, Doc>(),
  clock: 1_000,
  reads: 0,
  commits: [] as number[],
  reset() {
    this.server.clear()
    this.clock = 1_000
    this.reads = 0
    this.commits = []
  },
}

const cmpTs = (a: unknown, b: FakeTimestamp) =>
  a instanceof FakeTimestamp ? a.seconds - b.seconds || a.nanoseconds - b.nanoseconds : -1

const fakeFs = {
  Timestamp: FakeTimestamp,
  collection: (_db: unknown, ...segs: string[]): FakeQuery => ({ path: segs.join('/') }),
  doc: (_db: unknown, ...segs: string[]) => ({ path: segs.join('/') }),
  where: (field: string, op: string, value: FakeTimestamp) => ({ field, op, value }),
  query: (ref: FakeQuery, w: FakeQuery['where']): FakeQuery => ({ path: ref.path, where: w }),
  serverTimestamp: () => SERVER_TS,
  getDocs: async (q: FakeQuery) => {
    const prefix = `${q.path}/`
    const docs = [...fake.server.entries()]
      .filter(([p]) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .filter(([, d]) => !q.where || cmpTs(d._syncedAt, q.where.value) > 0)
      .map(([p, d]) => {
        const { _syncedAt, ...rest } = d
        return {
          id: p.slice(prefix.length),
          ref: { path: p },
          data: () => ({ ...(JSON.parse(JSON.stringify(rest)) as Doc), _syncedAt }),
        }
      })
    fake.reads += Math.max(1, docs.length) // Firestore bills ≥ 1 read per query
    return { docs }
  },
  writeBatch: () => {
    const ops: (['set', string, Doc] | ['delete', string])[] = []
    return {
      set: (ref: { path: string }, data: Doc) => void ops.push(['set', ref.path, data]),
      delete: (ref: { path: string }) => void ops.push(['delete', ref.path]),
      commit: async () => {
        if (ops.length > 500) throw Object.assign(new Error('too many'), { code: 'invalid-argument' })
        fake.clock += 1
        const ts = new FakeTimestamp(fake.clock, 0)
        for (const op of ops) {
          if (op[0] === 'delete') fake.server.delete(op[1])
          else {
            const data = JSON.parse(JSON.stringify({ ...op[2], _syncedAt: null })) as Doc
            if (Object.values(op[2]).includes(undefined)) throw new Error('undefined field')
            fake.server.set(op[1], { ...data, _syncedAt: op[2]._syncedAt === SERVER_TS ? ts : null })
          }
        }
        fake.commits.push(ops.length)
      },
    }
  },
}

vi.mock('./firebase', () => ({
  loadFirebase: async () => ({ app: {}, auth: {}, db: {}, authMod: {}, fs: fakeFs }),
}))

const sync = await import('./sync')
const { useApp, defaultSettings, defaultProfile } = await import('@/store/app')

/* ------------------------------------------------------------------ fixtures */

const routine = (id: string, updatedAt: number, extra: Partial<Routine> = {}): Routine => ({
  id,
  name: `Rutina ${id}`,
  items: [],
  createdAt: 1,
  updatedAt,
  ...extra,
})

const session = (id: string, updatedAt: number, extra: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id,
  name: 'Día A',
  unit: 'kg',
  startedAt: updatedAt - 100,
  endedAt: updatedAt - 10,
  exercises: [],
  cursor: { ex: 0, set: 0 },
  updatedAt,
  ...extra,
})

const bodyLog = (id: string, updatedAt: number, weight = 80): BodyLog => ({
  id,
  date: '2026-11-01',
  weight,
  unit: 'kg',
  updatedAt,
})

const customEx = (id: string, name = 'Mi ejercicio'): Exercise => ({
  id,
  name,
  aliases: [],
  primary: 'chest',
  secondary: [],
  equipment: ['dumbbell'],
  kind: 'weight_reps',
  level: 'beginner',
  isCompound: false,
  defaultRestSec: 90,
  increment: 2,
  setup: [],
  cues: ['Controla'],
  mistakes: [],
  custom: true,
})

const settings = (updatedAt: number, patch: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  updatedAt,
  ...patch,
})

const userData = (patch: Partial<UserData> = {}): UserData => ({
  version: 1,
  profile: { onboarded: false, updatedAt: 0 },
  settings: settings(0),
  plan: null,
  routines: [],
  sessions: [],
  bodyLogs: [],
  customExercises: [],
  ...patch,
})

/* ------------------------------------------------------------------ merge */

describe('mergeUserData — records', () => {
  it('newer record wins on either side', () => {
    const local = userData({ routines: [routine('a', 100, { name: 'local A' }), routine('b', 300, { name: 'local B' })] })
    const remote = { routines: [routine('a', 200, { name: 'remote A' }), routine('b', 250, { name: 'remote B' })] }
    const merged = sync.mergeUserData(local, remote)
    expect(merged.routines.map((r) => r.name)).toEqual(['remote A', 'local B'])
  })

  it('on equal updatedAt the local copy is kept', () => {
    const local = userData({ sessions: [session('s', 500, { name: 'local' })] })
    const merged = sync.mergeUserData(local, { sessions: [session('s', 500, { name: 'remote' })] })
    expect(merged.sessions[0].name).toBe('local')
  })

  it('tombstones win when newer, lose when older, win ties', () => {
    const local = userData({
      routines: [routine('newer-del', 100), routine('older-del', 300), routine('tie', 200)],
    })
    const remote = {
      routines: [
        routine('newer-del', 200, { deleted: true }),
        routine('older-del', 250, { deleted: true }),
        routine('tie', 200, { deleted: true }),
      ],
    }
    const byId = new Map(sync.mergeUserData(local, remote).routines.map((r) => [r.id, r]))
    expect(byId.get('newer-del')?.deleted).toBe(true)
    expect(byId.get('older-del')?.deleted).toBeUndefined()
    expect(byId.get('tie')?.deleted).toBe(true)
  })

  it('a newer local edit beats an older remote tombstone (resurrect)', () => {
    const local = userData({ bodyLogs: [bodyLog('b', 900, 81)] })
    const merged = sync.mergeUserData(local, { bodyLogs: [{ ...bodyLog('b', 800), deleted: true }] })
    expect(merged.bodyLogs[0]).toMatchObject({ weight: 81 })
    expect(merged.bodyLogs[0].deleted).toBeUndefined()
  })

  it('keeps local-only records and adds remote-only ones (oldest first, after local)', () => {
    const local = userData({ sessions: [session('local-1', 50)] })
    const remote = { sessions: [session('remote-2', 300), session('remote-1', 200)] }
    const merged = sync.mergeUserData(local, remote)
    expect(merged.sessions.map((s) => s.id)).toEqual(['local-1', 'remote-1', 'remote-2'])
  })

  it('never drops local data when remote is empty or missing', () => {
    const local = userData({ routines: [routine('a', 1)], bodyLogs: [bodyLog('b', 2)] })
    expect(sync.mergeUserData(local, {})).toEqual(local)
    expect(sync.mergeUserData(local, { routines: [], bodyLogs: [] })).toEqual(local)
  })

  it('reports no change (and returns the same arrays) when nothing differs', () => {
    const local = userData({ routines: [routine('a', 5)] })
    const res = sync.mergeWithStats(local, { routines: [routine('a', 5)] })
    expect(res.changed).toBe(false)
    expect(res.data.routines).toBe(local.routines)
  })

  it('ignores malformed remote records', () => {
    const local = userData()
    const merged = sync.mergeUserData(local, { routines: [{ name: 'sin id' } as unknown as Routine] })
    expect(merged.routines).toEqual([])
  })

  it('custom exercises: a stamped remote copy beats an unstamped local copy', () => {
    const local = userData({ customExercises: [customEx('c1', 'Viejo')] })
    const remote = { customExercises: [{ ...customEx('c1', 'Nuevo'), updatedAt: 1000 } as Exercise] }
    expect(sync.mergeUserData(local, remote).customExercises[0].name).toBe('Nuevo')
  })
})

describe('mergeUserData — profile, settings, plan', () => {
  it('settings: newer updatedAt wins', () => {
    const local = userData({ settings: settings(100, { defaultRestSec: 90 }) })
    expect(sync.mergeUserData(local, { settings: settings(200, { defaultRestSec: 120 }) }).settings.defaultRestSec).toBe(120)
    expect(sync.mergeUserData(local, { settings: settings(50, { defaultRestSec: 60 }) }).settings.defaultRestSec).toBe(90)
  })

  it('settings: untouched local defaults (updatedAt 0) take the cloud settings', () => {
    const local = userData({ settings: settings(0) })
    const merged = sync.mergeUserData(local, { settings: settings(10, { unit: 'lb' }) })
    expect(merged.settings.unit).toBe('lb')
  })

  it('profile: newer wins, but missing fields are filled from the older copy', () => {
    const local = userData({ profile: { onboarded: true, updatedAt: 900 } })
    const remote: Profile = { name: 'Ana', goal: 'muscle', level: 'beginner', onboarded: true, updatedAt: 500 }
    const merged = sync.mergeUserData(local, { profile: remote })
    expect(merged.profile).toMatchObject({ name: 'Ana', goal: 'muscle', level: 'beginner', onboarded: true, updatedAt: 900 })
  })

  it('profile: remote newer overrides local values; onboarded is sticky', () => {
    const local = userData({ profile: { goal: 'strength', onboarded: true, updatedAt: 100 } })
    const merged = sync.mergeUserData(local, { profile: { goal: 'fat_loss', onboarded: false, updatedAt: 200 } })
    expect(merged.profile.goal).toBe('fat_loss')
    expect(merged.profile.onboarded).toBe(true)
  })

  it('plan: newer wins; null/missing remote never clears a local plan', () => {
    const plan = (updatedAt: number, days: number): Plan => ({
      routineIds: ['a'],
      daysPerWeek: days,
      goal: 'muscle',
      level: 'beginner',
      equipment: 'gym',
      updatedAt,
    })
    const local = userData({ plan: plan(100, 3) })
    expect(sync.mergeUserData(local, { plan: plan(200, 4) }).plan?.daysPerWeek).toBe(4)
    expect(sync.mergeUserData(local, { plan: plan(50, 5) }).plan?.daysPerWeek).toBe(3)
    expect(sync.mergeUserData(local, { plan: null }).plan?.daysPerWeek).toBe(3)
    expect(sync.mergeUserData(userData(), { plan: plan(1, 2) }).plan?.daysPerWeek).toBe(2)
  })
})

/* ------------------------------------------------------------------ serialization */

describe('serialization helpers', () => {
  it('stripUndefined removes undefined fields deeply and nulls undefined array items', () => {
    const out = sync.stripUndefined({ a: 1, b: undefined, c: { d: undefined, e: [1, undefined, { f: undefined }] } })
    expect(out).toEqual({ a: 1, c: { e: [1, null, {}] } })
  })

  it('stableStringify ignores key order', () => {
    expect(sync.stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(sync.stableStringify({ a: { c: 3, d: 2 }, b: 1 }))
  })

  it('fingerprint: updatedAt for records, content hash for custom exercises', () => {
    expect(sync.fingerprint('routines', routine('a', 7))).toBe('u7')
    expect(sync.fingerprint('routines', routine('a', 7, { deleted: true }))).toBe('u7d')
    const a = sync.fingerprint('customExercises', customEx('c', 'A'))
    expect(sync.fingerprint('customExercises', { ...customEx('c', 'A'), updatedAt: 999 })).toBe(a)
    expect(sync.fingerprint('customExercises', customEx('c', 'B'))).not.toBe(a)
  })

  it('chunk splits into batches of at most 450', () => {
    expect(sync.chunk(Array.from({ length: 1000 }, (_, i) => i)).map((c) => c.length)).toEqual([450, 450, 100])
  })

  it('buildPendingOps: only what the server lacks, never in-progress sessions, no untouched defaults', () => {
    const data = userData({
      routines: [routine('known', 10), routine('changed', 20)],
      sessions: [session('done', 30), session('open', 40, { endedAt: null })],
      settings: settings(0),
      profile: { onboarded: true, updatedAt: 5 },
    })
    const { ops } = sync.buildPendingOps(data, { 'routines/known': 'u10', 'routines/changed': 'u15' })
    expect(ops.map((o) => o.key).sort()).toEqual(['meta/profile', 'routines/changed', 'sessions/done'])
    for (const op of ops) expect(JSON.stringify(op.data)).not.toContain('undefined')
  })

  it('isValidDocId rejects ids Firestore cannot store', () => {
    expect(sync.isValidDocId('r_abc123')).toBe(true)
    for (const bad of ['', 'a/b', '.', '..', '__x__']) expect(sync.isValidDocId(bad)).toBe(false)
  })

  it('syncErrorMessage: silent for transient errors, friendly otherwise', () => {
    expect(sync.syncErrorMessage({ code: 'unavailable' })).toBeNull()
    expect(sync.syncErrorMessage(new TypeError('Failed to fetch'))).toBeNull()
    expect(sync.syncErrorMessage({ code: 'permission-denied' })).toMatch(/reglas de Firestore/)
    expect(sync.syncErrorMessage({ code: 'resource-exhausted' })).toMatch(/límite gratuito/)
  })
})

/* ------------------------------------------------------------------ I/O + auto sync (fake Firestore) */

function resetStore(patch: Partial<UserData> & { activeSession?: WorkoutSession | null } = {}) {
  useApp.setState({
    hydrated: true,
    profile: defaultProfile(),
    settings: defaultSettings(),
    plan: null,
    routines: [],
    sessions: [],
    bodyLogs: [],
    customExercises: [],
    activeSession: null,
    ...patch,
  })
}

describe('pushAll / pushChanged / pullAll', () => {
  beforeEach(() => {
    fake.reset()
    resetStore()
  })

  it('pushAll writes in batches of ≤ 450 to users/{uid}/…', async () => {
    const sessions = Array.from({ length: 1000 }, (_, i) => session(`s${i}`, 100 + i))
    const n = await sync.pushAll('u1', userData({ sessions }))
    expect(n).toBe(1000)
    expect(fake.commits).toEqual([450, 450, 100])
    expect(fake.server.has('users/u1/sessions/s999')).toBe(true)
  })

  it('pushChanged only uploads records updated since the timestamp', async () => {
    resetStore({ routines: [routine('old', 100), routine('new', 500)], bodyLogs: [bodyLog('b', 600)] })
    const n = await sync.pushChanged('u1', 400)
    expect(n).toBe(2)
    expect([...fake.server.keys()].sort()).toEqual(['users/u1/bodyLogs/b', 'users/u1/routines/new'])
  })

  it('pullAll returns clean records (no _syncedAt) and the newest watermark', async () => {
    await sync.pushAll('u1', userData({ routines: [routine('a', 1)], settings: settings(3) }))
    const snap = await sync.pullAll('u1')
    expect(snap.data.routines?.[0]).toEqual(routine('a', 1))
    expect(snap.data.settings?.updatedAt).toBe(3)
    expect(snap.watermark).toEqual({ s: 1001, n: 0 })
    expect(snap.fingerprints['routines/a']).toBe('u1')
  })
})

describe('startAutoSync', () => {
  let statuses: { syncing: boolean; lastSyncAt?: number; error?: string | null }[]
  const lastSyncCount = () => statuses.filter((s) => s.lastSyncAt !== undefined).length

  beforeEach(() => {
    fake.reset()
    statuses = []
    localStorage.clear()
  })
  afterEach(() => sync.stopAutoSync())

  it('full sync on login: pull → merge → import → push what the server lacks; never the active session', async () => {
    // cloud: newer routine A, a session from another device
    await sync.pushAll('u1', userData({ routines: [routine('A', 2000, { name: 'remote A' })], sessions: [session('S-remote', 1500)] }))
    fake.commits = []
    // device: older routine A, a local-only body log, a workout in progress
    resetStore({
      routines: [routine('A', 1000, { name: 'local A' })],
      bodyLogs: [bodyLog('B-local', 1200)],
      activeSession: session('ACTIVE', 1300, { endedAt: null }),
    })

    sync.startAutoSync('u1', { onStatus: (s) => statuses.push(s) })
    await vi.waitFor(() => expect(lastSyncCount()).toBe(1))

    const st = useApp.getState()
    expect(st.routines.find((r) => r.id === 'A')?.name).toBe('remote A')
    expect(st.sessions.map((s) => s.id)).toEqual(['S-remote'])
    expect(st.bodyLogs.map((b) => b.id)).toEqual(['B-local'])
    expect(st.activeSession?.id).toBe('ACTIVE')
    expect(fake.server.has('users/u1/bodyLogs/B-local')).toBe(true)
    expect([...fake.server.keys()].some((k) => k.includes('ACTIVE'))).toBe(false)
    // only the body log was missing remotely: one small batch, nothing re-uploaded
    expect(fake.commits).toEqual([1])
    expect(statuses.at(-1)).toMatchObject({ syncing: false, error: null })
  })

  it('debounces local changes into a push, then later pulls read only changed docs', async () => {
    resetStore({ routines: [routine('R', 10)] })
    sync.startAutoSync('u1', { onStatus: (s) => statuses.push(s) })
    await vi.waitFor(() => expect(lastSyncCount()).toBe(1))
    expect(fake.server.has('users/u1/routines/R')).toBe(true)

    useApp.getState().updateSettings({ defaultRestSec: 120 })
    useApp.getState().updateSettings({ defaultRestSec: 150 }) // coalesced by the debounce
    await vi.waitFor(() => expect(lastSyncCount()).toBe(2), { timeout: 5000 })
    expect(fake.server.get('users/u1/meta/settings')?.defaultRestSec).toBe(150)

    // another device writes one session; an incremental pull reads ~1 doc per collection, not everything
    await sync.pushAll('u1', userData({ sessions: [session('S2', 5000)] }))
    fake.reads = 0
    await sync.requestSync('pull')
    expect(useApp.getState().sessions.map((s) => s.id)).toContain('S2')
    expect(fake.reads).toBeLessThanOrEqual(6)
  }, 10_000)

  it('waits for the local store to hydrate before syncing (even on syncNow)', async () => {
    await sync.pushAll('u1', userData({ routines: [routine('R-cloud', 50)] }))
    fake.reads = 0
    resetStore()
    useApp.setState({ hydrated: false })
    sync.startAutoSync('u1', { onStatus: (s) => statuses.push(s) })
    const done = sync.requestSync('full')
    await new Promise((r) => setTimeout(r, 20))
    expect(fake.reads).toBe(0)
    // hydration brings the persisted local data
    useApp.setState({ hydrated: true, bodyLogs: [bodyLog('B-persisted', 70)] })
    await done
    const st = useApp.getState()
    expect(st.routines.map((r) => r.id)).toEqual(['R-cloud'])
    expect(st.bodyLogs.map((b) => b.id)).toEqual(['B-persisted'])
    expect(fake.server.has('users/u1/bodyLogs/B-persisted')).toBe(true)
  })

  it('stopAutoSync stops pushing local changes', async () => {
    resetStore()
    sync.startAutoSync('u1', { onStatus: (s) => statuses.push(s) })
    await vi.waitFor(() => expect(lastSyncCount()).toBe(1))
    sync.stopAutoSync()
    fake.commits = []
    useApp.getState().upsertRoutine(routine('late', 1))
    await new Promise((r) => setTimeout(r, 2300))
    expect(fake.commits).toEqual([])
    expect(sync.autoSyncUid()).toBeNull()
  }, 10_000)
})
