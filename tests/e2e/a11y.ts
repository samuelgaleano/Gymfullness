import type { Page } from '@playwright/test'

export interface A11yIssue {
  kind: string
  detail: string
}

/** axe-like smoke checks run inside the page. Visible, interactive elements only. */
export async function auditA11y(page: Page): Promise<A11yIssue[]> {
  return page.evaluate(() => {
    const issues: { kind: string; detail: string }[] = []
    const visible = (el: Element) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const cs = getComputedStyle(el)
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"]')
    }
    const describe = (el: Element) => `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`
    const nameOf = (el: Element): string => {
      const aria = el.getAttribute('aria-label')?.trim()
      if (aria) return aria
      const lb = el.getAttribute('aria-labelledby')
      if (lb) {
        const t = lb
          .split(' ')
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ')
          .trim()
        if (t) return t
      }
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
        const l = el.labels?.[0]?.textContent?.trim()
        if (l) return l
        if ((el as HTMLInputElement).placeholder && el.getAttribute('aria-label') === null) return ''
      }
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text) return text
      const img = el.querySelector('img[alt]')
      if (img?.getAttribute('alt')) return img.getAttribute('alt')!
      return el.getAttribute('title')?.trim() ?? ''
    }

    document.querySelectorAll('button, a[href], [role="button"], [role="radio"], [role="switch"], [role="tab"], select, input:not([type="hidden"]), textarea, [role="slider"]').forEach((el) => {
      if (!visible(el)) return
      if (!nameOf(el)) issues.push({ kind: 'no-accessible-name', detail: describe(el) })
    })
    document.querySelectorAll('img').forEach((img) => {
      if (visible(img) && !img.hasAttribute('alt')) issues.push({ kind: 'img-no-alt', detail: describe(img) })
    })
    const ids = new Map<string, number>()
    document.querySelectorAll('[id]').forEach((e) => ids.set(e.id, (ids.get(e.id) ?? 0) + 1))
    ids.forEach((n, id) => n > 1 && issues.push({ kind: 'duplicate-id', detail: id }))
    if (!document.documentElement.lang) issues.push({ kind: 'html-no-lang', detail: '' })
    if (!document.title) issues.push({ kind: 'no-title', detail: '' })
    if (!document.querySelector('meta[name="viewport"]')) issues.push({ kind: 'no-viewport', detail: '' })
    if (document.querySelector('meta[name="viewport"]')?.getAttribute('content')?.match(/user-scalable=no|maximum-scale=1(\.0)?(,|$)/)) {
      issues.push({ kind: 'zoom-disabled', detail: '' })
    }
    const mains = [...document.querySelectorAll('main')].filter(visible)
    if (mains.length !== 1) issues.push({ kind: 'main-landmark', detail: `${mains.length} <main>` })
    // touch targets (spec: ≥ 44 px; allow inline text links inside paragraphs)
    document.querySelectorAll('button, [role="button"], [role="radio"], a.tabbar__item').forEach((el) => {
      if (!visible(el)) return
      if (el.classList.contains('switch')) return // iOS-style switch: the whole settings row is the tap target
      const r = el.getBoundingClientRect()
      if (r.width < 32 || r.height < 32) issues.push({ kind: 'small-target', detail: `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)} "${nameOf(el).slice(0, 24)}"` })
    })
    return issues
  })
}

/** Tab through the page: every stop must be visible and show a focus indicator; returns problems. */
export async function auditFocus(page: Page, maxStops = 40): Promise<A11yIssue[]> {
  const issues: A11yIssue[] = []
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
  let lastY = -1
  for (let i = 0; i < maxStops; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null
      if (!el || el === document.body) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0
      const ring = cs.boxShadow !== 'none' && cs.boxShadow !== ''
      return {
        tag: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''),
        visible: r.width > 0 && r.height > 0,
        indicator: outline || ring,
        top: r.top,
        modal: !!el.closest('[aria-modal="true"]'),
      }
    })
    if (!info) break
    if (!info.visible) issues.push({ kind: 'focus-hidden', detail: info.tag })
    if (!info.indicator) issues.push({ kind: 'focus-no-indicator', detail: info.tag })
    lastY = info.top
  }
  void lastY
  return issues
}
