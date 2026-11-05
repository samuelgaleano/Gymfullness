import { test, expect, startAsGuest, startWorkout } from './fixtures'
import { auditA11y, auditFocus } from './a11y'

test.describe('a11y smoke', () => {
  test('main screens have names, landmarks and visible focus', async ({ page }) => {
    await startAsGuest(page)
    const routes: [string, string][] = [
      ['/', 'Hoy'],
      ['/routines', 'Rutinas'],
      ['/exercises', 'Biblioteca'],
      ['/progress', 'Progreso'],
      ['/profile', 'Perfil'],
    ]
    const all: string[] = []
    for (const [path, name] of routes) {
      await page.goto(path)
      await expect(page.locator('main')).toBeVisible()
      await expect(page.locator('main')).toContainText(/\S/)
      const issues = await auditA11y(page)
      all.push(...issues.map((i) => `${name}: ${i.kind} ${i.detail}`))
      const focus = await auditFocus(page, 25)
      all.push(...focus.map((i) => `${name}: ${i.kind} ${i.detail}`))
    }
    expect(all, 'a11y issues').toEqual([])
  })

  test('workout screen (set view, rest view) passes the smoke checks', async ({ page }) => {
    await startAsGuest(page)
    await startWorkout(page)
    const all: string[] = []
    all.push(...(await auditA11y(page)).map((i) => `set: ${i.kind} ${i.detail}`))
    all.push(...(await auditFocus(page, 25)).map((i) => `set: ${i.kind} ${i.detail}`))
    await page.getByRole('button', { name: 'Serie hecha' }).click()
    await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
    all.push(...(await auditA11y(page)).map((i) => `rest: ${i.kind} ${i.detail}`))
    expect(all, 'a11y issues').toEqual([])
  })

  test('sheets are labelled dialogs and trap Escape', async ({ page }) => {
    await startAsGuest(page)
    await startWorkout(page)
    await page.getByRole('button', { name: 'Más opciones' }).click()
    const dlg = page.getByRole('dialog', { name: 'Opciones' })
    await expect(dlg).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dlg).toHaveCount(0)
  })
})
