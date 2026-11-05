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
export function LineChart(_p: LineChartProps) {
  return null
}
