import type { ReactNode } from 'react'

export function ProgressRing({
  value,
  size = 240,
  stroke = 12,
  color = 'var(--accent)',
  children,
}: {
  value: number // 0..1
  size?: number
  stroke?: number
  color?: string
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.min(1, Math.max(0, value))
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ring__track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        <circle
          className="ring__bar"
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
        />
      </svg>
      <div className="ring__center">{children}</div>
    </div>
  )
}

export function ProgressBar({ value, color }: { value: number; color?: string }) {
  return (
    <div className="pbar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)}>
      <span style={{ width: `${Math.min(100, Math.max(0, value * 100))}%`, background: color }} />
    </div>
  )
}
