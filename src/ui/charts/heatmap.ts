/** Pure grid math for the calendar heatmap (Monday-first columns of weeks). */
import { fromDateKey, toDateKey } from '@/lib/date'

export interface HeatCell {
  key: string
  col: number
  row: number // 0 = Monday … 6 = Sunday
  future: boolean
}

/** Cells for `weeks` columns ending with the week that contains `endKey`. */
export function heatmapGrid(endKey: string, weeks: number): HeatCell[] {
  const end = fromDateKey(endKey)
  const offset = (end.getDay() + 6) % 7
  const lastMonday = new Date(end.getFullYear(), end.getMonth(), end.getDate() - offset)
  const cells: HeatCell[] = []
  for (let col = 0; col < weeks; col++) {
    for (let row = 0; row < 7; row++) {
      const d = new Date(lastMonday.getFullYear(), lastMonday.getMonth(), lastMonday.getDate() - (weeks - 1 - col) * 7 + row)
      const key = toDateKey(d)
      cells.push({ key, col, row, future: key > endKey })
    }
  }
  return cells
}

/** 0 for no activity, otherwise 1..4 relative to the busiest day. */
export function intensityLevel(value: number, max: number): 0 | 1 | 2 | 3 | 4 {
  if (!(value > 0)) return 0
  const m = Math.max(1, max)
  return Math.min(4, Math.max(1, Math.ceil((value / m) * 4))) as 1 | 2 | 3 | 4
}

/** Column index → short month label when a new month starts there (never two close together). */
export function monthLabels(cells: HeatCell[], months: string[]): Map<number, string> {
  const out = new Map<number, string>()
  let prevMonth = -1
  let lastCol = -10
  for (const c of cells.filter((x) => x.row === 0)) {
    const d = fromDateKey(c.key)
    const month = d.getMonth()
    const isFirst = c.col === 0
    if (month !== prevMonth && (!isFirst || d.getDate() <= 21) && c.col - lastCol >= 3) {
      out.set(c.col, months[month])
      lastCol = c.col
    }
    prevMonth = month
  }
  return out
}
