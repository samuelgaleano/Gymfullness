import { test, expect, startAsGuest, quickSession, state } from './fixtures'

test('(f) body weight log + Progress tabs render with data', async ({ page }) => {
  await startAsGuest(page)
  await quickSession(page)
  await page.getByRole('button', { name: 'Listo' }).click()

  await page.getByRole('link', { name: 'Progreso' }).click()
  await expect(page.getByRole('heading', { name: 'Progreso', level: 1 })).toBeVisible()
  const seg = page.getByRole('radiogroup', { name: 'Sección de progreso' })

  // Resumen (has one session now)
  await seg.getByRole('radio', { name: 'Resumen' }).click()
  await expect(page.locator('.pg-pane')).not.toBeEmpty()
  await expect(page.locator('.pg-pane svg').first()).toBeVisible()

  // Cuerpo: log a weight
  await seg.getByRole('radio', { name: 'Cuerpo' }).click()
  await page.getByRole('button', { name: /Registrar peso/ }).click()
  const dlg = page.getByRole('dialog', { name: 'Registrar medidas' })
  await dlg.getByRole('textbox', { name: 'Peso', exact: true }).fill('72,4')
  await dlg.getByRole('textbox', { name: 'Peso', exact: true }).blur()
  await dlg.getByRole('button', { name: 'Guardar' }).click()
  await expect(dlg).toHaveCount(0)
  await expect(page.locator('.pg-weight__value')).toContainText('72,4')
  await expect(page.getByRole('region', { name: 'Registros' })).toBeVisible()
  expect(await state(page, `(st) => st.bodyLogs.filter((b) => !b.deleted).map((b) => b.weight)`)).toEqual([72.4])
  await expect(page.getByRole('img', { name: /Peso corporal.*72,4 kg/ })).toBeVisible()

  // Ejercicios
  await seg.getByRole('radio', { name: 'Ejercicios' }).click()
  await expect(page.getByText('Sentadilla con barra').first()).toBeVisible()

  // Historial → session detail → back
  await seg.getByRole('radio', { name: 'Historial' }).click()
  await expect(page.getByText(/Día A/).first()).toBeVisible()
  await page.getByText(/Día A/).first().click()
  await expect(page).toHaveURL(/\/history\//)
  await expect(page.getByRole('region', { name: 'Resumen' })).toBeVisible()
})
