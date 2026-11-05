import { test, expect, startAsGuest, startWorkout, doneCount } from './fixtures'

test.use({ serviceWorkers: 'allow' })

test('(i) offline after first load: the service worker serves the app and the workout still works', async ({ page, context }) => {
  await page.goto('/')
  // wait for the SW to be active and controlling (precache finished during install)
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((res) => navigator.serviceWorker.addEventListener('controllerchange', () => res(), { once: true }))
    }
    return reg.active?.state
  })
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.state)).toBe('activated')
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).length))).reduce((a, b) => a + b, 0))
  expect(cached).toBeGreaterThan(20)

  await startAsGuest(page)
  await context.setOffline(true)

  // hard reload while offline → served by the SW (app shell + lazy chunks from precache)
  await page.reload()
  await expect(page.getByRole('button', { name: /Empezar entreno/ })).toBeVisible()
  // deep link while offline (navigateFallback) and a not-yet-visited lazy screen
  await page.goto('/progress')
  await expect(page.getByRole('heading', { name: 'Progreso', level: 1 })).toBeVisible()
  await page.goto('/')
  await startWorkout(page)
  await page.getByRole('button', { name: 'Serie hecha' }).click()
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
  await expect.poll(() => doneCount(page)).toBe(1)

  // back online: nothing breaks
  await context.setOffline(false)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
})
