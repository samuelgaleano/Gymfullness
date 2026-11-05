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
