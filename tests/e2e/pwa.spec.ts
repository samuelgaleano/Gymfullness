import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test, expect, startAsGuest, startWorkout } from './fixtures'

const root = process.cwd() // playwright runs from the repo root

test.describe('PWA audit', () => {
  test('manifest is valid and installable', async ({ page, request, baseURL }) => {
    await page.goto('/')
    const href = await page.locator('link[rel="manifest"]').getAttribute('href')
    expect(href).toBeTruthy()
    const res = await request.get(new URL(href!, baseURL).toString())
    expect(res.ok()).toBe(true)
    const m = await res.json()
    expect(m).toMatchObject({ display: 'standalone', start_url: '/', scope: '/', lang: 'es' })
    expect(m.name.length).toBeGreaterThan(3)
    expect(m.short_name.length).toBeLessThanOrEqual(12)
    expect(m.id).toBeTruthy()
    expect(m.theme_color).toMatch(/^#[0-9a-f]{6}$/i)
    expect(m.background_color).toMatch(/^#[0-9a-f]{6}$/i)

    const sizes = new Set<string>()
    let maskable = false
    for (const icon of m.icons) {
      const r = await request.get(new URL(icon.src, baseURL).toString())
      expect(r.ok(), icon.src).toBe(true)
      expect(r.headers()['content-type']).toContain('image/png')
      const buf = await r.body()
      const w = buf.readUInt32BE(16)
      const h = buf.readUInt32BE(20)
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes)
      sizes.add(icon.sizes)
      if (String(icon.purpose ?? '').includes('maskable')) maskable = true
    }
    expect(sizes.has('192x192') && sizes.has('512x512')).toBe(true)
    expect(maskable).toBe(true)
  })

  test('head: theme-color (dark+light), apple tags, viewport-fit, icons, lang', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'es')
    const metas = await page.locator('meta[name="theme-color"]').evaluateAll((els) => els.map((e) => [e.getAttribute('content'), e.getAttribute('media')]))
    expect(metas.length).toBeGreaterThanOrEqual(2)
    await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="mobile-web-app-capable"]')).toHaveAttribute('content', 'yes')
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute('content', 'Gymfullness')
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
    await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', /viewport-fit=cover/)
    const cache = await page.request.get('/sw.js')
    expect(cache.ok()).toBe(true)
    expect(await cache.text()).toContain('precacheAndRoute')
  })

  test('service worker: precache stays small and update flow takes over immediately', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ serviceWorkers: 'allow', baseURL })
    const page = await context.newPage()
    await page.goto('/')
    await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state), { timeout: 20_000 }).toBe('activated')
    const sw = await (await page.request.get('/sw.js')).text()
    expect(sw).toContain('clientsClaim')
    expect(sw).toContain('skipWaiting')
    expect(sw).toContain('cleanupOutdatedCaches')
    // precache budget: the install must stay light on mobile data
    const bytes = await page.evaluate(async () => {
      let total = 0
      for (const key of await caches.keys()) {
        if (!key.includes('precache')) continue
        const cache = await caches.open(key)
        for (const req of await cache.keys()) total += (await (await cache.match(req))!.arrayBuffer()).byteLength
      }
      return total
    })
    expect(bytes).toBeGreaterThan(300_000)
    expect(bytes).toBeLessThan(1_200_000)
    // the optional Firebase SDK must not be part of the install
    const keys = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => r.url)))).flat())
    expect(keys.some((u) => /firebase-sdk/.test(u))).toBe(false)
    expect(keys.some((u) => /cyrillic|greek|vietnamese/.test(u))).toBe(false)
    await context.close()
  })

  test('initial load does not fetch the Firebase SDK', async ({ page }) => {
    const requested: string[] = []
    page.on('request', (r) => requested.push(r.url()))
    await startAsGuest(page)
    await startWorkout(page)
    expect(requested.filter((u) => /firebase-sdk|gstatic|googleapis|apis\.google/.test(u))).toEqual([])
  })

  test('public/_headers: security headers present, and the CSP does not break the app', async ({ page, context }) => {
    const text = readFileSync(join(root, 'public/_headers'), 'utf8')
    const star = text.split(/\n(?=\S)/).find((b) => b.startsWith('/*'))!
    const headers: Record<string, string> = {}
    for (const line of star.split('\n').slice(1)) {
      const i = line.indexOf(':')
      if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim()
    }
    for (const k of ['x-content-type-options', 'referrer-policy', 'permissions-policy', 'content-security-policy', 'x-frame-options', 'strict-transport-security']) {
      expect(headers[k], k).toBeTruthy()
    }
    const csp = headers['content-security-policy']
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'none'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(/script-src[^;]*'unsafe-inline'/.test(csp)).toBe(false)
    expect(headers['permissions-policy']).toContain('microphone=(self)')

    // serve every response with the real headers and run a journey: no CSP violation allowed
    const violations: string[] = []
    page.on('console', (m) => /Content Security Policy|Refused to/.test(m.text()) && violations.push(m.text()))
    await context.route('**/*', async (route) => {
      const res = await route.fetch()
      await route.fulfill({ response: res, headers: { ...res.headers(), 'content-security-policy': csp } })
    })
    await startAsGuest(page)
    await startWorkout(page)
    await page.getByRole('button', { name: 'Serie hecha' }).click()
    await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
    await page.getByRole('button', { name: 'Minimizar entreno' }).click()
    await page.getByRole('link', { name: 'Progreso' }).click()
    await page.getByRole('link', { name: 'Perfil' }).click()
    await expect(page.getByRole('heading', { name: 'Perfil', level: 1 })).toBeVisible()
    expect(violations).toEqual([])
  })

  test('unknown routes redirect home (SPA fallback) and /api is not hijacked by the SW', async ({ page }) => {
    await startAsGuest(page)
    await page.goto('/ruta-que-no-existe')
    await expect(page).toHaveURL(/\/$/)
    const sw = readFileSync(join(root, 'dist/sw.js'), 'utf8')
    expect(sw).toMatch(/denylist:\[\/\^\\\/api\\\//)
  })
})
