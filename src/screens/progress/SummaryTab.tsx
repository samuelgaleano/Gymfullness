import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { BarChart3, Flame, Info, Trophy } from 'lucide-react'
import { Button, Card, EmptyState, List, ListRow, Segmented } from '@/ui'
import { BarChart, HBarList, HeatmapCalendar } from '@/ui/charts'
import { heatmapGrid } from '@/ui/charts/heatmap'
import { getExercise, useApp } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'
import { muscleSets, personalRecords, streak, weeklyStats } from '@/lib/stats'
import { formatRelativeDay, toDateKey } from '@/lib/date'
import { formatVolumeEs, formatWeightEs } from './progressLogic'
import {
  balanceInsight,
  compactNumber,
  muscleBalance,
  setsByDay,
  weekBars,
  type BalanceStatus,
  type WeekMetric,
} from './progressLogic'

const WEEKS = 12
const METRICS: { value: WeekMetric; label: string }[] = [
  { value: 'volume', label: 'Volumen' },
  { value: 'sessions', label: 'Sesiones' },
  { value: 'minutes', label: 'Minutos' },
]
const STATUS_COLOR: Record<BalanceStatus, string> = { under: 'var(--warning)', ok: 'var(--accent)', over: 'var(--rest)' }
const SHOWN_MUSCLES = 7

export function SummaryTab({ sessions, onOpenExercise }: { sessions: WorkoutSession[]; onOpenExercise: (id: string) => void }) {
  const [, navigate] = useLocation()
  const unit = useApp((s) => s.settings.unit)
  const goalDays = useApp((s) => s.profile.daysPerWeek ?? s.plan?.daysPerWeek ?? 0)
  const [metric, setMetric] = useState<WeekMetric>('volume')
  const [allMuscles, setAllMuscles] = useState(false)

  const weeks = useMemo(() => weeklyStats(sessions, WEEKS, unit), [sessions, unit])
  const st = useMemo(() => streak(sessions), [sessions])
  const heat = useMemo(() => setsByDay(sessions), [sessions])
  const balance = useMemo(() => muscleBalance(muscleSets(sessions, getExercise, 7)), [sessions])
  const prs = useMemo(() => personalRecords(sessions, unit).slice(0, 5), [sessions, unit])

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<BarChart3 size={30} />}
        title="Tu progreso empieza hoy"
        text="Completa tu primer entreno y aquí verás tu racha, tus récords y cómo se reparte tu trabajo."
        action={
          <Button variant="primary" size="lg" onClick={() => navigate('/')}>
            Empezar entreno
          </Button>
        }
      />
    )
  }

  const current = weeks[weeks.length - 1]
  const active = weeks.filter((w) => w.sessions > 0)
  const avg = active.length ? active.reduce((a, w) => a + w.sessions, 0) / active.length : 0
  const bars = weekBars(weeks, metric)
  const fmt =
    metric === 'volume'
      ? (v: number) => formatVolumeEs(v, unit)
      : metric === 'sessions'
        ? (v: number) => `${v} ${v === 1 ? 'entreno' : 'entrenos'}`
        : (v: number) => `${Math.round(v)} min`
  const firstKey = heatmapGrid(toDateKey(), WEEKS)[0].key
  const heatDays = Object.keys(heat).filter((k) => k >= firstKey).length
  const rows = allMuscles ? balance : balance.slice(0, SHOWN_MUSCLES)

  return (
    <div className="stack-lg">
      <Card pad="lg" className="pg-hero">
        <div className="pg-stats">
          <div className="pg-stat">
            <div className="pg-stat__value num">
              {st.weeks}
              <small> sem</small>
              {st.weeks > 0 && <Flame size={20} className="pg-stat__flame" aria-hidden="true" />}
            </div>
            <div className="pg-stat__label">Racha</div>
          </div>
          <div className="pg-stat">
            <div className="pg-stat__value num">
              {st.thisWeek}
              {goalDays > 0 && <small>/{goalDays}</small>}
            </div>
            <div className="pg-stat__label">Entrenos esta semana</div>
          </div>
          <div className="pg-stat">
            <div className="pg-stat__value num">{current.volume > 0 ? formatVolumeEs(current.volume, unit).replace(' ', ' ') : '–'}</div>
            <div className="pg-stat__label">Volumen semanal</div>
          </div>
        </div>
      </Card>

      <section className="stack" aria-label="Actividad por semana">
        <div className="row-between">
          <h2 className="section-title">Últimas {WEEKS} semanas</h2>
        </div>
        <Card pad="lg" className="stack">
          <Segmented value={metric} options={METRICS} onChange={setMetric} label="Métrica semanal" />
          <BarChart
            data={bars}
            height={156}
            formatValue={fmt}
            formatAxis={metric === 'volume' ? compactNumber : undefined}
            ariaLabel={`Gráfica de ${METRICS.find((m) => m.value === metric)?.label.toLowerCase()} por semana, últimas ${WEEKS} semanas`}
          />
          <p className="pg-note">
            {avg > 0 ? `Promedio de ${avg.toLocaleString('es', { maximumFractionDigits: 1 })} ${avg === 1 ? 'entreno' : 'entrenos'} por semana activa.` : 'Aún sin semanas activas.'}
          </p>
        </Card>
      </section>

      <section className="stack" aria-label="Constancia">
        <h2 className="section-title">Constancia</h2>
        <Card pad="lg" className="stack">
          <HeatmapCalendar
            values={heat}
            weeks={WEEKS}
            formatValue={(v) => `${v} ${v === 1 ? 'serie' : 'series'}`}
            ariaLabel={`Calendario de actividad: ${heatDays} días entrenados en las últimas ${WEEKS} semanas`}
          />
          <p className="pg-note">
            {heatDays} {heatDays === 1 ? 'día entrenado' : 'días entrenados'} en {WEEKS} semanas.
          </p>
        </Card>
      </section>

      <section className="stack" aria-label="Balance muscular">
        <h2 className="section-title">Balance muscular · 7 días</h2>
        <Card pad="lg" className="stack">
          <HBarList
            ariaLabel="Series por grupo muscular en los últimos 7 días frente a la meta semanal"
            items={rows.map((r) => ({ label: r.label, value: r.value, target: r.target, color: STATUS_COLOR[r.status] }))}
            formatValue={(v) => String(Math.floor(v * 10) / 10)}
          />
          {balance.length > SHOWN_MUSCLES && (
            <button type="button" className="pg-more" onClick={() => setAllMuscles((v) => !v)}>
              {allMuscles ? 'Ver menos' : 'Ver todos los músculos'}
            </button>
          )}
          <ul className="pg-legend" aria-label="Leyenda">
            <li>
              <i style={{ background: STATUS_COLOR.under }} />
              Por debajo
            </li>
            <li>
              <i style={{ background: STATUS_COLOR.ok }} />
              En meta
            </li>
            <li>
              <i style={{ background: STATUS_COLOR.over }} />
              Por encima
            </li>
            <li>
              <i className="pg-legend__tick" />
              Meta semanal
            </li>
          </ul>
          <p className="pg-insight">
            <Info size={16} aria-hidden="true" />
            <span>{balanceInsight(balance)}</span>
          </p>
        </Card>
      </section>

      <section className="stack" aria-label="Récords recientes">
        <h2 className="section-title">Récords recientes</h2>
        {prs.length === 0 ? (
          <Card className="pg-note">Tus récords aparecerán aquí en cuanto completes series con peso.</Card>
        ) : (
          <List>
            {prs.map((pr) => {
              const ex = getExercise(pr.exerciseId)
              const value = pr.bestE1rm !== null ? `${formatWeightEs(pr.bestE1rm)} ${unit}` : `${pr.bestReps ?? 0} reps`
              return (
                <ListRow
                  key={pr.exerciseId}
                  icon={<Trophy size={18} className="pg-pr-icon" />}
                  title={ex?.name ?? pr.exerciseId}
                  subtitle={`${formatRelativeDay(pr.date)}${pr.bestE1rm !== null ? ' · e1RM' : ''}`}
                  trailing={
                    <span className="pg-pr-value num">
                      {value}
                    </span>
                  }
                  chevron
                  onClick={() => onOpenExercise(pr.exerciseId)}
                />
              )
            })}
          </List>
        )}
      </section>
    </div>
  )
}
