/** Local 'YYYY-MM-DD'. */
export function toDateKey(ts: number | Date = Date.now()): string {
  const d = ts instanceof Date ? ts : new Date(ts)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** 75 → '1:15', 3725 → '1:02:05'. */
export function formatClock(totalSec: number): string {
  const s = Math.max(0, Math.round(totalSec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return h > 0 ? `${h}:${mm}:${String(sec).padStart(2, '0')}` : `${mm}:${String(sec).padStart(2, '0')}`
}

/** 3725 → '1 h 2 min', 300 → '5 min'. */
export function formatDuration(totalSec: number): string {
  const min = Math.round(totalSec / 60)
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h} h ${m} min` : `${h} h`
}

const DAY_MS = 86_400_000

/** 'Hoy', 'Ayer', 'Hace 3 días', 'lun 4 nov'. */
export function formatRelativeDay(ts: number, now = Date.now()): string {
  const a = fromDateKey(toDateKey(ts)).getTime()
  const b = fromDateKey(toDateKey(now)).getTime()
  const diff = Math.round((b - a) / DAY_MS)
  if (diff === 0) return 'Hoy'
  if (diff === 1) return 'Ayer'
  if (diff > 1 && diff < 7) return `Hace ${diff} días`
  return new Date(ts).toLocaleDateString('es', { weekday: 'short', day: 'numeric', month: 'short' })
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('es', { weekday: 'long', day: 'numeric', month: 'long' })
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 12) return 'Buenos días'
  if (h < 19) return 'Buenas tardes'
  return 'Buenas noches'
}
