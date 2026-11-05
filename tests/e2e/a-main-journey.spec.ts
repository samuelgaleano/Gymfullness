import { test, expect, logSet, skipRest, startAsGuest, startWorkout, doneCount, state } from './fixtures'

test('(a) first run → workout → rest → skip → undo → finish → summary → home', async ({ page }) => {
  await startAsGuest(page)
  await expect(page.getByText('Hoy toca')).toBeVisible()
  await startWorkout(page)
  await expect(page.getByRole('heading', { name: 'Sentadilla con barra' })).toBeVisible()
  await expect(page.getByText('Serie 1 de 3')).toBeVisible()

  // tap "Serie hecha": toast + rest starts
  await logSet(page)
  await expect(page.getByText('Serie 1 · 10 reps')).toBeVisible()
  await expect.poll(() => doneCount(page)).toBe(1)

  // skip rest → next set (2 of 3)
  await skipRest(page)
  await expect(page.getByText('Serie 2 de 3')).toBeVisible()

  // log 2nd, then undo from the toast
  await logSet(page)
  await expect.poll(() => doneCount(page)).toBe(2)
  await page.getByRole('button', { name: 'Deshacer' }).click()
  await expect.poll(() => doneCount(page)).toBe(1)
  await expect(page.getByRole('region', { name: 'Descanso' })).toHaveCount(0)
  await expect(page.getByText('Serie 2 de 3')).toBeVisible()

  // redo the set and finish from the menu (remaining sets → confirm)
  await logSet(page)
  await skipRest(page)
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.getByText('Terminar entreno').click()
  await expect(page.getByText(/Te faltan \d+ series/)).toBeVisible()
  await page.getByRole('button', { name: 'Terminar igual' }).click()

  // summary
  await expect(page).toHaveURL(/\/summary\/.+/)
  await expect(page.getByRole('region', { name: 'Resumen' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Resumen' })).toContainText('Series')
  await page.getByRole('button', { name: 'Listo' }).click()

  // home shows the last session
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('region', { name: 'Último entreno' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Último entreno' })).toContainText('Día A')
  expect(await state(page, `(st) => st.sessions.length`)).toBe(1)
  expect(await state(page, `(st) => st.activeSession`)).toBeNull()
})
