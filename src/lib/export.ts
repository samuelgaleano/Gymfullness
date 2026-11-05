/**
 * Session export helpers (pure where possible): Spanish text summary, CSV, a 1080×1350 PNG card
 * rendered with canvas, download + Web Share. No dependencies.
 */
import type { SessionSummary } from './types'
import { formatWeight, formatVolume } from './units'
import { formatDuration } from './date'

/* ------------------------------------------------------------------ */
/* Shared formatting                                                   */
/* ------------------------------------------------------------------ */

type SummarySet = SessionSummary['exercises'][number]['sets'][number]

export interface SummaryExtras {
  feeling?: 1 | 2 | 3 | 4 | 5 | null
  notes?: string | null
}

export const FEELING_LABEL: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: 'Muy duro',
  2: 'Duro',
  3: 'Normal',
  4: 'Bien',
  5: 'Genial',
}

const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** 'miércoles, 5 de noviembre' */
export function formatLongDate(ts: number): string {
  return cap(new Date(ts).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' }))
}

/** '2026-11-05' (local) */
function isoDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** '80 kg × 10', '12 reps', '45 s', '–' */
export function formatSummarySet(s: SummarySet, unit: SessionSummary['unit']): string {
  const hasW = typeof s.weight === 'number' && s.weight > 0
  const hasR = typeof s.reps === 'number' && s.reps > 0
  const hasS = typeof s.seconds === 'number' && s.seconds > 0
  if (hasW && hasR) return `${formatWeight(s.weight)} ${unit} × ${s.reps}`
  if (hasR) return `${s.reps} ${s.reps === 1 ? 'rep' : 'reps'}`
  if (hasS) return `${s.seconds} s`
  if (hasW) return `${formatWeight(s.weight)} ${unit}`
  return '–'
}

/** Display value of a PR: its weight × reps, or (time / bodyweight PRs) the record set of its exercise. */
export function describePR(summary: SessionSummary, pr: SessionSummary['prs'][number]): string {
  const direct = formatSummarySet({ weight: pr.weight, reps: pr.reps }, summary.unit)
  if (direct !== '–') return direct
  const set = summary.exercises.find((e) => e.exerciseId === pr.exerciseId)?.sets.find((x) => x.isPR)
  return set ? formatSummarySet(set, summary.unit) : direct
}

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

/** Clean, shareable Spanish text summary. */
export function buildSummaryText(summary: SessionSummary, extras: SummaryExtras = {}): string {
  const lines: string[] = []
  lines.push(`${summary.name} · Gymfullness`)
  lines.push(`${formatLongDate(summary.startedAt)} · ${formatDuration(summary.durationSec)}`)
  const stats = [
    `${summary.exercises.length} ${summary.exercises.length === 1 ? 'ejercicio' : 'ejercicios'}`,
    `${summary.totalSets} ${summary.totalSets === 1 ? 'serie' : 'series'}`,
    `${summary.totalReps} reps`,
  ]
  if (summary.volume > 0) stats.push(formatVolume(summary.volume, summary.unit))
  lines.push(stats.join(' · '))

  if (summary.prs.length) {
    lines.push('')
    lines.push(summary.prs.length === 1 ? 'Récord personal' : 'Récords personales')
    for (const pr of summary.prs) {
      lines.push(`- ${pr.name}: ${describePR(summary, pr)}`)
    }
  }

  for (const ex of summary.exercises) {
    lines.push('')
    lines.push(ex.name)
    ex.sets.forEach((s, i) => lines.push(`${i + 1}. ${formatSummarySet(s, summary.unit)}${s.isPR ? ' (récord)' : ''}`))
  }

  if (extras.feeling) {
    lines.push('')
    lines.push(`Sensación: ${FEELING_LABEL[extras.feeling]} (${extras.feeling}/5)`)
  }
  if (extras.notes && extras.notes.trim()) {
    lines.push('')
    lines.push(`Notas: ${extras.notes.trim()}`)
  }
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */
/* CSV                                                                 */
/* ------------------------------------------------------------------ */

export const CSV_HEADER = ['fecha', 'entreno', 'ejercicio', 'serie', 'peso', 'unidad', 'reps', 'segundos', 'record'] as const

function csvCell(v: string | number | null | undefined): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** One row per set. UTF-8 text with `\n` line endings (prepend a BOM when saving for Excel). */
export function buildCsv(summary: SessionSummary): string {
  const rows: string[] = [CSV_HEADER.join(',')]
  const date = isoDay(summary.startedAt)
  for (const ex of summary.exercises) {
    ex.sets.forEach((s, i) => {
      rows.push(
        [
          date,
          summary.name,
          ex.name,
          i + 1,
          s.weight ?? '',
          s.weight != null ? summary.unit : '',
          s.reps ?? '',
          s.seconds ?? '',
          s.isPR ? 'si' : '',
        ]
          .map(csvCell)
          .join(','),
      )
    })
  }
  return rows.join('\n') + '\n'
}

export function csvBlob(csv: string): Blob {
  return new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' })
}

/* ------------------------------------------------------------------ */
/* File names                                                          */
/* ------------------------------------------------------------------ */

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'entreno'
  )
}

export function exportFileName(summary: SessionSummary, ext: 'png' | 'csv'): string {
  return `gymfullness-${isoDay(summary.startedAt)}-${slugify(summary.name)}.${ext}`
}

/* ------------------------------------------------------------------ */
/* PNG card (canvas)                                                   */
/* ------------------------------------------------------------------ */

export const CARD_WIDTH = 1080
export const CARD_HEIGHT = 1350

/* Canvas cannot read CSS variables, so the dark glass palette is mirrored here (values match
 * src/styles/tokens.css). The card is always dark, whatever the app theme is. */
const PAL = {
  bg: 'rgb(7, 8, 12)',
  text: 'rgb(245, 246, 248)',
  text2: 'rgba(235, 238, 245, 0.68)',
  text3: 'rgba(235, 238, 245, 0.42)',
  glass: 'rgba(255, 255, 255, 0.07)',
  glassBorder: 'rgba(255, 255, 255, 0.13)',
  accent: 'rgb(200, 245, 96)',
  onAccent: 'rgb(11, 13, 8)',
  rest: 'rgb(100, 210, 255)',
  pr: 'rgb(255, 179, 64)',
  aurora1: 'rgba(160, 230, 60, 0.30)',
  aurora2: 'rgba(60, 160, 255, 0.26)',
  aurora3: 'rgba(170, 90, 255, 0.20)',
}

const FONT = '"Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, "Segoe UI", sans-serif'

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + rr, y)
  ctx.arcTo(x + w, y, x + w, y + h, rr)
  ctx.arcTo(x + w, y + h, x, y + h, rr)
  ctx.arcTo(x, y + h, x, y, rr)
  ctx.arcTo(x, y, x + w, y, rr)
  ctx.closePath()
}

function glassPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = PAL.glass
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = PAL.glassBorder
  ctx.stroke()
  // top highlight
  const g = ctx.createLinearGradient(x, y, x, y + h * 0.5)
  g.addColorStop(0, 'rgba(255, 255, 255, 0.07)')
  g.addColorStop(1, 'rgba(255, 255, 255, 0)')
  roundRect(ctx, x, y, w, h, r)
  ctx.fillStyle = g
  ctx.fill()
}

function blob(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, color)
  g.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = g
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
}

function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text
  let t = text
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1)
  return `${t.trimEnd()}…`
}

function font(weight: number, size: number): string {
  return `${weight} ${size}px ${FONT}`
}

/** Pure layout data for the card (testable without a canvas). */
export function cardStats(summary: SessionSummary): { label: string; value: string }[] {
  return [
    { label: 'Duración', value: formatDuration(summary.durationSec) },
    { label: 'Series', value: String(summary.totalSets) },
    { label: 'Repeticiones', value: String(summary.totalReps) },
    { label: 'Volumen', value: summary.volume > 0 ? formatVolume(summary.volume, summary.unit) : '–' },
    { label: 'Ejercicios', value: String(summary.exercises.length) },
    { label: 'Récords', value: String(summary.prs.length) },
  ]
}

/** Best set of an exercise for the card: heaviest weight (ties: more reps), else most reps/seconds. */
export function bestSetOf(ex: SessionSummary['exercises'][number]): SummarySet | null {
  let best: SummarySet | null = null
  const score = (s: SummarySet) => (s.weight ?? 0) * 1000 + (s.reps ?? 0) + (s.seconds ?? 0) / 1000
  for (const s of ex.sets) if (!best || score(s) > score(best)) best = s
  return best
}

export async function renderSummaryImage(summary: SessionSummary, extras: SummaryExtras = {}): Promise<Blob> {
  const W = CARD_WIDTH
  const H = CARD_HEIGHT
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas-unsupported')

  try {
    await Promise.all([
      document.fonts?.load(font(700, 40)),
      document.fonts?.load(font(500, 30)),
      document.fonts?.load(font(600, 30)),
    ])
  } catch {
    /* system font fallback */
  }

  const PAD = 72

  // background + aurora
  ctx.fillStyle = PAL.bg
  ctx.fillRect(0, 0, W, H)
  blob(ctx, 120, 80, 760, PAL.aurora1)
  blob(ctx, W - 40, 520, 700, PAL.aurora2)
  blob(ctx, 220, H - 80, 760, PAL.aurora3)

  // brand mark
  roundRect(ctx, PAD, PAD, 64, 64, 20)
  ctx.fillStyle = PAL.accent
  ctx.fill()
  ctx.fillStyle = PAL.onAccent
  // bolt glyph
  ctx.beginPath()
  ctx.moveTo(PAD + 36, PAD + 12)
  ctx.lineTo(PAD + 20, PAD + 36)
  ctx.lineTo(PAD + 31, PAD + 36)
  ctx.lineTo(PAD + 27, PAD + 52)
  ctx.lineTo(PAD + 45, PAD + 27)
  ctx.lineTo(PAD + 33, PAD + 27)
  ctx.closePath()
  ctx.fill()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.fillStyle = PAL.text
  ctx.font = font(700, 38)
  ctx.fillText('Gymfullness', PAD + 84, PAD + 44)

  // title block
  ctx.fillStyle = PAL.text2
  ctx.font = font(500, 32)
  ctx.fillText(fit(ctx, formatLongDate(summary.startedAt), W - PAD * 2), PAD, 236)
  ctx.fillStyle = PAL.text
  ctx.font = font(700, 84)
  ctx.fillText(fit(ctx, summary.name, W - PAD * 2), PAD, 330)

  // stat grid (3 × 2)
  const stats = cardStats(summary)
  const gx = PAD
  const gy = 380
  const gap = 20
  const cw = (W - PAD * 2 - gap * 2) / 3
  const ch = 150
  stats.forEach((st, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const x = gx + col * (cw + gap)
    const y = gy + row * (ch + gap)
    glassPanel(ctx, x, y, cw, ch, 36)
    const isPr = st.label === 'Récords' && summary.prs.length > 0
    ctx.fillStyle = isPr ? PAL.pr : PAL.text
    ctx.font = font(700, 56)
    ctx.fillText(fit(ctx, st.value, cw - 48), x + 28, y + 88)
    ctx.fillStyle = PAL.text2
    ctx.font = font(500, 26)
    ctx.fillText(st.label, x + 28, y + 128)
  })

  // top exercises
  const listY = gy + 2 * ch + gap + 60
  ctx.fillStyle = PAL.text3
  ctx.font = font(600, 26)
  ctx.fillText('EJERCICIOS', PAD, listY)

  const maxRows = 4
  const exs = [...summary.exercises]
    .sort((a, b) => Number(b.sets.some((s) => s.isPR)) - Number(a.sets.some((s) => s.isPR)) || b.volume - a.volume || b.sets.length - a.sets.length)
    .slice(0, maxRows)
  const rowH = 88
  const panelY = listY + 24
  const panelH = Math.max(1, exs.length) * rowH + 24
  glassPanel(ctx, PAD, panelY, W - PAD * 2, panelH, 40)
  exs.forEach((ex, i) => {
    const y = panelY + 12 + i * rowH
    const mid = y + rowH / 2
    if (i > 0) {
      ctx.fillStyle = PAL.glassBorder
      ctx.fillRect(PAD + 36, y, W - PAD * 2 - 72, 2)
    }
    const hasPr = ex.sets.some((s) => s.isPR)
    const best = bestSetOf(ex)
    const right = best ? formatSummarySet(best, summary.unit) : ''
    ctx.textAlign = 'right'
    ctx.fillStyle = hasPr ? PAL.pr : PAL.text
    ctx.font = font(700, 36)
    ctx.fillText(right, W - PAD - 36, mid + 12)
    const rightW = ctx.measureText(right).width
    ctx.textAlign = 'left'
    ctx.fillStyle = PAL.text
    ctx.font = font(600, 36)
    const nameMax = W - PAD * 2 - 72 - rightW - 24
    ctx.fillText(fit(ctx, ex.name, nameMax), PAD + 36, mid - 2)
    ctx.fillStyle = PAL.text3
    ctx.font = font(500, 24)
    ctx.fillText(`${ex.sets.length} ${ex.sets.length === 1 ? 'serie' : 'series'}${hasPr ? ' · récord' : ''}`, PAD + 36, mid + 30)
  })
  if (summary.exercises.length > maxRows) {
    ctx.fillStyle = PAL.text3
    ctx.font = font(500, 26)
    ctx.fillText(`+ ${summary.exercises.length - maxRows} más`, PAD + 8, panelY + panelH + 42)
  }

  // feeling pill
  if (extras.feeling) {
    ctx.font = font(600, 28)
    const label = `Sensación: ${FEELING_LABEL[extras.feeling]}`
    const w = ctx.measureText(label).width + 56
    roundRect(ctx, PAD, H - 130, w, 60, 30)
    ctx.fillStyle = 'rgba(200, 245, 96, 0.16)'
    ctx.fill()
    ctx.fillStyle = PAL.accent
    ctx.fillText(label, PAD + 28, H - 90)
  }

  // footer
  ctx.textAlign = 'right'
  ctx.fillStyle = PAL.text3
  ctx.font = font(500, 26)
  ctx.fillText('Entrena sin pensar', W - PAD, H - 90)
  ctx.textAlign = 'left'

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('png-failed'))), 'image/png')
  })
}

/* ------------------------------------------------------------------ */
/* Download + share                                                    */
/* ------------------------------------------------------------------ */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

/** Web Share with the PNG when the browser can share files, otherwise download it. */
export async function shareSummary(summary: SessionSummary, image: Blob): Promise<ShareResult> {
  const filename = exportFileName(summary, 'png')
  const file = new File([image], filename, { type: 'image/png' })
  const nav = typeof navigator !== 'undefined' ? navigator : undefined
  if (nav?.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({
        files: [file],
        title: `${summary.name} · Gymfullness`,
        text: `${summary.name}: ${summary.totalSets} series, ${formatDuration(summary.durationSec)}`,
      })
      return 'shared'
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'
      // fall through to download
    }
  }
  downloadBlob(image, filename)
  return 'downloaded'
}

/** Copy to clipboard with a legacy fallback. Resolves false on failure. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    ta.remove()
    return ok
  } catch {
    return false
  }
}
