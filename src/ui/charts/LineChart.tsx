import { useCallback, useId, useMemo, useState } from 'react'
import { areaPath, defaultXFormat, downsample, formatNum, linePath, linearScale, nearestIndex, niceTicks, summarize, textWidth, timeTicks } from './scale'
import { useElementWidth } from './useElementWidth'
import { ChartTable, ChartTip, useDismissOutside } from './parts'
import './charts.css'

export interface LineChartProps {
  data: { x: number; y: number; label?: string }[] // x = timestamp (ms), sorted ascending
  height?: number // px, default 180
  color?: string // CSS color/var, default var(--accent)
  formatY?: (y: number) => string
  formatX?: (x: number) => string
  /** Fill the area under the line with a soft gradient. Default true. */
  area?: boolean
  ariaLabel: string
}

const MAX_POINTS = 160
const MT = 14
const MB = 24
const MR = 12

export function LineChart({ data, height = 180, color = 'var(--accent)', formatY, formatX, area = true, ariaLabel }: LineChartProps) {
  const [wrapRef, width] = useElementWidth<HTMLDivElement>()
  const gid = useId().replace(/:/g, '')
  const [sel, setSel] = useState<number | null>(null)
  const dismiss = useCallback(() => setSel(null), [])
  useDismissOutside(wrapRef, sel !== null, dismiss)

  const fy = formatY ?? formatNum
  const clean = useMemo(() => data.filter((d) => Number.isFinite(d.x) && Number.isFinite(d.y)), [data])
  const pts = useMemo(() => downsample(clean, MAX_POINTS), [clean])

  const geom = useMemo(() => {
    if (pts.length < 2) return null
    const ys = pts.map((p) => p.y)
    const yt = niceTicks(Math.min(...ys), Math.max(...ys), 4)
    const ml = Math.max(30, Math.ceil(Math.max(...yt.ticks.map((t) => textWidth(fy(t), 6.4))) + 12))
    const x0 = pts[0].x
    const x1 = pts[pts.length - 1].x
    const sx = linearScale(x0, x1, ml, width - MR)
    const sy = linearScale(yt.min, yt.max, height - MB, MT)
    const xy = pts.map((p) => ({ x: sx(p.x), y: sy(p.y) }))
    const xf = formatX ?? defaultXFormat(x1 - x0)
    const xTicks = timeTicks(x0, x1, width < 300 ? 3 : 4, xf)
    return { yt, ml, sx, sy, xy, xf, xTicks, x0, x1 }
  }, [pts, width, height, formatX, formatY])

  const sig = `${pts.length}:${pts[0]?.x}:${pts[pts.length - 1]?.x}:${pts.reduce((a, p) => a + p.y, 0).toFixed(2)}`
  const summary = summarize(clean.map((d) => d.y))
  const xfAll = geom?.xf ?? formatX ?? formatShort

  const table = summary ? (
    <ChartTable
      caption={ariaLabel}
      rows={[
        ['Registros', String(summary.count)],
        ['Primero', fy(summary.first)],
        ['Último', fy(summary.last)],
        ['Mínimo', fy(summary.min)],
        ['Máximo', fy(summary.max)],
      ]}
    />
  ) : null

  // Empty / single-point states keep the same box so nothing jumps when data arrives.
  if (!geom) {
    const one = pts[0]
    return (
      <div className="ch-wrap ch-empty" style={{ height }} ref={wrapRef}>
        {one ? (
          <>
            <div className="ch-empty__dot" style={{ color }} role="img" aria-label={`${ariaLabel}: ${fy(one.y)}`}>
              <span className="ch-empty__value num">{fy(one.y)}</span>
              <span className="ch-empty__pt" />
            </div>
            <p className="ch-empty__text">Registra más entrenos para ver la tendencia</p>
          </>
        ) : (
          <p className="ch-empty__text">Sin datos todavía</p>
        )}
        {table}
      </div>
    )
  }

  const { yt, ml, xy, xTicks, sx, sy } = geom
  const plotBottom = height - MB
  const xyPts = xy
  const line = linePath(xyPts)
  const fill = areaPath(xyPts, plotBottom)
  const last = xyPts[xyPts.length - 1]
  const showDots = pts.length <= 28

  const pick = (clientX: number) => {
    const el = wrapRef.current
    if (!el) return
    const left = el.getBoundingClientRect().left
    const i = nearestIndex(xyPts.map((p) => p.x), clientX - left)
    setSel(i)
  }

  const s = sel !== null && sel < pts.length ? sel : null
  const sp = s !== null ? xyPts[s] : null

  return (
    <div
      ref={wrapRef}
      className="ch-wrap"
      style={{ height }}
      onPointerDown={(e) => pick(e.clientX)}
      onPointerMove={(e) => (e.pointerType === 'mouse' ? pick(e.clientX) : e.buttons ? pick(e.clientX) : undefined)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
    >
      <svg className="ch-svg" width="100%" height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={`lg${gid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.34" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yt.ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={ml} x2={width - MR} y1={sy(t)} y2={sy(t)} />
            <text className="ch-axis" x={ml - 8} y={sy(t)} textAnchor="end" dominantBaseline="middle">
              {fy(t)}
            </text>
          </g>
        ))}
        {xTicks.map((t, i) => (
          <text
            key={t}
            className="ch-axis"
            x={sx(t)}
            y={height - 6}
            textAnchor={i === 0 && xTicks.length > 1 ? 'start' : i === xTicks.length - 1 && xTicks.length > 1 ? 'end' : 'middle'}
          >
            {xfAll(t)}
          </text>
        ))}
        <g key={sig}>
          {area && <path className="ch-area" d={fill} fill={`url(#lg${gid})`} />}
          <path className="ch-line" d={line} pathLength={1} stroke={color} fill="none" />
          {showDots &&
            xyPts.map((p, i) => (
              <circle key={i} className="ch-dot" cx={p.x} cy={p.y} r={2.5} fill={color} />
            ))}
          <circle className="ch-last-ring" cx={last.x} cy={last.y} r={7} fill={color} />
          <circle className="ch-last" cx={last.x} cy={last.y} r={4.2} fill={color} />
        </g>
        {sp && (
          <g pointerEvents="none">
            <line className="ch-cross" x1={sp.x} x2={sp.x} y1={MT - 4} y2={plotBottom} />
            <circle cx={sp.x} cy={sp.y} r={9} fill={color} opacity={0.22} />
            <circle className="ch-sel" cx={sp.x} cy={sp.y} r={5} fill={color} />
          </g>
        )}
      </svg>
      {sp && s !== null && (
        <ChartTip
          x={sp.x}
          y={sp.y < 56 ? sp.y + 14 : sp.y - 14}
          width={width}
          below={sp.y < 56}
          title={fy(pts[s].y)}
          subtitle={pts[s].label ?? xfAll(pts[s].x)}
        />
      )}
      {table}
    </div>
  )
}

function formatShort(ts: number): string {
  return defaultXFormat(0)(ts)
}
