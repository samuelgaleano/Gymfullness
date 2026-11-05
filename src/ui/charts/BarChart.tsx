import { useCallback, useMemo, useState } from 'react'
import { formatNum, labelIndices, linearScale, niceTicks, roundedTopRect, summarize, textWidth } from './scale'
import { useElementWidth } from './useElementWidth'
import { ChartTable, ChartTip, useDismissOutside } from './parts'
import './charts.css'

export interface BarChartProps {
  data: { label: string; value: number; highlight?: boolean }[]
  height?: number // default 140
  color?: string
  formatValue?: (v: number) => string
  /** Compact formatter for the y-axis labels (defaults to formatValue). */
  formatAxis?: (v: number) => string
  ariaLabel: string
}

const MT = 10
const MB = 22
const MR = 4

export function BarChart({ data, height = 140, color = 'var(--accent)', formatValue, formatAxis, ariaLabel }: BarChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const [sel, setSel] = useState<number | null>(null)
  const dismiss = useCallback(() => setSel(null), [])
  useDismissOutside(wrapRef, sel !== null, dismiss)

  const fv = formatValue ?? formatNum
  const fa = formatAxis ?? fv
  const n = data.length

  const g = useMemo(() => {
    const max = Math.max(0, ...data.map((d) => d.value))
    const yt = niceTicks(0, max > 0 ? max : 1, 3, 4)
    const ml = Math.max(26, Math.ceil(Math.max(...yt.ticks.map((t) => textWidth(fa(t), 6.2))) + 10))
    const sy = linearScale(yt.min, yt.max, height - MB, MT)
    const slot = n ? (width - ml - MR) / n : 0
    const barW = Math.max(4, Math.min(slot * 0.62, 30))
    const longest = Math.max(1, ...data.map((d) => d.label.length))
    const labels = labelIndices(n, slot, textWidth('x'.repeat(longest), 5.6))
    return { yt, ml, sy, slot, barW, labels }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, width, height, n, formatAxis, formatValue])

  const summary = summarize(data.map((d) => d.value))

  if (!n || !summary || summary.max <= 0) {
    return (
      <div className="ch-wrap ch-empty" style={{ height }} ref={wrapRef}>
        <p className="ch-empty__text">Registra más entrenos para ver la tendencia</p>
        <ChartTable caption={ariaLabel} rows={[['Registros', '0']]} />
      </div>
    )
  }

  const { yt, ml, sy, slot, barW, labels } = g
  const base = height - MB
  const pick = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return
    const x = clientX - el.getBoundingClientRect().left - ml
    setSel(Math.min(n - 1, Math.max(0, Math.floor(x / slot))))
  }
  const s = sel !== null && sel < n ? sel : null
  const sx = (i: number) => ml + slot * i + slot / 2
  const selTop = s !== null ? sy(data[s].value) : 0

  return (
    <div
      ref={wrapRef}
      className="ch-wrap"
      style={{ height }}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => (e.pointerType === 'mouse' || e.buttons ? pick(e.clientX) : undefined)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
    >
      <svg className="ch-svg" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {yt.ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={ml} x2={width - MR} y1={sy(t)} y2={sy(t)} />
            <text className="ch-axis" x={ml - 6} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {fa(t)}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const top = sy(d.value)
          const h = Math.max(d.value > 0 ? 2 : 0, base - top)
          const active = s === i
          const strong = d.highlight || active
          return d.value > 0 ? (
            <path
              key={i}
              className="ch-bar"
              d={roundedTopRect(sx(i) - barW / 2, base - h, barW, h, Math.min(6, barW / 2))}
              fill={color}
              opacity={strong ? 1 : 0.42}
              style={{ animationDelay: `${i * 28}ms` }}
            />
          ) : (
            <rect key={i} x={sx(i) - barW / 2} y={base - 2} width={barW} height={2} rx={1} fill={color} opacity={0.16} />
          )
        })}
        {data.map((d, i) =>
          labels.includes(i) ? (
            <text key={i} className={`ch-axis ${d.highlight ? 'ch-axis--hi' : ''}`} x={sx(i)} y={height - 6} textAnchor="middle">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      {s !== null && <ChartTip x={sx(s)} y={Math.max(selTop - 8, 40)} width={width} title={fv(data[s].value)} subtitle={data[s].label} />}
      <ChartTable
        caption={ariaLabel}
        rows={data.map((d) => [d.label, fv(d.value)] as [string, string])}
      />
    </div>
  )
}
