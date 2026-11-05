import { test, expect, skipRest, startAsGuest, startWorkout, state, withoutSpeech } from './fixtures'

test('(b) voice-note fallback: text box "80 por 10" logs the set', async ({ page }) => {
  await withoutSpeech(page)
  await startAsGuest(page)
  await startWorkout(page)
  await page.getByRole('button', { name: 'Escribir serie' }).click()
  await page.getByLabel('Serie o comando').fill('80 por 10')
  await page.getByRole('button', { name: 'Enviar' }).click()
  // confirmation bubble, then auto-confirm logs it
  await expect(page.getByRole('region', { name: 'Descanso' })).toBeVisible()
  await expect
    .poll(() => state(page, `(st) => { const s = st.activeSession.exercises[0].sets[0]; return [s.done, s.weight, s.reps, s.source] }`))
    .toEqual([true, 80, 10, 'text'])
})

test('(b) text box understands commands ("igual" repeats the last set)', async ({ page }) => {
  await withoutSpeech(page)
  await startAsGuest(page)
  await startWorkout(page)
  await page.getByRole('button', { name: 'Escribir serie' }).click()
  await page.getByLabel('Serie o comando').fill('60x8')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(() => state(page, `(st) => st.activeSession.exercises[0].sets[0].weight`)).toBe(60)
  await skipRest(page)
  await page.getByRole('button', { name: 'Escribir serie' }).click()
  await page.getByLabel('Serie o comando').fill('igual')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await expect
    .poll(() => state(page, `(st) => st.activeSession.exercises[0].sets.map((s) => [s.done, s.weight, s.reps])`))
    .toEqual([[true, 60, 8], [true, 60, 8], [false, 60, 10]])
})
