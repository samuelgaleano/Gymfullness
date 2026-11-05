import { useEffect, type RefObject } from 'react'

/** Floating value bubble, positioned in the chart container's pixel space. */
export function ChartTip({
  x,
  y,
  width,
  title,
  subtitle,
  below,
}: {
  x: number
  y: number
  width: number
  title: string
  subtitle?: string
  /** Render under the anchor instead of above. */
  below?: boolean
}) {
  const left = Math.min(Math.max(x, 52), Math.max(52, width - 52))
  return (
    <div
      className={`ch-tip glass ${below ? 'ch-tip--below' : ''}`}
      style={{ left, top: y }}
      aria-hidden="true"
    >
      <div className="ch-tip__value num">{title}</div>
      {subtitle && <div className="ch-tip__sub">{subtitle}</div>}
    </div>
  )
}

/** Visually-hidden data summary for screen readers. */
export function ChartTable({ caption, rows }: { caption: string; rows: [string, string][] }) {
  return (
    <div className="sr-only">
    <table>
      <caption>{caption}</caption>
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <th scope="row">{k}</th>
            <td>{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  )
}

/** Clears a selection when the user presses anywhere outside the chart. */
export function useDismissOutside(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!active) return
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss()
    }
    document.addEventListener('pointerdown', handler)
    return () => document.removeEventListener('pointerdown', handler)
  }, [ref, active, onDismiss])
}
