import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { ChevronRight, History, Trophy } from 'lucide-react'
import { Button, Chip, EmptyState } from '@/ui'
import { getExercise } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'
import { summarizeSession } from '@/lib/stats'
import { formatDuration } from '@/lib/date'
import { formatVolumeEs } from './progressLogic'
import { groupByMonth } from './progressLogic'

const PAGE = 40
const WEEKDAY = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb']

export function HistoryTab({ sessions }: { sessions: WorkoutSession[] }) {
  const [, navigate] = useLocation()
  const [limit, setLimit] = useState(PAGE)

  const items = useMemo(
    () =>
      sessions
        .slice()
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, limit)
        .map((s) => ({ session: s, startedAt: s.startedAt, summary: summarizeSession(s, getExercise) })),
    [sessions, limit],
  )
  const groups = useMemo(() => groupByMonth(items), [items])

  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={<History size={30} />}
        title="Todavía no hay entrenos"
        text="Cada sesión que termines se guardará aquí, lista para revisar."
        action={
          <Button variant="primary" size="lg" onClick={() => navigate('/')}>
            Empezar entreno
          </Button>
        }
      />
    )
  }

  return (
    <div className="stack-lg">
      {groups.map((g) => (
        <section key={g.key} className="stack" aria-label={g.label}>
          <div className="row-between">
            <h2 className="section-title">{g.label}</h2>
            <span className="pg-note">
              {g.items.length} {g.items.length === 1 ? 'entreno' : 'entrenos'}
            </span>
          </div>
          <div className="list glass">
            {g.items.map(({ session, summary }) => {
              const d = new Date(session.startedAt)
              const prs = summary.prs.length
              return (
                <button
                  key={session.id}
                  type="button"
                  className="list-row pg-hist"
                  onClick={() => navigate(`/history/${session.id}`)}
                  aria-label={`${session.name}, ${d.getDate()} de ${d.toLocaleDateString('es', { month: 'long' })}`}
                >
                  <div className="pg-hist__date" aria-hidden="true">
                    <span className="pg-hist__day num">{d.getDate()}</span>
                    <span className="pg-hist__wd">{WEEKDAY[d.getDay()]}</span>
                  </div>
                  <div className="grow">
                    <div className="list-row__title pg-wrap">{session.name}</div>
                    <div className="list-row__sub">
                      {formatDuration(summary.durationSec)} · {summary.totalSets} series · {formatVolumeEs(summary.volume, summary.unit)}
                    </div>
                  </div>
                  {prs > 0 && (
                    <Chip tone="pr" icon={<Trophy size={13} />}>
                      {prs}
                    </Chip>
                  )}
                  <ChevronRight size={18} className="pg-hist__chev" aria-hidden="true" />
                </button>
              )
            })}
          </div>
        </section>
      ))}
      {sessions.length > limit && (
        <Button variant="glass" block onClick={() => setLimit((n) => n + PAGE)}>
          Ver entrenos anteriores
        </Button>
      )}
    </div>
  )
}
