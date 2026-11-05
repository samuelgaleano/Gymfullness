import { test as base, expect, type Page } from '@playwright/test'

/** Fails the test on any console error / uncaught page error (journey rule k). */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = []
      page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`console: ${m.text()}`)
      })
      await use(errors)
      expect(errors, 'console/page errors').toEqual([])
    },
    { auto: true },
  ],
})
export { expect }

/** First run → guest → skip plan setup → Home. */
export async function startAsGuest(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Empezar sin cuenta' }).click()
  const skip = page.getByRole('button', { name: 'Saltar por ahora' })
  await skip.click()
  await expect(page.getByRole('button', { name: /Empezar entreno/ })).toBeVisible()
}

export async function startWorkout(page: Page) {
  await page.getByRole('button', { name: /Empezar entreno/ }).click()
  await expect(page.getByRole('button', { name: 'Serie hecha' })).toBeVisible()
}

/** Wait until the persisted store (IndexedDB) has been flushed, so reloads see it. */
export async function flush(page: Page) {
  await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
}

export const state = <T = any>(page: Page, fn: string): Promise<T> =>
  page.evaluate(async (src) => {
    const raw = await new Promise<string | undefined>((res) => {
      const open = indexedDB.open('keyval-store')
      open.onsuccess = () => {
        const g = open.result.transaction('keyval').objectStore('keyval').get('gymfullness:v1')
        g.onsuccess = () => res(g.result)
      }
    })
    const st = JSON.parse(raw ?? '{}').state
    // eslint-disable-next-line no-new-func
    return new Function('st', `return (${src})(st)`)(st)
  }, fn)

/** Remove Web Speech so the mic falls back to the text box (deterministic across browsers). */
export async function withoutSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as any
    delete w.SpeechRecognition
    delete w.webkitSpeechRecognition
  })
}

export const doneCount = (page: Page) =>
  state<number>(page, `(st) => (st.activeSession ? st.activeSession.exercises.flatMap((e) => e.sets).filter((s) => s.done).length : -1)`)

/** Log one set, skip the rest, finish via the menu → summary. Leaves the page on /summary/:id. */
export async function quickSession(page: Page) {
  await startWorkout(page)
  await logSet(page)
  await skipRest(page)
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.getByText('Terminar entreno').click()
  await page.getByRole('button', { name: 'Terminar igual' }).click()
  await expect(page).toHaveURL(/\/summary\//)
}

/** The workout screen swallows taps on its primary button that come faster than this (double-tap guard). */
export const TAP_GUARD_MS = 450

/** Tap "Serie hecha" and wait for the rest view. */
export async function logSet(page: Page) {
  await page.waitForTimeout(TAP_GUARD_MS + 50)
  await page.getByRole('button', { name: 'Serie hecha' }).click()
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
}

/** Tap "Saltar descanso" (after the tap-guard window, like a real second tap) and wait for the set view. */
export async function skipRest(page: Page) {
  await page.waitForTimeout(TAP_GUARD_MS + 50)
  await page.getByRole('button', { name: 'Saltar descanso' }).click()
  await expect(page.getByRole('region', { name: 'Descanso' })).toHaveCount(0)
}
