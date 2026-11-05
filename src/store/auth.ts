/**
 * Auth + sync status store (optional cloud layer).
 *
 * Zero cost for guests: `init()` never downloads the Firebase SDK unless this device signed in
 * before (a tiny `hadSession` flag in localStorage) or a redirect sign-in is pending.
 * Persisted (localStorage, synchronous so the UI renders instantly): the flag, the cached user
 * profile (name/photo/email) and `lastSyncAt`. Nothing else.
 *
 * Usage:
 *   const { status, user, cloudEnabled, signIn } = useAuth()
 *   const syncing = useAuth((s) => s.syncing)
 *   useAuthStore.getState().init()   // once at startup (main.tsx)
 */
import { useEffect } from 'react'
import { create } from 'zustand'
import type { AuthUser } from '@/lib/types'
import {
  completeRedirectIfPending,
  friendlyAuthError,
  hasPendingRedirect,
  isCloudConfigured,
  onAuthChange,
  preloadFirebase,
  signInWithGoogle,
  signOutUser,
} from '@/lib/firebase'
import type { SyncStatus } from '@/lib/sync'

export type AuthStatus = 'unknown' | 'guest' | 'signed_in'

export interface AuthState {
  /** 'unknown' only while restoring a previous session whose profile wasn't cached. */
  status: AuthStatus
  user: AuthUser | null
  /** A sync round-trip is running. */
  syncing: boolean
  /** Epoch ms of the last successful sync (persisted). */
  lastSyncAt: number | null
  /** Friendly Spanish message for the UI; null when there is nothing to show. */
  error: string | null
  /** VITE_FIREBASE_* configured at build time. When false, hide every login UI. */
  cloudEnabled: boolean
  /** A sign-in (popup) is in progress — use it to show a spinner on the button. */
  signingIn: boolean

  /** Idempotent. Restores the session (lazy SDK) only for devices that signed in before. */
  init: () => Promise<void>
  /** Google sign-in. Resolves true when signed in now; false if cancelled, redirecting or failed (see `error`). */
  signIn: () => Promise<boolean>
  /** Signs out and stops syncing. Local data stays on the device. */
  signOut: () => Promise<void>
  /** Full sync now (re-reads the cloud, then uploads anything missing). */
  syncNow: () => Promise<void>
  /** Deletes this account's cloud data, then signs out (local data stays on the device). Returns success. */
  deleteCloudData: () => Promise<boolean>
  /** Starts downloading the SDK early (call on focus/hover of a "Continuar con Google" button). */
  prefetch: () => void
  clearError: () => void
}

/* ---------------------------------------------------------------- persistence */

const STORAGE_KEY = 'gymfullness:auth:v1'

interface PersistedAuth {
  hadSession: boolean
  user: AuthUser | null
  lastSyncAt: number | null
}

function sanitizeUser(u: unknown): AuthUser | null {
  if (!u || typeof u !== 'object') return null
  const o = u as Record<string, unknown>
  if (typeof o.uid !== 'string' || !o.uid) return null
  const str = (v: unknown) => (typeof v === 'string' ? v : null)
  return { uid: o.uid, name: str(o.name), email: str(o.email), photoURL: str(o.photoURL) }
}

function readPersisted(): PersistedAuth {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { hadSession: false, user: null, lastSyncAt: null }
    const p = JSON.parse(raw) as Partial<PersistedAuth>
    return {
      hadSession: p.hadSession === true,
      user: sanitizeUser(p.user),
      lastSyncAt: typeof p.lastSyncAt === 'number' ? p.lastSyncAt : null,
    }
  } catch {
    return { hadSession: false, user: null, lastSyncAt: null }
  }
}

function writePersisted(patch: Partial<PersistedAuth>): void {
  try {
    const next = { ...readPersisted(), ...patch }
    if (!next.hadSession && !next.user && next.lastSyncAt === null) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    /* storage blocked: the session simply won't be restored instantly */
  }
}

function initialState(): Pick<AuthState, 'status' | 'user' | 'lastSyncAt' | 'cloudEnabled'> {
  const cloudEnabled = isCloudConfigured()
  if (!cloudEnabled) return { status: 'guest', user: null, lastSyncAt: null, cloudEnabled }
  const p = readPersisted()
  if (p.hadSession) {
    return { status: p.user ? 'signed_in' : 'unknown', user: p.user, lastSyncAt: p.lastSyncAt, cloudEnabled }
  }
  return { status: hasPendingRedirect() ? 'unknown' : 'guest', user: null, lastSyncAt: p.lastSyncAt, cloudEnabled }
}

/* ---------------------------------------------------------------- store */

const OFFLINE_MSG = 'Sin conexión. Se sincronizará cuando vuelva internet.'
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

let initPromise: Promise<void> | null = null
let signInPromise: Promise<boolean> | null = null
let unsubscribeAuth: (() => void) | null = null

type SyncModule = typeof import('@/lib/sync')
let syncModule: Promise<SyncModule> | null = null
/** Lazy sync chunk (memoized; reset on failure so it can be retried). */
function loadSync(): Promise<SyncModule> {
  if (!syncModule) {
    syncModule = import('@/lib/sync')
    syncModule.catch(() => {
      syncModule = null
    })
  }
  return syncModule
}

export const useAuthStore = create<AuthState>()((set, get) => {
  const onSyncStatus = (s: SyncStatus) => {
    if (get().status !== 'signed_in') return
    const patch: Partial<AuthState> = { syncing: s.syncing }
    if (s.lastSyncAt !== undefined) {
      patch.lastSyncAt = s.lastSyncAt
      writePersisted({ lastSyncAt: s.lastSyncAt })
    }
    if (s.error !== undefined) patch.error = s.error
    set(patch)
  }

  const startSync = (uid: string) => {
    loadSync()
      .then((m) => {
        const u = get().user
        if (get().status === 'signed_in' && u?.uid === uid) m.startAutoSync(uid, { onStatus: onSyncStatus })
      })
      .catch(() => {
        /* offline: chunk unavailable; the next start retries */
      })
  }

  /** Stops the engine only if the sync chunk was ever loaded (never downloads it just to stop). */
  const stopSync = async () => {
    if (!syncModule) return
    try {
      ;(await syncModule).stopAutoSync()
    } catch {
      /* failed to load: nothing is running */
    }
  }

  const applyUser = (user: AuthUser) => {
    set({ status: 'signed_in', user, error: null })
    writePersisted({ hadSession: true, user })
    startSync(user.uid) // startAutoSync swaps engines itself if the uid changed
  }

  const applySignedOut = () => {
    void stopSync()
    set({ status: 'guest', user: null, syncing: false })
    writePersisted({ hadSession: false, user: null })
  }

  /** Subscribes once to Firebase auth state (loads the SDK). */
  const listen = () => {
    if (unsubscribeAuth) return
    unsubscribeAuth = onAuthChange(
      (user) => {
        if (user) applyUser(user)
        else applySignedOut()
      },
      (err) => {
        // SDK could not load (offline): keep the cached session, retry on next start.
        unsubscribeAuth = null
        if (get().status === 'unknown') set({ status: readPersisted().user ? 'signed_in' : 'guest' })
        const msg = friendlyAuthError(err)
        if (msg && !isOffline()) set({ error: msg })
      },
    )
  }

  return {
    ...initialState(),
    syncing: false,
    error: null,
    signingIn: false,

    init: () => {
      if (initPromise) return initPromise
      initPromise = (async () => {
        if (!get().cloudEnabled) {
          set({ status: 'guest' })
          return
        }
        const persisted = readPersisted()
        const redirectPending = hasPendingRedirect()
        if (!persisted.hadSession && !redirectPending) {
          set({ status: 'guest' }) // never signed in here: do not download the SDK
          return
        }
        if (redirectPending) {
          try {
            const user = await completeRedirectIfPending()
            if (user) applyUser(user)
          } catch (err) {
            set({ error: friendlyAuthError(err) })
          }
        }
        listen()
        // Until Firebase answers, a cached user stays signed in (works offline).
        if (get().status === 'unknown' && !persisted.hadSession && !hasPendingRedirect()) set({ status: 'guest' })
      })()
      return initPromise
    },

    signIn: () => {
      if (signInPromise) return signInPromise
      if (!get().cloudEnabled) {
        set({ error: 'El inicio de sesión no está disponible en esta versión.' })
        return Promise.resolve(false)
      }
      set({ error: null, signingIn: true })
      signInPromise = (async () => {
        try {
          const user = await signInWithGoogle()
          if (!user) return false // closed the popup, or a redirect started
          applyUser(user)
          listen()
          return true
        } catch (err) {
          set({ error: friendlyAuthError(err) })
          return false
        } finally {
          set({ signingIn: false })
          signInPromise = null
        }
      })()
      return signInPromise
    },

    signOut: async () => {
      await stopSync()
      try {
        await signOutUser()
      } catch {
        /* offline: local sign-out still applies; Firebase clears its session on next load */
      }
      unsubscribeAuth?.()
      unsubscribeAuth = null
      set({ status: 'guest', user: null, syncing: false, error: null })
      writePersisted({ hadSession: false, user: null })
    },

    syncNow: async () => {
      const { status, user } = get()
      if (status !== 'signed_in' || !user) return
      if (isOffline()) {
        set({ error: OFFLINE_MSG })
        return
      }
      try {
        const m = await loadSync()
        if (m.autoSyncUid() !== user.uid) m.startAutoSync(user.uid, { onStatus: onSyncStatus })
        await m.requestSync('full')
      } catch {
        set({ error: 'No se pudo sincronizar. Inténtalo de nuevo.' })
      }
    },

    deleteCloudData: async () => {
      const { status, user } = get()
      if (status !== 'signed_in' || !user) return false
      if (isOffline()) {
        set({ error: 'Necesitas conexión para borrar los datos de la nube.' })
        return false
      }
      let m: SyncModule
      try {
        m = await loadSync()
      } catch {
        set({ error: 'No se pudieron borrar los datos de la nube.' })
        return false
      }
      // Stop first so no debounced push re-uploads data while (or after) deleting.
      m.stopAutoSync()
      set({ syncing: true })
      try {
        await m.deleteRemoteData(user.uid)
      } catch (err) {
        set({ syncing: false, error: m.syncErrorMessage(err) ?? 'No se pudieron borrar los datos de la nube.' })
        m.startAutoSync(user.uid, { onStatus: onSyncStatus }) // keep syncing as before
        return false
      }
      set({ syncing: false })
      await get().signOut() // otherwise the next change would upload everything again
      return true
    },

    prefetch: () => {
      if (get().cloudEnabled) preloadFirebase()
    },

    clearError: () => set({ error: null }),
  }
})

/**
 * Auth state hook. Without a selector it returns the whole (stable) state object; pass a
 * selector for primitives to limit re-renders. Calls `init()` once (idempotent, no SDK for guests).
 */
export function useAuth(): AuthState
export function useAuth<T>(selector: (s: AuthState) => T): T
export function useAuth<T>(selector?: (s: AuthState) => T): T | AuthState {
  const value = useAuthStore((selector ?? identity) as (s: AuthState) => T | AuthState)
  useEffect(() => {
    void useAuthStore.getState().init()
  }, [])
  return value
}

function identity(s: AuthState): AuthState {
  return s
}

/** Startup hook-free entry point (main.tsx): restores a previous session if there was one. */
export function initAuth(): Promise<void> {
  return useAuthStore.getState().init()
}

/** Test-only: forget memoized promises/listeners. */
export function __resetAuthForTests(): void {
  initPromise = null
  signInPromise = null
  unsubscribeAuth?.()
  unsubscribeAuth = null
  useAuthStore.setState({ ...initialState(), syncing: false, error: null, signingIn: false })
}
