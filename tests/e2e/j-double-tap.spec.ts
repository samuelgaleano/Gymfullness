import { test, expect, startAsGuest, startWorkout, state } from './fixtures'

test('rapid double-tap on "Serie hecha" logs once and keeps the rest running', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  const btn = page.getByRole('button', { name: 'Serie hecha' })
  // two clicks in the same task: as fast as a human can mash it
  await btn.evaluate((el: HTMLElement) => {
    el.click()
    el.click()
  })
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Saltar descanso' })).toBeVisible()
  await expect
    .poll(() => state<number>(page, `(st) => st.activeSession.exercises.flatMap((e) => e.sets).filter((s) => s.done).length`))
    .toBe(1)
})

test('double click with real pointer input logs once and does not skip the rest', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  await page.getByRole('button', { name: 'Serie hecha' }).dblclick({ delay: 30 })
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
  await expect
    .poll(() => state<number>(page, `(st) => st.activeSession.exercises.flatMap((e) => e.sets).filter((s) => s.done).length`))
    .toBe(1)
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
})
