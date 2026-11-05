import { formatNum } from './scale'
import './charts.css'

export interface HBarListProps {
  items: { label: string; value: number; target?: number; color?: string }[]
  formatValue?: (v: number) => string
  ariaLabel: string
}

/** Labelled horizontal bars on one shared scale, with an optional target tick per row. */
export function HBarList({ items, formatValue, ariaLabel }: HBarListProps) {
  const fv = formatValue ?? formatNum
  const scale = Math.max(1e-9, ...items.map((i) => Math.max(i.value, i.target ?? 0)))
  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / scale) * 100))}%`

  return (
    <ul className="ch-hbars" aria-label={ariaLabel}>
      {items.map((it, i) => (
        <li key={it.label} className="ch-hbar">
          <span className="ch-hbar__label truncate">{it.label}</span>
          <span className="ch-hbar__track" aria-hidden="true">
            <span
              className="ch-hbar__fill"
              style={{ width: pct(it.value), background: it.color ?? 'var(--accent)', animationDelay: `${i * 30}ms` }}
            />
            {it.target !== undefined && <span className="ch-hbar__target" style={{ left: pct(it.target) }} />}
          </span>
          <span className="ch-hbar__value num">
            {fv(it.value)}
            {it.target !== undefined && <span className="ch-hbar__of">/{fv(it.target)}</span>}
          </span>
        </li>
      ))}
    </ul>
  )
}
