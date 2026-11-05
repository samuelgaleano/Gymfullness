import { useCallback, useMemo, useRef, useState } from 'react'
import { fromDateKey, toDateKey } from '@/lib/date'
import { heatmapGrid, intensityLevel, monthLabels } from './heatmap'
import { ChartTable, ChartTip, useDismissOutside } from './parts'
import './charts.css'

export interface HeatmapCalendarProps {
  /** dateKey 'YYYY-MM-DD' → intensity (e.g. sessions or sets that day). */
  values: Record<string, number>
  weeks?: number // default 12, columns = weeks (Mon..Sun rows)
  endDate?: string // default today
  /** Text for a day's value in the tooltip (default: the plain number). */
  formatValue?: (v: number) => string
  ariaLabel: string
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
const ROW_LABELS: Record<number, string> = { 0: 'L', 2: 'X', 4: 'V' }
const CELL = 20
const GAP = 4
const PITCH = CELL + GAP
const LEFT = 16
const TOP = 16
const LEVEL_OPACITY = [0, 0.32, 0.55, 0.78, 1]

export function HeatmapCalendar({ values, weeks = 12, endDate, formatValue, ariaLabel }: HeatmapCalendarProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [sel, setSel] = useState<number | null>(null)
  const dismiss = useCallback(() => setSel(null), [])
  useDismissOutside(wrapRef, sel !== null, dismiss)

  const endKey = endDate ?? toDateKey()
  const cells = useMemo(() => heatmapGrid(endKey, weeks), [endKey, weeks])
  const months = useMemo(() => monthLabels(cells, MONTHS), [cells])
  const max = useMemo(() => Math.max(0, ...cells.filter((c) => !c.future).map((c) => values[c.key] ?? 0)), [cells, values])
  const active = cells.filter((c) => !c.future && (values[c.key] ?? 0) > 0)

  const W = LEFT + weeks * PITCH - GAP
  const H = TOP + 7 * PITCH - GAP
  const fv = formatValue ?? ((v: number) => String(v))

  const pickFrom = (target: EventTarget) => {
    const idx = (target as SVGElement).dataset?.i
    if (idx !== undefined) setSel(Number(idx))
  }
  const s = sel !== null ? cells[sel] : null
  const scale = (wrapRef.current?.clientWidth ?? W) / W

  return (
    <div ref={wrapRef} className="ch-wrap ch-heat">
      <svg
        className="ch-heat__svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onPointerDown={(e) => pickFrom(e.target)}
        onPointerOver={(e) => e.pointerType === 'mouse' && pickFrom(e.target)}
        onPointerLeave={(e) => e.pointerType === 'mouse' && setSel(null)}
      >
        {[...months].map(([col, label]) => (
          <text key={col} className="ch-axis" x={LEFT + col * PITCH} y={9} textAnchor="start">
            {label}
          </text>
        ))}
        {Object.entries(ROW_LABELS).map(([row, label]) => (
          <text key={row} className="ch-axis" x={0} y={TOP + Number(row) * PITCH + CELL / 2} dominantBaseline="middle">
            {label}
          </text>
        ))}
        {cells.map((c, i) => {
          if (c.future) return null
          const v = values[c.key] ?? 0
          const level = intensityLevel(v, max)
          const isToday = c.key === endKey
          return (
            <rect
              key={c.key}
              data-i={i}
              className={`ch-cell ${level ? 'ch-cell--on' : ''} ${isToday ? 'ch-cell--today' : ''}`}
              x={LEFT + c.col * PITCH}
              y={TOP + c.row * PITCH}
              width={CELL}
              height={CELL}
              rx={6}
              style={level ? { opacity: LEVEL_OPACITY[level] } : undefined}
            />
          )
        })}
      </svg>
      {s && (
        <ChartTip
          x={(LEFT + s.col * PITCH + CELL / 2) * scale}
          y={s.row < 2 ? (TOP + s.row * PITCH + CELL) * scale + 4 : (TOP + s.row * PITCH) * scale - 4}
          width={wrapRef.current?.clientWidth ?? W}
          below={s.row < 2}
          title={(values[s.key] ?? 0) > 0 ? fv(values[s.key]) : 'Descanso'}
          subtitle={`${WEEKDAYS[s.row]} ${fromDateKey(s.key).getDate()} ${MONTHS[fromDateKey(s.key).getMonth()]}`}
        />
      )}
      <div className="ch-heat__legend" aria-hidden="true">
        <span>Menos</span>
        {LEVEL_OPACITY.map((o, i) => (
          <i key={i} className={i ? 'ch-cell--on' : ''} style={i ? { opacity: o } : undefined} />
        ))}
        <span>Más</span>
      </div>
      <ChartTable
        caption={ariaLabel}
        rows={[
          ['Días activos', String(active.length)],
          ['Semanas', String(weeks)],
        ]}
      />
    </div>
  )
}
