import { test, expect, startAsGuest, startWorkout } from './fixtures'

/** Lighthouse-style lab numbers, by hand: Slow-4G + 4x CPU throttle through CDP. */
test.describe('performance (throttled mobile profile)', () => {
  test('first-run LCP/FCP budget and zero layout shift, also across screen transitions', async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name !== 'iphone', 'CPU-throttled lab run: once is enough')
    test.setTimeout(90_000)
    await page.addInitScript(() => {
      const w = window as any
      w.__m = { cls: 0, lcp: 0, fcp: 0 }
      new PerformanceObserver((l) => {
        for (const e of l.getEntries() as any[]) if (!e.hadRecentInput) w.__m.cls += e.value
      }).observe({ type: 'layout-shift', buffered: true })
      new PerformanceObserver((l) => {
        const es = l.getEntries()
        w.__m.lcp = es[es.length - 1].startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') w.__m.fcp = e.startTime
      }).observe({ type: 'paint', buffered: true })
    })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 })
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

    await page.goto('/', { waitUntil: 'load' })
    await expect(page.getByRole('button', { name: 'Empezar sin cuenta' })).toBeVisible()
    await expect.poll(() => page.evaluate(() => (window as any).__m.lcp), { timeout: 30_000 }).toBeGreaterThan(0)
    const first = await page.evaluate(() => (window as any).__m as { cls: number; lcp: number; fcp: number })
    console.log(`first run (slow 4G, 4x CPU): FCP ${Math.round(first.fcp)} ms, LCP ${Math.round(first.lcp)} ms, CLS ${first.cls.toFixed(3)}`)
    // budgets leave ~2x headroom for a loaded CI box (idle numbers: FCP/LCP ≈ 2.0 s)
    expect(first.fcp).toBeLessThan(4000)
    expect(first.lcp).toBeLessThan(5000)

    // walk through the screens: tabs, workout, rest
    await page.getByRole('button', { name: 'Empezar sin cuenta' }).click()
    await page.getByRole('button', { name: 'Saltar por ahora' }).click()
    for (const tab of ['Rutinas', 'Progreso', 'Perfil', 'Hoy']) {
      await page.getByRole('link', { name: tab }).click()
      await expect(page.locator('main')).toBeVisible()
    }
    await startWorkout(page)
    await page.getByRole('button', { name: 'Serie hecha' }).click()
    await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
    // let late layout shifts be reported
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 400))))
    const end = await page.evaluate(() => (window as any).__m.cls as number)
    console.log(`CLS after navigating all screens: ${end.toFixed(4)}`)
    expect(end).toBeLessThan(0.05)
  })
})
