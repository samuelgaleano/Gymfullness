import { test, expect, logSet, skipRest, startAsGuest, startWorkout, doneCount } from './fixtures'

test('(c) reload mid-workout resumes at the same exercise/set', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  await logSet(page)
  await skipRest(page)
  await expect.poll(() => doneCount(page)).toBe(1)
  await page.reload()
  await expect(page).toHaveURL(/\/workout/)
  await expect(page.getByText('Serie 2 de 3')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Sentadilla con barra' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Serie hecha' })).toBeVisible()
})

test('(c) reload mid-rest resumes the rest timer (timestamp based)', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  await logSet(page)
  await expect.poll(() => doneCount(page)).toBe(1)
  await page.reload()
  const rest = page.getByRole('region', { name: 'Descanso' })
  await expect(rest).toBeVisible()
  // still counting down (not reset to the full 2:00 and not finished)
  await expect(rest).toContainText(/[01]:\d\d/)
  await expect(page.getByRole('button', { name: 'Saltar descanso' })).toBeVisible()
  await page.getByRole('button', { name: 'Saltar descanso' }).click()
  await expect(page.getByText('Serie 2 de 3')).toBeVisible()
})

test('(c) minimizing the workout keeps it active on Home with a resume entry', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  await page.getByRole('button', { name: 'Minimizar entreno' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('button', { name: /Continuar|Seguir|Volver/ }).first()).toBeVisible()
})
