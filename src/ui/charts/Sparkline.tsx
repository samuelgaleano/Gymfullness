import { useId, useMemo } from 'react'
import { areaPath, linePath, linearScale } from './scale'
import './charts.css'

export interface SparklineProps {
  values: number[]
  width?: number // default 80
  height?: number // default 28
  color?: string
  ariaLabel?: string
}

const PAD = 3

export function Sparkline({ values, width = 80, height = 28, color = 'var(--accent)', ariaLabel }: SparklineProps) {
  const gid = useId().replace(/:/g, '')
  const clean = useMemo(() => values.filter((v) => Number.isFinite(v)), [values])
  const a11y = ariaLabel ? { role: 'img' as const, 'aria-label': ariaLabel } : { 'aria-hidden': true as const }

  const shape = useMemo(() => {
    if (clean.length < 2) return null
    const min = Math.min(...clean)
    const max = Math.max(...clean)
    const sx = linearScale(0, clean.length - 1, PAD, width - PAD)
    const sy = linearScale(min, max, height - PAD, PAD)
    const pts = clean.map((v, i) => ({ x: sx(i), y: sy(v) }))
    return { pts, line: linePath(pts), fill: areaPath(pts, height) }
  }, [clean, width, height])

  if (!shape) {
    // 0–1 values: a flat baseline (and a dot for the single value) — never an empty gap.
    return (
      <svg className="ch-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...a11y}>
        <line x1={PAD} x2={width - PAD} y1={height / 2} y2={height / 2} stroke={color} strokeOpacity={0.25} strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round" />
        {clean.length === 1 && <circle cx={width - PAD - 1.5} cy={height / 2} r={3} fill={color} />}
      </svg>
    )
  }
  const last = shape.pts[shape.pts.length - 1]
  return (
    <svg className="ch-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} {...a11y}>
      <defs>
        <linearGradient id={`sg${gid}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.28" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={shape.fill} fill={`url(#sg${gid})`} />
      <path d={shape.line} fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={last.x} cy={last.y} r={2.6} fill={color} />
    </svg>
  )
}
