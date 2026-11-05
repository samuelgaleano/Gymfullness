import { describe, expect, it } from 'vitest'
import { createTapGuard } from './tapGuard'

describe('createTapGuard', () => {
  it('lets the first tap through and swallows rapid repeats', () => {
    let t = 1000
    const ok = createTapGuard(450, () => t)
    expect(ok()).toBe(true)
    t += 80
    expect(ok()).toBe(false)
    t += 200
    expect(ok()).toBe(false)
  })

  it('accepts a new tap once the window has passed (a swallowed tap does not extend it)', () => {
    let t = 0
    const ok = createTapGuard(450, () => t)
    expect(ok()).toBe(true)
    t = 400
    expect(ok()).toBe(false)
    t = 500
    expect(ok()).toBe(true)
  })

  it('works from time zero', () => {
    const ok = createTapGuard(450, () => 0)
    expect(ok()).toBe(true)
    expect(ok()).toBe(false)
  })
})
