export interface HeatmapCalendarProps {
  /** dateKey 'YYYY-MM-DD' → intensity (e.g. sessions or sets that day). */
  values: Record<string, number>
  weeks?: number // default 12, columns = weeks (Mon..Sun rows)
  endDate?: string // default today
  ariaLabel: string
}
export function HeatmapCalendar(_p: HeatmapCalendarProps) {
  return null
}
