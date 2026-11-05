import { defineConfig, devices } from '@playwright/test'

// Preview server port for e2e. `npm run e2e` reuses a server already running on this port
// (`npx vite preview --port 4300 --strictPort`), otherwise builds and starts one.
const PORT = Number(process.env.E2E_PORT ?? 4300)
const BASE_URL = process.env.BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 45_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    locale: 'es-CO',
    // Deterministic by default: the service worker is only exercised by offline.spec.ts.
    serviceWorkers: 'block',
  },
  projects: [
    // Chromium for both (only Chromium is preinstalled); the iPhone profile just changes viewport/UA.
    { name: 'iphone', use: { ...devices['iPhone 13'], browserName: 'chromium' } },
    { name: 'android', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 180_000,
      },
})
