import type { Unit } from './types'

export const LB_PER_KG = 2.2046226218

export function convertWeight(value: number, from: Unit, to: Unit): number {
  if (from === to) return value
  return from === 'kg' ? value * LB_PER_KG : value / LB_PER_KG
}

/** Round to a sensible gym increment: 0.5 kg / 1 lb. */
export function roundWeight(value: number, unit: Unit): number {
  const step = unit === 'kg' ? 0.5 : 1
  return Math.round(value / step) * step
}

/** '80', '82.5', '–' — never trailing zeros. */
export function formatWeight(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  return Number.isInteger(value) ? String(value) : value.toFixed(value * 10 === Math.round(value * 10) ? 1 : 2)
}

/** Volume like '12.4 t' or '840 kg'. */
export function formatVolume(value: number, unit: Unit): string {
  if (unit === 'kg' && value >= 10000) return `${(value / 1000).toFixed(1)} t`
  return `${Math.round(value).toLocaleString('es')} ${unit}`
}
