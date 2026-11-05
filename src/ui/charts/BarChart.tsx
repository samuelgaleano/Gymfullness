export interface BarChartProps {
  data: { label: string; value: number; highlight?: boolean }[]
  height?: number // default 140
  color?: string
  formatValue?: (v: number) => string
  ariaLabel: string
}
export function BarChart(_p: BarChartProps) {
  return null
}
