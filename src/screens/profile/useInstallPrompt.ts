import { useCallback, useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export type InstallState =
  | 'installed' // already running as an installed app
  | 'prompt' // browser offered a native install prompt
  | 'ios' // iOS Safari: manual "Compartir → Añadir a pantalla de inicio"
  | 'unavailable' // nothing we can do (desktop Firefox, in-app browsers, …)

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as Mac with touch support
  return /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && navigator.maxTouchPoints > 1)
}

// The event can fire before the Profile screen mounts: capture it once at module level.
let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
let attached = false
function attach() {
  if (attached || typeof window === 'undefined') return
  attached = true
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    listeners.forEach((l) => l())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((l) => l())
  })
}
attach()

/** Tiny install-prompt hook: native prompt on Chromium/Android, instructions on iOS. */
export function useInstallPrompt(): { state: InstallState; install: () => Promise<'accepted' | 'dismissed' | 'unavailable'> } {
  const [, force] = useState(0)
  useEffect(() => {
    attach()
    const l = () => force((n) => n + 1)
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  }, [])

  const state: InstallState = isStandalone() ? 'installed' : deferred ? 'prompt' : isIOS() ? 'ios' : 'unavailable'

  const install = useCallback(async () => {
    const ev = deferred
    if (!ev) return 'unavailable' as const
    try {
      await ev.prompt()
      const { outcome } = await ev.userChoice
      deferred = null
      listeners.forEach((l) => l())
      return outcome
    } catch {
      return 'unavailable' as const
    }
  }, [])

  return { state, install }
}
