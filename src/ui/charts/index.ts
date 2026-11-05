/**
 * Hand-written SVG charts. SHARED CONTRACT: owned by the progress-ui agent; used by Progress,
 * Exercise detail and Home. Props are fixed; implementations are STUBS until replaced.
 * All charts: width = 100% of the container (responsive), colors via CSS tokens, accessible
 * (role="img" + aria-label), tap/hover shows the value, no external libraries.
 */
export { LineChart, type LineChartProps } from './LineChart'
export { BarChart, type BarChartProps } from './BarChart'
export { Sparkline, type SparklineProps } from './Sparkline'
export { HeatmapCalendar, type HeatmapCalendarProps } from './HeatmapCalendar'
export { HBarList, type HBarListProps } from './HBarList'
