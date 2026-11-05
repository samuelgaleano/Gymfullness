import { test, expect, logSet, skipRest, startAsGuest, startWorkout, state } from './fixtures'

test('(d) swap exercise, add exercise, add set', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  const title = page.locator('.wk').getByRole('heading', { level: 1 })

  // --- swap: "Cambiar" → first suggested alternative
  const before = await state<string>(page, `(st) => st.activeSession.exercises[0].exerciseId`)
  await page.getByRole('button', { name: 'Cambiar' }).click()
  const option = page.locator('.wk-swap__item').first()
  await expect(option).toBeVisible()
  await option.click()
  await expect.poll(() => state<string>(page, `(st) => st.activeSession.exercises[0].exerciseId`)).not.toBe(before)
  await expect(page.getByText(/^Cambiado a /)).toBeVisible()
  await expect(page.getByText('Ejercicio 1 de 7')).toBeVisible()
  await expect(title).not.toHaveText('Sentadilla con barra')

  // --- add set: "+ Serie" → 4 sets
  expect(await state(page, `(st) => st.activeSession.exercises[0].sets.length`)).toBe(3)
  await page.getByRole('button', { name: 'Añadir una serie' }).click()
  await expect.poll(() => state(page, `(st) => st.activeSession.exercises[0].sets.length`)).toBe(4)
  await expect(page.getByText('Serie 1 de 4')).toBeVisible()

  // --- add exercise: menu → Añadir ejercicio → search → pick
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.getByText('Añadir ejercicio').click()
  const picker = page.getByRole('dialog', { name: 'Añadir ejercicio' })
  await picker.getByLabel('Buscar ejercicio').fill('remo')
  await picker.getByRole('button').filter({ hasText: /Remo/ }).first().click()
  await expect.poll(() => state(page, `(st) => st.activeSession.exercises.length`)).toBe(8)
  await expect(page.getByText('Ejercicio 1 de 8')).toBeVisible()
})

test('(d) editing a logged set changes its values and keeps it done', async ({ page }) => {
  await startAsGuest(page)
  await startWorkout(page)
  await logSet(page)
  await skipRest(page)
  await page.getByRole('button', { name: /^Serie 1 hecha/ }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByRole('textbox', { name: 'Peso' }).fill('55,5')
  await dlg.getByRole('textbox', { name: 'Peso' }).blur()
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect
    .poll(() => state(page, `(st) => { const s = st.activeSession.exercises[0].sets[0]; return [s.done, s.weight] }`))
    .toEqual([true, 55.5])
  await page.getByRole('button', { name: /^Serie 1 hecha/ }).click()
  await expect(page.getByRole('dialog').getByRole('textbox', { name: 'Peso' })).toHaveValue('55,5')
})
