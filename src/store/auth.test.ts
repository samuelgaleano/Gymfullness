import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AuthUser } from '@/lib/types'

const fb = vi.hoisted(() => {
  const state = {
    enabled: true,
    redirect: false,
    authCb: null as ((u: AuthUser | null) => void) | null,
  }
  return {
    state,
    isCloudConfigured: vi.fn(() => state.enabled),
    hasPendingRedirect: vi.fn(() => state.redirect),
    completeRedirectIfPending: vi.fn(async (): Promise<AuthUser | null> => null),
    onAuthChange: vi.fn((cb: (u: AuthUser | null) => void) => {
      state.authCb = cb
      return () => {
        state.authCb = null
      }
    }),
    signInWithGoogle: vi.fn(async (): Promise<AuthUser | null> => null),
    signOutUser: vi.fn(async () => undefined),
    preloadFirebase: vi.fn(),
    loadFirebase: vi.fn(),
    friendlyAuthError: vi.fn((e: unknown) => (e instanceof Error ? e.message : 'error')),
  }
})
const syncMock = vi.hoisted(() => ({
  startAutoSync: vi.fn(),
  stopAutoSync: vi.fn(),
  requestSync: vi.fn(async () => undefined),
  autoSyncUid: vi.fn((): string | null => null),
  deleteRemoteData: vi.fn(async () => 3),
  syncErrorMessage: vi.fn(() => 'x'),
}))

vi.mock('@/lib/firebase', () => fb)
vi.mock('@/lib/sync', () => syncMock)

const { useAuthStore, __resetAuthForTests } = await import('./auth')

const ANA: AuthUser = { uid: 'u1', name: 'Ana', email: 'ana@example.com', photoURL: null }
const KEY = 'gymfullness:auth:v1'
const persisted = () => JSON.parse(localStorage.getItem(KEY) ?? 'null') as { hadSession: boolean; user: AuthUser | null } | null

function reset({ enabled = true, redirect = false, stored }: { enabled?: boolean; redirect?: boolean; stored?: object } = {}) {
  vi.clearAllMocks()
  localStorage.clear()
  if (stored) localStorage.setItem(KEY, JSON.stringify(stored))
  fb.state.enabled = enabled
  fb.state.redirect = redirect
  fb.state.authCb = null
  __resetAuthForTests()
}

beforeEach(() => reset())

describe('auth store — guests never load Firebase', () => {
  it('cloud not configured → guest, nothing loaded', async () => {
    reset({ enabled: false })
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', cloudEnabled: false })
    await useAuthStore.getState().init()
    expect(fb.onAuthChange).not.toHaveBeenCalled()
    expect(fb.completeRedirectIfPending).not.toHaveBeenCalled()
    expect(await useAuthStore.getState().signIn()).toBe(false)
    expect(fb.signInWithGoogle).not.toHaveBeenCalled()
  })

  it('configured but never signed in → guest without touching the SDK', async () => {
    await useAuthStore.getState().init()
    expect(useAuthStore.getState().status).toBe('guest')
    expect(fb.onAuthChange).not.toHaveBeenCalled()
    expect(fb.loadFirebase).not.toHaveBeenCalled()
    expect(syncMock.startAutoSync).not.toHaveBeenCalled()
  })

  it('init is idempotent', async () => {
    const a = useAuthStore.getState().init()
    const b = useAuthStore.getState().init()
    expect(a).toBe(b)
    await a
  })
})

describe('auth store — returning users', () => {
  it('renders the cached user instantly, then restores the session and starts sync', async () => {
    reset({ stored: { hadSession: true, user: ANA, lastSyncAt: 123 } })
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', user: ANA, lastSyncAt: 123 })
    await useAuthStore.getState().init()
    expect(fb.onAuthChange).toHaveBeenCalledTimes(1)
    fb.state.authCb?.(ANA)
    await vi.waitFor(() => expect(syncMock.startAutoSync).toHaveBeenCalledWith('u1', expect.any(Object)))
  })

  it('expired session → guest and the flag is cleared (local data untouched)', async () => {
    reset({ stored: { hadSession: true, user: ANA, lastSyncAt: null } })
    await useAuthStore.getState().init()
    fb.state.authCb?.(null)
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null })
    expect(persisted()?.hadSession ?? false).toBe(false)
  })

  it('completes a pending redirect on startup', async () => {
    reset({ redirect: true })
    fb.completeRedirectIfPending.mockResolvedValueOnce(ANA)
    expect(useAuthStore.getState().status).toBe('unknown')
    await useAuthStore.getState().init()
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', user: ANA })
    expect(persisted()).toMatchObject({ hadSession: true, user: ANA })
  })

  it('sync status updates syncing/lastSyncAt/error and persists lastSyncAt', async () => {
    reset({ stored: { hadSession: true, user: ANA, lastSyncAt: null } })
    await useAuthStore.getState().init()
    fb.state.authCb?.(ANA)
    await vi.waitFor(() => expect(syncMock.startAutoSync).toHaveBeenCalled())
    const onStatus = (syncMock.startAutoSync.mock.calls[0] as unknown as [string, { onStatus: (s: object) => void }])[1].onStatus
    onStatus({ syncing: true })
    expect(useAuthStore.getState().syncing).toBe(true)
    onStatus({ syncing: false, lastSyncAt: 999, error: null })
    expect(useAuthStore.getState()).toMatchObject({ syncing: false, lastSyncAt: 999, error: null })
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}').lastSyncAt).toBe(999)
  })
})

describe('auth store — actions', () => {
  it('signIn success → signed_in, persisted, sync started', async () => {
    fb.signInWithGoogle.mockResolvedValueOnce(ANA)
    expect(await useAuthStore.getState().signIn()).toBe(true)
    expect(useAuthStore.getState()).toMatchObject({ status: 'signed_in', user: ANA, signingIn: false, error: null })
    expect(persisted()).toMatchObject({ hadSession: true, user: ANA })
    await vi.waitFor(() => expect(syncMock.startAutoSync).toHaveBeenCalledWith('u1', expect.any(Object)))
  })

  it('signIn cancelled → false, no error', async () => {
    expect(await useAuthStore.getState().signIn()).toBe(false)
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', error: null, signingIn: false })
  })

  it('signIn failure → friendly error', async () => {
    fb.signInWithGoogle.mockRejectedValueOnce(new Error('Sin conexión. Revisa tu internet e inténtalo de nuevo.'))
    expect(await useAuthStore.getState().signIn()).toBe(false)
    expect(useAuthStore.getState().error).toMatch(/Sin conexión/)
  })

  it('concurrent signIn calls share one popup', async () => {
    fb.signInWithGoogle.mockResolvedValueOnce(ANA)
    const [a, b] = await Promise.all([useAuthStore.getState().signIn(), useAuthStore.getState().signIn()])
    expect(a && b).toBe(true)
    expect(fb.signInWithGoogle).toHaveBeenCalledTimes(1)
  })

  it('signOut → guest, sync stopped, flag cleared', async () => {
    fb.signInWithGoogle.mockResolvedValueOnce(ANA)
    await useAuthStore.getState().signIn()
    await useAuthStore.getState().signOut()
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null })
    expect(syncMock.stopAutoSync).toHaveBeenCalled()
    expect(fb.signOutUser).toHaveBeenCalled()
    expect(persisted()).toBeNull()
  })

  it('syncNow runs a full sync when signed in, and is a no-op for guests', async () => {
    await useAuthStore.getState().syncNow()
    expect(syncMock.requestSync).not.toHaveBeenCalled()
    fb.signInWithGoogle.mockResolvedValueOnce(ANA)
    await useAuthStore.getState().signIn()
    await useAuthStore.getState().syncNow()
    expect(syncMock.requestSync).toHaveBeenCalledWith('full')
  })

  it('deleteCloudData stops sync, deletes the cloud copy and signs out', async () => {
    expect(await useAuthStore.getState().deleteCloudData()).toBe(false)
    fb.signInWithGoogle.mockResolvedValueOnce(ANA)
    await useAuthStore.getState().signIn()
    expect(await useAuthStore.getState().deleteCloudData()).toBe(true)
    expect(syncMock.stopAutoSync).toHaveBeenCalled()
    expect(syncMock.deleteRemoteData).toHaveBeenCalledWith('u1')
    expect(useAuthStore.getState()).toMatchObject({ status: 'guest', user: null, syncing: false })
  })
})
