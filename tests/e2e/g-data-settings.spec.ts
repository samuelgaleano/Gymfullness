import { readFileSync } from 'node:fs'
import { test, expect, logSet, skipRest, startAsGuest, quickSession, state } from './fixtures'

test('(g) export JSON then import (replace) restores the data', async ({ page }, testInfo) => {
  await startAsGuest(page)
  await quickSession(page)
  await page.getByRole('button', { name: 'Listo' }).click()
  await page.getByRole('link', { name: 'Perfil' }).click()

  // export
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('Exportar copia (JSON)').click(),
  ])
  const file = testInfo.outputPath('backup.json')
  await download.saveAs(file)
  const backup = JSON.parse(readFileSync(file, 'utf8'))
  expect(backup.version).toBe(1)
  expect(backup.sessions).toHaveLength(1)

  // wipe everything the real way (typed confirmation)
  await page.getByText('Borrar todos los datos').click()
  await page.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR')
  await page.getByRole('dialog').getByRole('button', { name: 'Borrar todo' }).click()
  await expect.poll(() => state(page, `(st) => st.sessions.length`)).toBe(0)
  await page.waitForLoadState()
  // after wiping, the app may route to /welcome — import from there or from profile
  if (/welcome/.test(page.url())) {
    await page.getByRole('button', { name: 'Empezar sin cuenta' }).click()
    await page.getByRole('button', { name: 'Saltar por ahora' }).click()
    await page.getByRole('link', { name: 'Perfil' }).click()
  }

  // import (replace)
  await page.getByLabel('Elegir archivo de copia').setInputFiles(file)
  const dlg = page.getByRole('dialog', { name: 'Importar datos' })
  await expect(dlg).toBeVisible()
  await expect(dlg).toContainText('1 entreno')
  await dlg.getByRole('radio', { name: /Reemplazar/ }).click()
  await dlg.getByRole('button', { name: 'Reemplazar' }).click()
  await expect.poll(() => state(page, `(st) => st.sessions.length`)).toBe(1)
  expect(await state(page, `(st) => st.routines.length > 0`)).toBe(true)

  // and Home shows the restored last session (not the welcome screen)
  await page.getByRole('link', { name: 'Hoy' }).click()
  await expect(page.getByRole('region', { name: 'Último entreno' })).toBeVisible()
})

test('(h) settings persist across reload; kg → lb converts the weights shown next time', async ({ page }) => {
  await startAsGuest(page)
  // a 100 kg set, finished and saved in kg
  await page.getByRole('button', { name: /Empezar entreno/ }).click()
  const peso = page.getByRole('textbox', { name: 'Peso' })
  await peso.fill('100')
  await peso.blur()
  await logSet(page)
  await skipRest(page)
  await page.getByRole('button', { name: 'Más opciones' }).click()
  await page.getByText('Terminar entreno').click()
  await page.getByRole('button', { name: 'Terminar igual' }).click()
  await expect(page.getByRole('region', { name: 'Resumen' })).toContainText('Volumen (kg)')
  await page.getByRole('button', { name: 'Listo' }).click()

  await page.getByRole('link', { name: 'Perfil' }).click()
  const unit = page.getByRole('radiogroup', { name: 'Unidad de peso' })
  await unit.getByRole('radio', { name: 'lb' }).click()
  await expect(unit.getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true')
  await page.getByRole('switch', { name: 'Sonidos' }).click()
  await expect(page.getByRole('switch', { name: 'Sonidos' })).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('button', { name: 'Más descanso' }).click()
  const rest = await state<number>(page, `(st) => st.settings.defaultRestSec`)
  await expect.poll(() => state(page, `(st) => st.settings.unit`)).toBe('lb')

  await page.reload()
  await expect(page.getByRole('radiogroup', { name: 'Unidad de peso' }).getByRole('radio', { name: 'lb' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('switch', { name: 'Sonidos' })).toHaveAttribute('aria-checked', 'false')
  expect(await state(page, `(st) => st.settings.defaultRestSec`)).toBe(rest)

  // the next workout prefills last time's 100 kg as ~220 lb, in lb
  await page.getByRole('link', { name: 'Rutinas' }).click()
  await page.getByRole('button', { name: /^Empezar Día A/ }).click()
  await expect(page.getByRole('textbox', { name: 'Peso' })).toHaveValue(/^22\d(,\d)?$/)
  await expect(page.locator('.wk-block')).toContainText('lb')
  expect(await state(page, `(st) => st.activeSession.unit`)).toBe('lb')
})
