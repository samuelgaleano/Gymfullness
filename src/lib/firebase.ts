/**
 * Optional cloud layer: Firebase Auth (Google) + Firestore.
 *
 * The Firebase SDK is NEVER imported statically. Everything goes through `loadFirebase()`,
 * a memoized dynamic import, so guests never download it (Vite emits it as a lazy chunk).
 * Only `import type` is allowed for Firebase modules in this file.
 *
 * Cloud is enabled only when the VITE_FIREBASE_* variables exist at build time.
 */
import type { FirebaseApp, FirebaseOptions } from 'firebase/app'
import type { Auth, AuthProvider, User } from 'firebase/auth'
import type { Firestore } from 'firebase/firestore/lite'
import type { AuthUser } from './types'

export type AuthModule = typeof import('firebase/auth')
export type FirestoreModule = typeof import('firebase/firestore/lite')

export interface FirebaseHandles {
  app: FirebaseApp
  auth: Auth
  db: Firestore
  authMod: AuthModule
  fs: FirestoreModule
}

/* ------------------------------------------------------------------ config */

function readEnv(): FirebaseOptions {
  const env = import.meta.env
  const clean = (v: string | undefined) => (typeof v === 'string' && v.trim() ? v.trim() : undefined)
  return {
    apiKey: clean(env.VITE_FIREBASE_API_KEY),
    authDomain: clean(env.VITE_FIREBASE_AUTH_DOMAIN),
    projectId: clean(env.VITE_FIREBASE_PROJECT_ID),
    appId: clean(env.VITE_FIREBASE_APP_ID),
    storageBucket: clean(env.VITE_FIREBASE_STORAGE_BUCKET),
    messagingSenderId: clean(env.VITE_FIREBASE_MESSAGING_SENDER_ID),
  }
}

/** True when the four required VITE_FIREBASE_* variables are present. Cheap, no SDK. */
export function isCloudConfigured(): boolean {
  const c = readEnv()
  return Boolean(c.apiKey && c.authDomain && c.projectId && c.appId)
}

/* ------------------------------------------------------------------ loader */

let handlesPromise: Promise<FirebaseHandles> | null = null
let handles: FirebaseHandles | null = null

/**
 * Lazily loads and initializes Firebase (app + auth + firestore). Memoized: the SDK is
 * downloaded and initialized at most once. Rejects (and resets the memo, so a later call can
 * retry) if cloud is not configured or the chunk cannot be fetched (offline).
 */
export function loadFirebase(): Promise<FirebaseHandles> {
  if (handlesPromise) return handlesPromise
  if (!isCloudConfigured()) return Promise.reject(new Error('cloud-not-configured'))

  handlesPromise = (async () => {
    const [appMod, authMod, fs] = await Promise.all([
      import('firebase/app'),
      import('firebase/auth'),
      import('firebase/firestore/lite'),
    ])
    const app = appMod.getApps().length ? appMod.getApp() : appMod.initializeApp(readEnv())
    let auth: Auth
    try {
      // initializeAuth (vs getAuth) lets us choose localStorage persistence and ship only the
      // browser popup/redirect resolver.
      auth = authMod.initializeAuth(app, {
        persistence: authMod.browserLocalPersistence,
        popupRedirectResolver: authMod.browserPopupRedirectResolver,
      })
    } catch {
      auth = authMod.getAuth(app) // already initialized (HMR)
    }
    auth.languageCode = 'es'
    // Firestore Lite: one-shot REST reads/writes, no listeners, no cache, no offline write queue
    // (~4x smaller than the full SDK). The app store is the cache; sync retries when online.
    const db = fs.getFirestore(app)
    const h: FirebaseHandles = { app, auth, db, authMod, fs }
    handles = h
    return h
  })()
  handlesPromise.catch(() => {
    handlesPromise = null
  })
  return handlesPromise
}

/** Starts downloading the SDK in the background (e.g. when a login button gets focus). */
export function preloadFirebase(): void {
  if (!isCloudConfigured()) return
  loadFirebase().catch(() => {
    /* retried on demand */
  })
}

/** Handles if the SDK has already finished loading, else null (never triggers a download). */
export function getLoadedFirebase(): FirebaseHandles | null {
  return handles
}

/* ------------------------------------------------------------------ errors */

/** Error thrown by this module; `message` is already a friendly Spanish sentence. */
export class CloudAuthError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'CloudAuthError'
    this.code = code
  }
}

function errorCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code
  }
  return ''
}

function isChunkLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return /dynamically imported module|Importing a module script failed|Failed to fetch|error loading dynamically/i.test(msg)
}

function currentHost(): string {
  try {
    return typeof location !== 'undefined' && location.host ? location.host : 'tu dominio'
  } catch {
    return 'tu dominio'
  }
}

/** Codes where the user simply closed/cancelled the flow: show nothing. */
const SILENT_CODES = new Set(['auth/popup-closed-by-user', 'auth/user-cancelled', 'auth/redirect-cancelled-by-user'])

/** Popup could not be used here: fall back to a full-page redirect. */
const POPUP_FALLBACK_CODES = new Set([
  'auth/popup-blocked',
  'auth/operation-not-supported-in-this-environment',
  'auth/cancelled-popup-request',
])

/**
 * Maps any auth error to a short Spanish message for the UI, or `null` when it should be
 * silent (the user closed the popup). Pure; `host` is injectable for tests.
 */
export function friendlyAuthError(err: unknown, host: string = currentHost()): string | null {
  if (err instanceof CloudAuthError) return err.message
  const code = errorCode(err)
  if (SILENT_CODES.has(code)) return null
  switch (code) {
    case 'auth/network-request-failed':
    case 'auth/timeout':
      return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.'
    case 'auth/unauthorized-domain':
      return `Dominio no autorizado en Firebase: añade ${host} en Authentication → Settings → Authorized domains.`
    case 'auth/operation-not-allowed':
      return 'El acceso con Google no está activado. Actívalo en Firebase → Authentication → Sign-in method.'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'La configuración de Firebase no es válida. Revisa VITE_FIREBASE_API_KEY.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos. Espera un momento y vuelve a intentarlo.'
    case 'auth/user-disabled':
      return 'Esta cuenta está desactivada.'
    case 'auth/account-exists-with-different-credential':
      return 'Ya existe una cuenta con ese correo usando otro método de acceso.'
    case 'auth/web-storage-unsupported':
      return 'Tu navegador bloquea el almacenamiento. Desactiva el modo privado o permite cookies para este sitio.'
    case 'auth/popup-blocked':
      return 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo de nuevo.'
    default:
      break
  }
  if (isChunkLoadError(err)) return 'Sin conexión. Revisa tu internet e inténtalo de nuevo.'
  if (err instanceof Error && err.message === 'cloud-not-configured') {
    return 'El inicio de sesión no está disponible en esta versión.'
  }
  return 'No se pudo iniciar sesión. Inténtalo de nuevo.'
}

/* ------------------------------------------------------------------ auth */

const REDIRECT_FLAG = 'gymfullness:auth-redirect'

function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}
function lsSet(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    /* storage blocked: redirect completion just won't be attempted */
  }
}

/** True if a redirect sign-in was started and not completed yet (flag in localStorage). */
export function hasPendingRedirect(): boolean {
  return lsGet(REDIRECT_FLAG) !== null
}

export function toAuthUser(u: User): AuthUser {
  return { uid: u.uid, name: u.displayName ?? null, email: u.email ?? null, photoURL: u.photoURL ?? null }
}

function googleProvider(h: FirebaseHandles): AuthProvider {
  const provider = new h.authMod.GoogleAuthProvider()
  provider.setCustomParameters({ prompt: 'select_account' })
  return provider
}

/** iOS home-screen PWAs can't complete popups reliably: go straight to redirect there. */
function isIosStandalone(): boolean {
  try {
    return (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

async function startRedirect(h: FirebaseHandles): Promise<null> {
  lsSet(REDIRECT_FLAG, String(Date.now()))
  try {
    await h.authMod.signInWithRedirect(h.auth, googleProvider(h))
  } catch (err) {
    lsSet(REDIRECT_FLAG, null)
    const msg = friendlyAuthError(err)
    if (msg === null) return null
    throw new CloudAuthError(errorCode(err) || 'auth/unknown', msg)
  }
  return null // the page navigates away
}

/**
 * Google sign-in. Tries a popup first; when popups can't be used (blocked, unsupported, or a
 * cancelled concurrent request) it falls back to a full-page redirect.
 * Resolves the user on popup success, or `null` when the user closed the popup or a redirect
 * was started. Throws `CloudAuthError` (friendly Spanish message) on real failures.
 */
export async function signInWithGoogle(): Promise<AuthUser | null> {
  let h: FirebaseHandles
  try {
    h = handles ?? (await loadFirebase())
  } catch (err) {
    throw new CloudAuthError('cloud/load-failed', friendlyAuthError(err) ?? 'No se pudo iniciar sesión.')
  }
  if (isIosStandalone()) return startRedirect(h)
  try {
    const cred = await h.authMod.signInWithPopup(h.auth, googleProvider(h))
    return toAuthUser(cred.user)
  } catch (err) {
    const code = errorCode(err)
    if (POPUP_FALLBACK_CODES.has(code)) return startRedirect(h)
    const msg = friendlyAuthError(err)
    if (msg === null) return null
    throw new CloudAuthError(code || 'auth/unknown', msg)
  }
}

/**
 * Completes a pending redirect sign-in. Call on startup: it is a no-op (and does not load the
 * SDK) unless `signInWithGoogle` previously started a redirect on this device.
 */
export async function completeRedirectIfPending(): Promise<AuthUser | null> {
  if (!hasPendingRedirect() || !isCloudConfigured()) return null
  try {
    const h = await loadFirebase()
    const result = await h.authMod.getRedirectResult(h.auth)
    lsSet(REDIRECT_FLAG, null)
    return result ? toAuthUser(result.user) : null
  } catch (err) {
    const msg = friendlyAuthError(err)
    // Keep the flag when offline so the next start retries; clear it on any other outcome.
    if (!isChunkLoadError(err) && errorCode(err) !== 'auth/network-request-failed') lsSet(REDIRECT_FLAG, null)
    if (msg === null) return null
    throw new CloudAuthError(errorCode(err) || 'auth/redirect-failed', msg)
  }
}

/** Signs out of Firebase (no-op if the SDK was never loaded and nothing is pending). */
export async function signOutUser(): Promise<void> {
  lsSet(REDIRECT_FLAG, null)
  if (!isCloudConfigured()) return
  const h = handles ?? (await loadFirebase())
  await h.authMod.signOut(h.auth)
}

/**
 * Subscribes to auth state (loads the SDK). The callback receives the current user once the
 * persisted session is restored, then on every change. Returns an unsubscribe function that
 * works even before the SDK finished loading. `onError` fires if the SDK can't be loaded.
 */
export function onAuthChange(cb: (user: AuthUser | null) => void, onError?: (err: unknown) => void): () => void {
  let unsub: (() => void) | null = null
  let cancelled = false
  loadFirebase().then(
    (h) => {
      if (cancelled) return
      unsub = h.authMod.onAuthStateChanged(h.auth, (u) => cb(u ? toAuthUser(u) : null))
    },
    (err: unknown) => {
      if (!cancelled) onError?.(err)
    },
  )
  return () => {
    cancelled = true
    unsub?.()
    unsub = null
  }
}
