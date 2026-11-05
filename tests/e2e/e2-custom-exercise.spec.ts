import { test, expect, startAsGuest, state } from './fixtures'

test('(e) custom exercise: create → appears in library → delete', async ({ page }) => {
  await startAsGuest(page)
  await page.goto('/exercises')
  await page.getByRole('button', { name: 'Crear ejercicio' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Nombre').fill('Remo con banda E2E')
  await dlg.getByRole('button', { name: 'Espalda', exact: true }).click()
  await dlg.getByRole('button', { name: 'Banda', exact: true }).click()
  await dlg.getByRole('button', { name: 'Guardar ejercicio' }).click()
  await expect(page).toHaveURL(/\/exercises\/.+/)
  await expect(page.getByRole('heading', { name: 'Remo con banda E2E' })).toBeVisible()
  expect(await state(page, `(st) => st.customExercises.length`)).toBe(1)

  await page.getByRole('button', { name: 'Eliminar ejercicio' }).first().click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar ejercicio' }).click()
  await expect(page).toHaveURL(/\/exercises$/)
  await expect.poll(() => state(page, `(st) => st.customExercises.length`)).toBe(0)
  await page.getByLabel('Buscar ejercicio').fill('Remo con banda E2E')
  await expect(page.getByText('Sin resultados')).toBeVisible()
})
