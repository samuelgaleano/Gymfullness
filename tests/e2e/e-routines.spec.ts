import { test, expect, startAsGuest, state } from './fixtures'

const routineNames = (page: import('@playwright/test').Page) =>
  state<string[]>(page, `(st) => st.routines.filter((r) => !r.deleted).map((r) => r.name)`)

test('(e) plan wizard from Routines replaces the plan', async ({ page }) => {
  await startAsGuest(page)
  await page.getByRole('link', { name: 'Rutinas' }).click()
  await expect(page.getByRole('heading', { name: 'Rutinas', level: 1 })).toBeVisible()
  const planBefore = await state<string>(page, `(st) => JSON.stringify(st.plan.routineIds)`)
  await page.getByRole('button', { name: 'Cambiar' }).first().click()
  const dlg = page.getByRole('dialog', { name: 'Cambiar plan' })
  await expect(dlg).toBeVisible()
  // answer the 4 questions (each pick auto-advances)
  for (let step = 1; step <= 4; step++) {
    await expect(dlg.getByRole('progressbar')).toHaveAttribute('aria-valuenow', String(step))
    await dlg.getByRole('radio').nth(step % 2).click()
  }
  await expect(dlg.getByText('Tu plan está listo')).toBeVisible()
  await dlg.getByRole('button', { name: 'Crear mi plan' }).click()
  await expect(dlg).toHaveCount(0)
  await expect.poll(() => state<string>(page, `(st) => JSON.stringify(st.plan.routineIds)`)).not.toBe(planBefore)
  await expect(page.getByRole('list', { name: 'Orden de rotación' })).toBeVisible()
  await expect(page.getByText('Hoy toca').first()).toBeVisible()
})

test('(e) routine editor: create → edit → delete', async ({ page }) => {
  await startAsGuest(page)
  await page.getByRole('link', { name: 'Rutinas' }).click()

  // create
  await page.getByRole('button', { name: 'Nueva rutina' }).click()
  await expect(page.getByRole('heading', { name: 'Nueva rutina' })).toBeVisible()
  await page.getByLabel('Nombre').fill('Mi empuje E2E')
  await page.getByRole('button', { name: 'Añadir ejercicio' }).click()
  const picker = page.getByRole('dialog', { name: 'Añadir ejercicio' })
  await picker.getByLabel('Buscar ejercicio').fill('press banca')
  await picker.getByRole('button').filter({ hasText: /banca/i }).first().click()
  await expect(page.locator('.rt-item')).toHaveCount(1)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page).toHaveURL(/\/routines$/)
  await expect(page.locator('.rt-routine__main', { hasText: 'Mi empuje E2E' })).toBeVisible()
  expect(await routineNames(page)).toContain('Mi empuje E2E')

  // edit
  await page.locator('.rt-routine__main', { hasText: 'Mi empuje E2E' }).click()
  await expect(page.getByRole('heading', { name: 'Editar rutina' })).toBeVisible()
  await page.getByLabel('Nombre').fill('Empuje renombrado')
  await page.getByRole('button', { name: 'Más series de' }).first().click().catch(() => undefined)
  await page.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.locator('.rt-routine__main', { hasText: 'Empuje renombrado' })).toBeVisible()

  // delete
  await page.locator('.rt-routine__main', { hasText: 'Empuje renombrado' }).click()
  await page.getByRole('button', { name: 'Eliminar rutina' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Eliminar rutina' }).click()
  await expect(page).toHaveURL(/\/routines$/)
  await expect(page.locator('.rt-routine__main', { hasText: 'Empuje renombrado' })).toHaveCount(0)
  expect(await routineNames(page)).not.toContain('Empuje renombrado')
})

test('(e) unsaved editor changes are guarded when leaving through the tab bar', async ({ page }) => {
  await startAsGuest(page)
  await page.getByRole('link', { name: 'Rutinas' }).click()
  await page.getByRole('button', { name: 'Nueva rutina' }).click()
  await page.getByLabel('Nombre').fill('Borrador')
  await page.getByRole('link', { name: 'Perfil' }).click()
  const dlg = page.getByRole('dialog', { name: '¿Salir sin guardar?' })
  await expect(dlg).toBeVisible()
  await expect(page).toHaveURL(/\/routines\/new/)
  // stay → still on the editor, draft intact
  await dlg.getByRole('button', { name: 'Seguir editando' }).click()
  await expect(page.getByLabel('Nombre')).toHaveValue('Borrador')
  // leave → goes where the user was heading
  await page.getByRole('link', { name: 'Perfil' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Descartar cambios' }).click()
  await expect(page).toHaveURL(/\/profile$/)
  expect(await routineNames(page)).not.toContain('Borrador')
})
