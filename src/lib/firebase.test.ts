import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const sdk = vi.hoisted(() => {
  const user = { uid: 'u1', displayName: 'Ana', email: 'ana@example.com', photoURL: 'https://p/ana.png' }
  return {
    user,
    initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
    getApps: vi.fn((): unknown[] => []),
    getApp: vi.fn(() => ({ name: '[DEFAULT]' })),
    initializeAuth: vi.fn(() => ({ languageCode: null as string | null })),
    getAuth: vi.fn(() => ({ languageCode: null as string | null })),
    signInWithPopup: vi.fn(async (): Promise<unknown> => ({ user })),
    signInWithRedirect: vi.fn(async () => undefined),
    getRedirectResult: vi.fn(async (): Promise<unknown> => ({ user })),
    signOut: vi.fn(async () => undefined),
    onAuthStateChanged: vi.fn((_auth: unknown, cb: (u: unknown) => void) => {
      cb(user)
      return () => {}
    }),
    getFirestore: vi.fn(() => ({})),
  }
})

vi.mock('firebase/app', () => ({ initializeApp: sdk.initializeApp, getApps: sdk.getApps, getApp: sdk.getApp }))
vi.mock('firebase/auth', () => ({
  initializeAuth: sdk.initializeAuth,
  getAuth: sdk.getAuth,
  browserLocalPersistence: { type: 'LOCAL' },
  browserPopupRedirectResolver: {},
  GoogleAuthProvider: class {
    params: Record<string, string> = {}
    setCustomParameters(p: Record<string, string>) {
      this.params = p
    }
  },
  signInWithPopup: sdk.signInWithPopup,
  signInWithRedirect: sdk.signInWithRedirect,
  getRedirectResult: sdk.getRedirectResult,
  signOut: sdk.signOut,
  onAuthStateChanged: sdk.onAuthStateChanged,
}))
vi.mock('firebase/firestore/lite', () => ({ getFirestore: sdk.getFirestore }))

const REDIRECT_FLAG = 'gymfullness:auth-redirect'
const fbError = (code: string) => Object.assign(new Error(code), { code })

function configure() {
  vi.stubEnv('VITE_FIREBASE_API_KEY', 'key')
  vi.stubEnv('VITE_FIREBASE_AUTH_DOMAIN', 'demo.firebaseapp.com')
  vi.stubEnv('VITE_FIREBASE_PROJECT_ID', 'demo')
  vi.stubEnv('VITE_FIREBASE_APP_ID', '1:2:web:3')
}

async function freshModule() {
  vi.resetModules()
  return import('./firebase')
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
})
afterEach(() => vi.unstubAllEnvs())

describe('isCloudConfigured', () => {
  it('needs the four VITE_FIREBASE_* variables', async () => {
    vi.stubEnv('VITE_FIREBASE_API_KEY', '')
    const fb = await freshModule()
    expect(fb.isCloudConfigured()).toBe(false)
    await expect(fb.loadFirebase()).rejects.toThrow('cloud-not-configured')
    configure()
    expect(fb.isCloudConfigured()).toBe(true)
  })
})

describe('loadFirebase', () => {
  it('initializes once (memoized) with localStorage persistence', async () => {
    configure()
    const fb = await freshModule()
    expect(fb.getLoadedFirebase()).toBeNull()
    const [a, b] = await Promise.all([fb.loadFirebase(), fb.loadFirebase()])
    expect(a).toBe(b)
    expect(sdk.initializeApp).toHaveBeenCalledTimes(1)
    expect(sdk.initializeApp).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'key', authDomain: 'demo.firebaseapp.com', projectId: 'demo', appId: '1:2:web:3' }),
    )
    expect(sdk.initializeAuth).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ persistence: { type: 'LOCAL' } }))
    expect(a.auth.languageCode).toBe('es')
    expect(fb.getLoadedFirebase()).toBe(a)
  })
})

describe('signInWithGoogle', () => {
  it('returns the user on popup success', async () => {
    configure()
    const fb = await freshModule()
    await expect(fb.signInWithGoogle()).resolves.toEqual({
      uid: 'u1',
      name: 'Ana',
      email: 'ana@example.com',
      photoURL: 'https://p/ana.png',
    })
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled()
  })

  it.each(['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment', 'auth/cancelled-popup-request'])(
    'falls back to redirect on %s and sets the flag',
    async (code) => {
      configure()
      const fb = await freshModule()
      sdk.signInWithPopup.mockRejectedValueOnce(fbError(code))
      await expect(fb.signInWithGoogle()).resolves.toBeNull()
      expect(sdk.signInWithRedirect).toHaveBeenCalledTimes(1)
      expect(localStorage.getItem(REDIRECT_FLAG)).not.toBeNull()
      expect(fb.hasPendingRedirect()).toBe(true)
    },
  )

  it('is silent when the user closes the popup', async () => {
    configure()
    const fb = await freshModule()
    sdk.signInWithPopup.mockRejectedValueOnce(fbError('auth/popup-closed-by-user'))
    await expect(fb.signInWithGoogle()).resolves.toBeNull()
    expect(sdk.signInWithRedirect).not.toHaveBeenCalled()
  })

  it('throws a friendly Spanish error otherwise', async () => {
    configure()
    const fb = await freshModule()
    sdk.signInWithPopup.mockRejectedValueOnce(fbError('auth/unauthorized-domain'))
    await expect(fb.signInWithGoogle()).rejects.toThrow(/Dominio no autorizado en Firebase: añade .+ en Authentication → Settings/)
    sdk.signInWithPopup.mockRejectedValueOnce(fbError('auth/network-request-failed'))
    await expect(fb.signInWithGoogle()).rejects.toThrow('Sin conexión')
  })
})

describe('completeRedirectIfPending', () => {
  it('does nothing (no SDK) without the flag', async () => {
    configure()
    const fb = await freshModule()
    await expect(fb.completeRedirectIfPending()).resolves.toBeNull()
    expect(sdk.initializeApp).not.toHaveBeenCalled()
    expect(sdk.getRedirectResult).not.toHaveBeenCalled()
  })

  it('returns the user and clears the flag', async () => {
    configure()
    localStorage.setItem(REDIRECT_FLAG, '1')
    const fb = await freshModule()
    await expect(fb.completeRedirectIfPending()).resolves.toMatchObject({ uid: 'u1' })
    expect(localStorage.getItem(REDIRECT_FLAG)).toBeNull()
  })
})

describe('onAuthChange / signOutUser', () => {
  it('maps users and supports unsubscribe before load', async () => {
    configure()
    const fb = await freshModule()
    const cb = vi.fn()
    fb.onAuthChange(cb)
    await vi.waitFor(() => expect(cb).toHaveBeenCalledWith(expect.objectContaining({ uid: 'u1', name: 'Ana' })))
    const cb2 = vi.fn()
    fb.onAuthChange(cb2)() // unsubscribed immediately
    await new Promise((r) => setTimeout(r, 0))
    expect(cb2).not.toHaveBeenCalled()
    await fb.signOutUser()
    expect(sdk.signOut).toHaveBeenCalledTimes(1)
  })
})

describe('friendlyAuthError', () => {
  it('maps codes to Spanish and stays silent on cancel', async () => {
    const fb = await freshModule()
    expect(fb.friendlyAuthError(fbError('auth/popup-closed-by-user'))).toBeNull()
    expect(fb.friendlyAuthError(fbError('auth/unauthorized-domain'), 'mi-app.vercel.app')).toBe(
      'Dominio no autorizado en Firebase: añade mi-app.vercel.app en Authentication → Settings → Authorized domains.',
    )
    expect(fb.friendlyAuthError(new TypeError('Failed to fetch dynamically imported module: x.js'))).toMatch(/Sin conexión/)
    expect(fb.friendlyAuthError(fbError('auth/operation-not-allowed'))).toMatch(/Sign-in method/)
    expect(fb.friendlyAuthError(new Error('???'))).toBe('No se pudo iniciar sesión. Inténtalo de nuevo.')
  })
})
