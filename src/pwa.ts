/** Service worker registration (offline + installable). Auto-updates silently. */
export function registerPWA() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return
  import('virtual:pwa-register')
    .then(({ registerSW }) => {
      registerSW({ immediate: true })
    })
    .catch(() => {
      /* offline support is best-effort */
    })
}

/**
 * After a deploy, an already-open tab can ask for a lazy chunk whose hashed file is gone.
 * Reload once (state is persisted, workouts resume) instead of leaving a blank screen.
 */
export function recoverFromStaleChunks() {
  window.addEventListener('vite:preloadError', (e) => {
    try {
      if (sessionStorage.getItem('gf:chunk-reload')) return
      sessionStorage.setItem('gf:chunk-reload', '1')
    } catch {
      /* storage unavailable: still try once */
    }
    e.preventDefault()
    location.reload()
  })
}
