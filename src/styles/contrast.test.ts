/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Contrast check computed from the design-token values (dark + light), WCAG 2.x. */

type RGBA = [number, number, number, number]

function parseColor(v: string): RGBA {
  const s = v.trim()
  if (s.startsWith('#')) {
    const h = s.slice(1)
    const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h
    return [parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16), 1]
  }
  const m = s.match(/rgba?\(([^)]+)\)/)
  if (!m) throw new Error(`unparsable color ${v}`)
  const [r, g, b, a = '1'] = m[1].split(',').map((x) => x.trim())
  return [Number(r), Number(g), Number(b), Number(a)]
}

function over(fg: RGBA, bg: RGBA): RGBA {
  const a = fg[3]
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1]
}

function lum([r, g, b]: RGBA): number {
  const f = (c: number) => {
    const x = c / 255
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
}

export function contrast(fg: RGBA, bg: RGBA): number {
  const f = over(fg, bg)
  const [a, b] = [lum(f), lum(bg)].sort((x, y) => y - x)
  return (a + 0.05) / (b + 0.05)
}

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const m of block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].replace(/\/\*.*?\*\//g, '').trim()
  return out
}

const css = readFileSync(resolve(process.cwd(), 'src/styles/tokens.css'), 'utf8')
const darkBlock = css.slice(css.indexOf(':root {'), css.indexOf('/* Light theme'))
const lightBlock = css.slice(css.indexOf("--bg: #eef0f4"), css.indexOf("--aurora-1", css.indexOf("--bg: #eef0f4")))
const dark = tokens(darkBlock)
const light = { ...dark, ...tokens(lightBlock) }

const themes = { dark, light }

describe.each(Object.entries(themes))('%s theme contrast', (_name, t) => {
  const bg = parseColor(t.bg)
  // text sits on the page or on a glass card (translucent white over the page background)
  const surfaces: [string, RGBA][] = [
    ['page', bg],
    ['glass', over(parseColor(t.glass), bg)],
    ['glass-strong', over(parseColor(t['glass-strong']), bg)],
  ]
  const texts: [string, number][] = [
    ['text', 7],
    ['text-2', 4.5],
    ['accent-text', 4.5],
    ['danger', 4.5],
    ['rest', 3], // large timer numerals / icons, not body copy
    ['pr', 3],
    ['success', 3],
  ]
  for (const [token, min] of texts) {
    it(`--${token} ≥ ${min}:1 on every surface`, () => {
      for (const [sname, s] of surfaces) {
        const c = contrast(parseColor(t[token]), s)
        expect(c, `${token} on ${sname}: ${c.toFixed(2)}`).toBeGreaterThanOrEqual(min)
      }
    })
  }

  it('--text-on-accent is readable on the accent button', () => {
    const accent = parseColor(t.accent)
    expect(contrast(parseColor(t['text-on-accent'] ?? '#0b0d08'), accent)).toBeGreaterThanOrEqual(7)
  })

  it('--text-3 (hint text) is documented as ≥ 3:1 on the page', () => {
    // Used for captions/axis labels only. WCAG body text wants 4.5; track the real number here.
    expect(contrast(parseColor(t['text-3']), bg)).toBeGreaterThanOrEqual(3)
  })
})
