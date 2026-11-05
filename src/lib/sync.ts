/**
 * Optional cloud sync (Firestore). The app stays local-first: the zustand store (IndexedDB) is
 * the source of truth and this module mirrors COMPLETED data to
 *   users/{uid}/{routines|sessions|bodyLogs|customExercises}/{id}
 *   users/{uid}/meta/{profile|settings|plan}
 * The in-progress `activeSession` is never synced.
 *
 * Free-tier friendly (Firebase Spark):
 * - No realtime listeners. Pulls are one-shot queries.
 * - Every write carries `_syncedAt: serverTimestamp()`, so later pulls only read documents
 *   changed since the last pull (`_syncedAt > watermark`) — a few reads instead of the whole
 *   history. A full pull happens on first login on a device, weekly, and on "Sincronizar ahora".
 * - Pushes only send records that differ from what this device knows the server has
 *   (per-record fingerprints), debounced 2 s, in batches of at most 450 writes.
 *
 * Conflict policy: per-record last-write-wins by `updatedAt`; on a tie a tombstone wins; local
 * records the server doesn't know are always kept and pushed.
 */
import type { DocumentData, Query, QueryDocumentSnapshot } from 'firebase/firestore/lite'
import type { BodyLog, Exercise, Plan, Profile, Routine, Settings, UserData, WorkoutSession } from './types'
import { loadFirebase, type FirebaseHandles } from './firebase'
import { useApp, type AppState } from '@/store/app'

/* ================================================================ constants */

export const RECORD_COLLECTIONS = ['routines', 'sessions', 'bodyLogs', 'customExercises'] as const
export type RecordCollection = (typeof RECORD_COLLECTIONS)[number]
export const META_DOCS = ['profile', 'settings', 'plan'] as const
export type MetaDoc = (typeof META_DOCS)[number]
/** Firestore allows 500 writes per batch; stay well below. */
export const MAX_BATCH_OPS = 450
/** Field added to every remote document (server time of the write). */
export const SYNCED_AT_FIELD = '_syncedAt'

const PUSH_DEBOUNCE_MS = 2_000
const RESYNC_THROTTLE_MS = 60_000
const FULL_SYNC_EVERY_MS = 7 * 24 * 60 * 60 * 1000
const RETRY_MS = 30_000
const IO_TIMEOUT_MS = 25_000
/** Firestore's hard limit is 1 MiB per document. */
const MAX_DOC_CHARS = 900_000

interface SyncRecord {
  id: string
  updatedAt?: number
  deleted?: boolean
}

/* ================================================================ pure helpers */

function isPlainObject(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === 'object' && !Array.isArray(x)
}

/** `updatedAt` as a finite number, 0 when missing. */
export function updatedAtOf(x: unknown): number {
  const v = isPlainObject(x) ? x.updatedAt : undefined
  return typeof v === 'number' && Number.isFinite(v) ? v : 0
}

function isSyncRecord(x: unknown): x is SyncRecord {
  return isPlainObject(x) && typeof x.id === 'string' && x.id.length > 0
}

/** Remote replaces local when strictly newer; on a tie a tombstone wins (deletes are deliberate). */
export function remoteWins(local: SyncRecord, remote: SyncRecord): boolean {
  const l = updatedAtOf(local)
  const r = updatedAtOf(remote)
  if (r !== l) return r > l
  return remote.deleted === true && local.deleted !== true
}

function sortKey(x: unknown): number {
  if (!isPlainObject(x)) return 0
  for (const k of ['createdAt', 'startedAt', 'updatedAt'] as const) {
    const v = x[k]
    if (typeof v === 'number' && Number.isFinite(v)) return v
  }
  return 0
}

/**
 * Per-record last-write-wins merge. Keeps local order, replaces records the remote has newer,
 * appends remote-only records (oldest first). Never drops a local record.
 * Returns the local array itself when nothing changed.
 */
export function mergeRecords<T extends SyncRecord>(
  local: readonly T[],
  remote: readonly unknown[] | undefined,
): { list: T[]; changed: boolean } {
  if (!remote || remote.length === 0) return { list: local as T[], changed: false }
  const remoteById = new Map<string, T>()
  for (const r of remote) {
    if (!isSyncRecord(r)) continue
    const prev = remoteById.get(r.id)
    if (!prev || remoteWins(prev, r)) remoteById.set(r.id, r as T)
  }
  let changed = false
  const seen = new Set<string>()
  const list = local.map((l) => {
    seen.add(l.id)
    const r = remoteById.get(l.id)
    if (r && remoteWins(l, r)) {
      changed = true
      return r
    }
    return l
  })
  const added = [...remoteById.values()].filter((r) => !seen.has(r.id)).sort((a, b) => sortKey(a) - sortKey(b))
  if (added.length) {
    changed = true
    list.push(...added)
  }
  return changed ? { list, changed } : { list: local as T[], changed: false }
}

function definedOnly<T extends object>(o: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) (out as Record<string, unknown>)[k] = v
  return out
}

function shallowEqual(a: object, b: object): boolean {
  const ka = Object.keys(a).filter((k) => (a as Record<string, unknown>)[k] !== undefined)
  const kb = Object.keys(b).filter((k) => (b as Record<string, unknown>)[k] !== undefined)
  if (ka.length !== kb.length) return false
  return ka.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

/**
 * Profile: the newer object wins field by field, but fields it doesn't have are filled from the
 * older one (a fresh device that only set `onboarded` must not wipe goal/level from the cloud).
 * `onboarded` is sticky: once onboarded anywhere, onboarded everywhere.
 */
export function mergeProfile(local: Profile, remote: unknown): { value: Profile; changed: boolean } {
  if (!isPlainObject(remote)) return { value: local, changed: false }
  const r = remote as unknown as Profile
  const remoteNewer = updatedAtOf(r) > updatedAtOf(local)
  const newer = remoteNewer ? r : local
  const older = remoteNewer ? local : r
  const value: Profile = {
    ...definedOnly(older),
    ...definedOnly(newer),
    onboarded: Boolean(local.onboarded || r.onboarded),
    updatedAt: Math.max(updatedAtOf(local), updatedAtOf(r)),
  }
  return shallowEqual(value, local) ? { value: local, changed: false } : { value, changed: true }
}

/** Settings: newer object wins (missing keys keep the local value). */
export function mergeSettings(local: Settings, remote: unknown): { value: Settings; changed: boolean } {
  if (!isPlainObject(remote) || updatedAtOf(remote) <= updatedAtOf(local)) return { value: local, changed: false }
  const value: Settings = { ...local, ...(definedOnly(remote) as Partial<Settings>) }
  return shallowEqual(value, local) ? { value: local, changed: false } : { value, changed: true }
}

/** Plan: newer wins; a missing/null remote plan never clears a local one. */
export function mergePlan(local: Plan | null, remote: unknown): { value: Plan | null; changed: boolean } {
  if (!isPlainObject(remote) || !Array.isArray(remote.routineIds)) return { value: local, changed: false }
  const r = remote as unknown as Plan
  if (!local || updatedAtOf(r) > updatedAtOf(local)) return { value: r, changed: true }
  return { value: local, changed: false }
}

/** `mergeUserData` plus whether anything changed relative to `local`. */
export function mergeWithStats(local: UserData, remote: Partial<UserData>): { data: UserData; changed: boolean } {
  const routines = mergeRecords<Routine>(local.routines, remote.routines)
  const sessions = mergeRecords<WorkoutSession>(local.sessions, remote.sessions)
  const bodyLogs = mergeRecords<BodyLog>(local.bodyLogs, remote.bodyLogs)
  const customExercises = mergeRecords<Exercise>(local.customExercises, remote.customExercises)
  const profile = mergeProfile(local.profile, remote.profile)
  const settings = mergeSettings(local.settings, remote.settings)
  const plan = mergePlan(local.plan, remote.plan)
  const changed =
    routines.changed ||
    sessions.changed ||
    bodyLogs.changed ||
    customExercises.changed ||
    profile.changed ||
    settings.changed ||
    plan.changed
  return {
    changed,
    data: {
      version: 1,
      profile: profile.value,
      settings: settings.value,
      plan: plan.value,
      routines: routines.list,
      sessions: sessions.list,
      bodyLogs: bodyLogs.list,
      customExercises: customExercises.list,
    },
  }
}

/**
 * Pure merge of local data with (possibly partial) remote data.
 * Records: per-record last-write-wins by `updatedAt`, tombstones win ties, local-only records
 * kept, remote-only records added. Profile/settings/plan: newer `updatedAt` wins.
 */
export function mergeUserData(local: UserData, remote: Partial<UserData>): UserData {
  return mergeWithStats(local, remote).data
}

/* ---------------------------------------------------------------- serialization */

/**
 * Deep copy that Firestore accepts: drops `undefined` object fields (Firestore rejects them),
 * turns `undefined` array items into null, drops functions/symbols.
 */
export function stripUndefined(value: unknown): unknown {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return undefined
  if (value === null) return null
  if (typeof value === 'bigint') return Number(value)
  if (Array.isArray(value)) {
    return value.map((v) => {
      const s = stripUndefined(v)
      return s === undefined ? null : s
    })
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = stripUndefined(v)
      if (s !== undefined) out[k] = s
    }
    return out
  }
  return value
}

/** JSON with sorted keys (key order from Firestore is not guaranteed). */
export function stableStringify(v: unknown): string {
  if (v === undefined) return 'null'
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const o = v as Record<string, unknown>
  const keys = Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`
}

/** FNV-1a 32-bit, base36. Only used to detect content changes. */
function hashString(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

/**
 * Version fingerprint of a record, compared against what the server is known to have.
 * Timestamped records use `updatedAt` (+ tombstone flag). Custom exercises have no reliable
 * `updatedAt` (the store doesn't stamp them), so their content hash is used instead.
 */
export function fingerprint(col: RecordCollection | 'meta', rec: unknown): string {
  if (col === 'customExercises') {
    const { updatedAt: _ignored, ...rest } = (isPlainObject(rec) ? rec : {}) as Record<string, unknown>
    return `h${hashString(stableStringify(stripUndefined(rest)))}`
  }
  const deleted = isPlainObject(rec) && rec.deleted === true
  return `u${updatedAtOf(rec)}${deleted ? 'd' : ''}`
}

const recordKey = (col: RecordCollection | 'meta', id: string) => `${col}/${id}`

/** Firestore document id rules: no '/', not '.' or '..', not `__x__`, ≤ 1500 bytes. */
export function isValidDocId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    id.length <= 700 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id)
  )
}

export function chunk<T>(items: readonly T[], size: number = MAX_BATCH_OPS): T[][] {
  const out: T[][] = []
  const n = Math.max(1, Math.floor(size))
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n))
  return out
}

export interface WriteOp {
  key: string
  col: RecordCollection | 'meta'
  id: string
  data: Record<string, unknown>
}

function toDoc(col: RecordCollection | 'meta', rec: unknown, now: number): Record<string, unknown> | null {
  const data = stripUndefined(rec)
  if (!isPlainObject(data)) return null
  delete data[SYNCED_AT_FIELD]
  // Stamp custom exercises so other devices can tell which copy is newer.
  if (col === 'customExercises') data.updatedAt = now
  if (stableStringify(data).length > MAX_DOC_CHARS) {
    console.warn('[sync] document too large, skipped', col)
    return null
  }
  return data
}

/** Completed sessions only (and tombstones): never anything in progress. */
function isSyncableSession(s: WorkoutSession): boolean {
  return s.deleted === true || (typeof s.endedAt === 'number' && s.endedAt > 0)
}

/**
 * Write operations for every record/meta doc whose fingerprint differs from `known`
 * (what the server is known to have). Pure. Returns the fingerprints to record once committed.
 */
export function buildPendingOps(
  data: UserData,
  known: Readonly<Record<string, string>>,
  now: number = Date.now(),
): { ops: WriteOp[]; fingerprints: Record<string, string> } {
  const ops: WriteOp[] = []
  const fingerprints: Record<string, string> = {}
  const add = (col: RecordCollection | 'meta', id: string, rec: unknown) => {
    const key = recordKey(col, id)
    const fp = fingerprint(col, rec)
    if (known[key] === fp) return
    const doc = toDoc(col, rec, now)
    if (!doc) return
    ops.push({ key, col, id, data: doc })
    fingerprints[key] = fp
  }
  for (const col of RECORD_COLLECTIONS) {
    for (const rec of data[col] as readonly SyncRecord[]) {
      if (!isValidDocId(rec.id)) continue
      if (col === 'sessions' && !isSyncableSession(rec as WorkoutSession)) continue
      add(col, rec.id, rec)
    }
  }
  // meta docs: skip untouched defaults (updatedAt 0)
  if (updatedAtOf(data.profile) > 0) add('meta', 'profile', data.profile)
  if (updatedAtOf(data.settings) > 0) add('meta', 'settings', data.settings)
  if (data.plan && updatedAtOf(data.plan) > 0) add('meta', 'plan', data.plan)
  return { ops, fingerprints }
}

/* ---------------------------------------------------------------- remote validation */

function validRemote(col: RecordCollection, rec: Record<string, unknown>): boolean {
  if (rec.deleted === true) return true // tombstones only need an id
  switch (col) {
    case 'routines':
      return typeof rec.name === 'string' && Array.isArray(rec.items)
    case 'sessions':
      return typeof rec.startedAt === 'number' && Array.isArray(rec.exercises)
    case 'bodyLogs':
      return typeof rec.date === 'string'
    case 'customExercises':
      return typeof rec.name === 'string' && Array.isArray(rec.cues) && typeof rec.primary === 'string'
  }
}

/* ---------------------------------------------------------------- watermark */

/** Server timestamp of the newest document seen (exact, seconds + nanoseconds). */
export interface Watermark {
  s: number
  n: number
}

function cmpWatermark(a: Watermark, b: Watermark): number {
  return a.s - b.s || a.n - b.n
}

/* ================================================================ I/O */

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e: unknown) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

async function readCollection(
  h: FirebaseHandles,
  uid: string,
  col: RecordCollection | 'meta',
  since: Watermark | null,
): Promise<QueryDocumentSnapshot<DocumentData>[]> {
  const ref = h.fs.collection(h.db, 'users', uid, col)
  const q: Query<DocumentData> = since
    ? h.fs.query(ref, h.fs.where(SYNCED_AT_FIELD, '>', new h.fs.Timestamp(since.s, since.n)))
    : ref
  const snap = await withTimeout(h.fs.getDocs(q), IO_TIMEOUT_MS)
  return snap.docs
}

export interface RemoteSnapshot {
  /** Remote data (only what was read: everything for a full pull, changes for incremental). */
  data: Partial<UserData>
  /** Fingerprint of every record read, keyed `${collection}/${id}` / `meta/${name}`. */
  fingerprints: Record<string, string>
  /** Newest `_syncedAt` seen, or null if nothing was read. */
  watermark: Watermark | null
  /** Documents read (≈ billed reads). */
  count: number
}

/** Reads remote data; `since` = only documents written after that server time. */
export async function pullSince(uid: string, since: Watermark | null): Promise<RemoteSnapshot> {
  const h = await loadFirebase()
  const cols = [...RECORD_COLLECTIONS, 'meta'] as const
  const results = await Promise.all(cols.map((c) => readCollection(h, uid, c, since)))

  const lists: Record<RecordCollection, unknown[]> = { routines: [], sessions: [], bodyLogs: [], customExercises: [] }
  const data: Partial<UserData> = {}
  const fingerprints: Record<string, string> = {}
  let watermark: Watermark | null = null
  let count = 0

  results.forEach((docs, i) => {
    const col = cols[i]
    for (const d of docs) {
      count++
      const raw = d.data()
      const ts = raw[SYNCED_AT_FIELD]
      if (ts instanceof h.fs.Timestamp) {
        const wm = { s: ts.seconds, n: ts.nanoseconds }
        if (!watermark || cmpWatermark(wm, watermark) > 0) watermark = wm
      }
      const rec: Record<string, unknown> = { ...raw }
      delete rec[SYNCED_AT_FIELD]
      if (col === 'meta') {
        if (d.id === 'profile') data.profile = rec as unknown as Profile
        else if (d.id === 'settings') data.settings = rec as unknown as Settings
        else if (d.id === 'plan') data.plan = rec as unknown as Plan
        else continue
        fingerprints[recordKey('meta', d.id)] = fingerprint('meta', rec)
        continue
      }
      if (typeof rec.id !== 'string' || !rec.id) rec.id = d.id
      if (!validRemote(col, rec)) continue
      lists[col].push(rec)
      fingerprints[recordKey(col, rec.id as string)] = fingerprint(col, rec)
    }
  })
  // Remote docs were written by this app from the same types; shape validated above.
  data.routines = lists.routines as Routine[]
  data.sessions = lists.sessions as WorkoutSession[]
  data.bodyLogs = lists.bodyLogs as BodyLog[]
  data.customExercises = lists.customExercises as Exercise[]
  return { data, fingerprints, watermark, count }
}

/** Reads everything the user has in the cloud. */
export function pullAll(uid: string): Promise<RemoteSnapshot> {
  return pullSince(uid, null)
}

/** Commits ops in batches of ≤ 450; `onCommitted` runs after each batch succeeds. */
async function commitOps(
  uid: string,
  ops: readonly WriteOp[],
  onCommitted?: (part: WriteOp[]) => void,
): Promise<number> {
  if (!ops.length) return 0
  const h = await loadFirebase()
  let n = 0
  for (const part of chunk(ops, MAX_BATCH_OPS)) {
    const batch = h.fs.writeBatch(h.db)
    for (const op of part) {
      batch.set(h.fs.doc(h.db, 'users', uid, op.col, op.id), { ...op.data, [SYNCED_AT_FIELD]: h.fs.serverTimestamp() })
    }
    await withTimeout(batch.commit(), IO_TIMEOUT_MS)
    n += part.length
    onCommitted?.(part)
  }
  return n
}

/** Uploads every record + profile/settings/plan. Returns the number of documents written. */
export function pushAll(uid: string, data: UserData): Promise<number> {
  return commitOps(uid, buildPendingOps(data, {}).ops)
}

/**
 * Uploads local records (and meta docs) with `updatedAt >= sinceTs`. Custom exercises without
 * `updatedAt` count as 0. Returns the number of documents written.
 */
export function pushChanged(uid: string, sinceTs: number): Promise<number> {
  const data = useApp.getState().exportData()
  const keep = <T>(list: readonly T[]) => list.filter((r) => updatedAtOf(r) >= sinceTs)
  const recent: UserData = {
    ...data,
    routines: keep(data.routines),
    sessions: keep(data.sessions),
    bodyLogs: keep(data.bodyLogs),
    customExercises: keep(data.customExercises),
    profile: updatedAtOf(data.profile) >= sinceTs ? data.profile : { ...data.profile, updatedAt: 0 },
    settings: updatedAtOf(data.settings) >= sinceTs ? data.settings : { ...data.settings, updatedAt: 0 },
    plan: data.plan && updatedAtOf(data.plan) >= sinceTs ? data.plan : null,
  }
  return commitOps(uid, buildPendingOps(recent, {}).ops)
}

/** Deletes every document of the user in the cloud (local data untouched). Returns count. */
export async function deleteRemoteData(uid: string): Promise<number> {
  const h = await loadFirebase()
  const cols = [...RECORD_COLLECTIONS, 'meta'] as const
  const docs = (await Promise.all(cols.map((c) => readCollection(h, uid, c, null)))).flat()
  let n = 0
  for (const part of chunk(docs, MAX_BATCH_OPS)) {
    const batch = h.fs.writeBatch(h.db)
    for (const d of part) batch.delete(d.ref)
    await withTimeout(batch.commit(), IO_TIMEOUT_MS)
    n += part.length
  }
  clearSyncMeta(uid)
  if (engine?.uid === uid) engine.resetMeta()
  return n
}

/* ================================================================ errors */

function codeOf(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code.replace(/^firestore\//, '')
  }
  return ''
}

const TRANSIENT = new Set(['unavailable', 'deadline-exceeded', 'aborted', 'internal', 'cancelled', 'unknown'])

function isTransient(err: unknown): boolean {
  const code = codeOf(err)
  if (TRANSIENT.has(code)) return true
  if (!code) return true // network / chunk-load errors
  return false
}

/**
 * Spanish message for a sync error, or null when it should stay silent (offline/transient:
 * data is safe locally and will be retried).
 */
export function syncErrorMessage(err: unknown): string | null {
  const code = codeOf(err)
  switch (code) {
    case 'permission-denied':
    case 'unauthenticated':
      return 'No hay permiso para sincronizar. Revisa que publicaste las reglas de Firestore.'
    case 'not-found':
    case 'failed-precondition':
      return 'Falta crear la base de datos Firestore en la consola de Firebase.'
    case 'resource-exhausted':
      return 'Se alcanzó el límite gratuito de hoy. Tus datos siguen en este dispositivo y se subirán después.'
    case 'invalid-argument':
      return 'Algunos datos no se pudieron subir. Se volverá a intentar.'
    default:
      break
  }
  if (isTransient(err)) return null
  return 'No se pudo sincronizar. Tus datos siguen guardados en este dispositivo.'
}

/* ================================================================ persisted sync state */

interface SyncMeta {
  v: 1
  /** Newest server write already pulled. */
  wm: Watermark | null
  /** Fingerprint of each record as the server is known to have it. */
  known: Record<string, string>
  lastFullAt: number
}

const metaKey = (uid: string) => `gymfullness:sync:v1:${uid}`
const emptyMeta = (): SyncMeta => ({ v: 1, wm: null, known: {}, lastFullAt: 0 })

function loadSyncMeta(uid: string): SyncMeta {
  try {
    const raw = localStorage.getItem(metaKey(uid))
    if (!raw) return emptyMeta()
    const p = JSON.parse(raw) as Partial<SyncMeta>
    const wm =
      p.wm && typeof p.wm.s === 'number' && typeof p.wm.n === 'number' ? { s: p.wm.s, n: p.wm.n } : null
    return {
      v: 1,
      wm,
      known: isPlainObject(p.known) ? (p.known as Record<string, string>) : {},
      lastFullAt: typeof p.lastFullAt === 'number' ? p.lastFullAt : 0,
    }
  } catch {
    return emptyMeta()
  }
}

function saveSyncMeta(uid: string, meta: SyncMeta): void {
  try {
    localStorage.setItem(metaKey(uid), JSON.stringify(meta))
  } catch {
    /* quota/blocked: next start does a full sync */
  }
}

function clearSyncMeta(uid: string): void {
  try {
    localStorage.removeItem(metaKey(uid))
  } catch {
    /* ignore */
  }
}

/* ================================================================ auto sync engine */

export interface SyncStatus {
  syncing: boolean
  /** Set when a sync finished successfully. */
  lastSyncAt?: number
  /** Friendly message; null clears a previous error; undefined = unchanged. */
  error?: string | null
  /** True when a sync was skipped because the device is offline (it runs when back online). */
  offline?: boolean
}

export interface SyncCallbacks {
  onStatus?: (s: SyncStatus) => void
}

type JobKind = 'push' | 'pull' | 'full'
const JOB_RANK: Record<JobKind, number> = { push: 0, pull: 1, full: 2 }
const strongest = (a: JobKind | null, b: JobKind): JobKind => (a && JOB_RANK[a] >= JOB_RANK[b] ? a : b)

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

function waitForHydration(): Promise<void> {
  if (useApp.getState().hydrated) return Promise.resolve()
  return new Promise((resolve) => {
    const unsub = useApp.subscribe((s) => {
      if (s.hydrated) {
        unsub()
        resolve()
      }
    })
  })
}

function syncedSliceChanged(s: AppState, prev: AppState): boolean {
  return (
    s.routines !== prev.routines ||
    s.sessions !== prev.sessions ||
    s.bodyLogs !== prev.bodyLogs ||
    s.customExercises !== prev.customExercises ||
    s.profile !== prev.profile ||
    s.settings !== prev.settings ||
    s.plan !== prev.plan
  )
}

class AutoSync {
  private stopped = false
  private meta: SyncMeta
  private pending: JobKind | null = null
  private running: Promise<void> | null = null
  private waitingOnline: JobKind | null = null
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private lastPullAt = 0
  private applyingRemote = false
  private cleanups: (() => void)[] = []

  constructor(
    readonly uid: string,
    private callbacks: SyncCallbacks,
  ) {
    this.meta = loadSyncMeta(uid)
  }

  get isStopped(): boolean {
    return this.stopped
  }

  setCallbacks(cb: SyncCallbacks): void {
    this.callbacks = cb
  }

  resetMeta(): void {
    this.meta = emptyMeta()
  }

  start(): void {
    void waitForHydration().then(() => {
      if (this.stopped) return
      const needsFull = this.meta.lastFullAt === 0 || Date.now() - this.meta.lastFullAt > FULL_SYNC_EVERY_MS
      void this.enqueue(needsFull ? 'full' : 'pull')
      this.attach()
    })
  }

  stop(): void {
    this.stopped = true
    if (this.pushTimer) clearTimeout(this.pushTimer)
    if (this.retryTimer) clearTimeout(this.retryTimer)
    this.pushTimer = this.retryTimer = null
    for (const fn of this.cleanups.splice(0)) fn()
  }

  private attach(): void {
    const unsubStore = useApp.subscribe((s, prev) => {
      if (this.applyingRemote || this.stopped) return
      if (syncedSliceChanged(s, prev)) this.schedulePush()
    })
    const onOnline = () => {
      const job = this.waitingOnline ?? 'pull'
      this.waitingOnline = null
      void this.enqueue(job)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - this.lastPullAt >= RESYNC_THROTTLE_MS) void this.enqueue('pull')
      } else if (this.pushTimer) {
        // leaving the app: flush pending changes now instead of waiting for the debounce
        clearTimeout(this.pushTimer)
        this.pushTimer = null
        void this.enqueue('push')
      }
    }
    window.addEventListener('online', onOnline)
    document.addEventListener('visibilitychange', onVisibility)
    this.cleanups.push(unsubStore, () => {
      window.removeEventListener('online', onOnline)
      document.removeEventListener('visibilitychange', onVisibility)
    })
  }

  private schedulePush(): void {
    if (this.pushTimer) clearTimeout(this.pushTimer)
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      void this.enqueue('push')
    }, PUSH_DEBOUNCE_MS)
  }

  private scheduleRetry(job: JobKind): void {
    if (this.retryTimer || this.stopped) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.enqueue(job)
    }, RETRY_MS)
  }

  /** Queues a job (coalesced: a stronger pending job absorbs weaker ones). Resolves when drained. */
  enqueue(kind: JobKind): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.pending = strongest(this.pending, kind)
    if (!this.running) {
      this.running = this.drain().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async drain(): Promise<void> {
    // Never merge against the default (not yet loaded) store state.
    await waitForHydration()
    while (this.pending && !this.stopped) {
      const job = this.pending
      this.pending = null
      await this.execute(job)
    }
  }

  private emit(s: SyncStatus): void {
    if (!this.stopped) this.callbacks.onStatus?.(s)
  }

  private async execute(job: JobKind): Promise<void> {
    if (isOffline()) {
      this.waitingOnline = strongest(this.waitingOnline, job)
      this.emit({ syncing: false, offline: true })
      return
    }
    this.emit({ syncing: true })
    try {
      if (job !== 'push') {
        this.lastPullAt = Date.now()
        const full = job === 'full'
        const snap = await pullSince(this.uid, full ? null : this.meta.wm)
        if (this.stopped) return
        this.applyRemote(snap, full)
      }
      await this.pushPending()
      if (this.stopped) return
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }
      this.emit({ syncing: false, lastSyncAt: Date.now(), error: null })
    } catch (err) {
      if (this.stopped) return
      if (isTransient(err)) {
        this.scheduleRetry(job)
        if (isOffline()) this.waitingOnline = strongest(this.waitingOnline, job)
      }
      this.emit({ syncing: false, error: syncErrorMessage(err) })
    }
  }

  private applyRemote(snap: RemoteSnapshot, full: boolean): void {
    // Merge against the CURRENT local state (the user may have logged data during the pull).
    const local = useApp.getState().exportData()
    const { data, changed } = mergeWithStats(local, snap.data)
    if (changed) {
      this.applyingRemote = true
      try {
        useApp.getState().importData(data, 'replace')
      } finally {
        this.applyingRemote = false
      }
    }
    this.meta.known = full ? { ...snap.fingerprints } : { ...this.meta.known, ...snap.fingerprints }
    if (snap.watermark && (!this.meta.wm || cmpWatermark(snap.watermark, this.meta.wm) > 0)) {
      this.meta.wm = snap.watermark
    }
    if (full) this.meta.lastFullAt = Date.now()
    saveSyncMeta(this.uid, this.meta)
  }

  private async pushPending(): Promise<void> {
    const { ops, fingerprints } = buildPendingOps(useApp.getState().exportData(), this.meta.known)
    if (!ops.length) return
    await commitOps(this.uid, ops, (part) => {
      for (const op of part) this.meta.known[op.key] = fingerprints[op.key]
      saveSyncMeta(this.uid, this.meta)
    })
  }
}

let engine: AutoSync | null = null

/**
 * Starts syncing for `uid`: full (or incremental) pull → merge → import → push what the server
 * lacks; then debounced pushes on local changes (2 s), and a pull when coming back online or
 * when the app becomes visible again (at most once per 60 s). Idempotent per uid.
 */
export function startAutoSync(uid: string, callbacks: SyncCallbacks = {}): void {
  if (engine && engine.uid === uid && !engine.isStopped) {
    engine.setCallbacks(callbacks)
    return
  }
  stopAutoSync()
  engine = new AutoSync(uid, callbacks)
  engine.start()
}

/** Stops listeners/timers. Local data is untouched. */
export function stopAutoSync(): void {
  engine?.stop()
  engine = null
}

/** Runs a sync now ('full' re-reads everything). Resolves when done; errors go to onStatus. */
export function requestSync(kind: JobKind = 'full'): Promise<void> {
  return engine ? engine.enqueue(kind) : Promise.resolve()
}

/** uid currently being synced, if any. */
export function autoSyncUid(): string | null {
  return engine && !engine.isStopped ? engine.uid : null
}
