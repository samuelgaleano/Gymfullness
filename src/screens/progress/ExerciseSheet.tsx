import { useEffect, useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { Trophy } from 'lucide-react'
import { Button, Chip, Segmented, Sheet } from '@/ui'
import { LineChart } from '@/ui/charts'
import { getExercise, useApp } from '@/store/app'
import type { WorkoutSession } from '@/lib/types'
import { personalRecords } from '@/lib/stats'
import { formatRelativeDay } from '@/lib/date'
import { formatVolumeEs, formatWeightEs } from './progressLogic'
import { exerciseSeries, formatMetric, METRIC_LABEL, metricsFor, recentLines, type ExMetric } from './progressLogic'

/** Detail sheet for one trained exercise: trend, PRs and last sessions. */
export function ExerciseSheet({ exerciseId, sessions, onClose }: { exerciseId: string | null; sessions: WorkoutSession[]; onClose: () => void }) {
  if (!exerciseId) return null
  return <Body key={exerciseId} exerciseId={exerciseId} sessions={sessions} onClose={onClose} />
}

function Body({ exerciseId, sessions, onClose }: { exerciseId: string; sessions: WorkoutSession[]; onClose: () => void }) {
  const [, navigate] = useLocation()
  const unit = useApp((s) => s.settings.unit)
  const ex = getExercise(exerciseId)
  const kind = ex?.kind ?? 'weight_reps'
  const metrics = metricsFor(kind)

  const hasE1rm = useMemo(() => exerciseSeries(sessions, exerciseId, 'e1rm', unit).length > 0, [sessions, exerciseId, unit])
  const available = useMemo<ExMetric[]>(() => (kind === 'weight_reps' && !hasE1rm ? ['reps'] : metrics), [kind, hasE1rm, metrics])
  const [metric, setMetric] = useState<ExMetric>(available[0])
  useEffect(() => {
    if (!available.includes(metric)) setMetric(available[0])
  }, [available, metric])

  const data = useMemo(() => exerciseSeries(sessions, exerciseId, metric, unit), [sessions, exerciseId, metric, unit])
  const record = useMemo(() => personalRecords(sessions, unit).find((r) => r.exerciseId === exerciseId), [sessions, exerciseId, unit])
  const lines = useMemo(() => recentLines(sessions, exerciseId, unit), [sessions, exerciseId, unit])
  const last = data.length ? data[data.length - 1].y : null
  const name = ex?.name ?? exerciseId

  return (
    <Sheet open onClose={onClose} title={name}>
      <div className="stack-lg pg-exsheet">
        <div className="stack">
          {available.length > 1 && (
            <Segmented value={metric} options={available.map((m) => ({ value: m, label: METRIC_LABEL[m] }))} onChange={setMetric} label="Métrica del ejercicio" />
          )}
          <div className="pg-exsheet__head">
            <div>
              <div className="pg-exsheet__big num">{last !== null ? formatMetric(metric, last, unit) : '–'}</div>
              <div className="pg-note">Última sesión · {METRIC_LABEL[metric]}</div>
            </div>
          </div>
          <LineChart
            data={data}
            height={170}
            color={metric === 'e1rm' ? 'var(--pr)' : 'var(--accent)'}
            formatY={(y) => formatMetric(metric, Math.round(y * 10) / 10, unit)}
            ariaLabel={`${METRIC_LABEL[metric]} de ${name} por sesión`}
          />
        </div>

        {record && (
          <div className="pg-badges" aria-label="Récords personales">
            {record.bestE1rm !== null && (
              <Chip tone="pr" icon={<Trophy size={13} />}>
                e1RM {formatWeightEs(record.bestE1rm)} {unit}
              </Chip>
            )}
            {record.bestWeight !== null && <Chip tone="pr">Peso máx. {formatWeightEs(record.bestWeight)} {unit}</Chip>}
            {record.bestReps !== null && <Chip tone="pr">Reps máx {record.bestReps}</Chip>}
          </div>
        )}

        {lines.length > 0 && (
          <section className="stack" aria-label="Últimas sesiones">
            <h3 className="section-title">Últimas sesiones</h3>
            <table className="pg-table">
              <thead>
                <tr>
                  <th scope="col">Día</th>
                  <th scope="col">Mejor serie</th>
                  <th scope="col">Series</th>
                  <th scope="col">Volumen</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.sessionId}>
                    <td>{formatRelativeDay(l.date)}</td>
                    <td className="num">{l.best}</td>
                    <td className="num">{l.sets}</td>
                    <td className="num">{l.volume > 0 ? formatVolumeEs(l.volume, unit) : '–'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {ex && (
          <Button
            variant="glass"
            block
            onClick={() => {
              onClose()
              navigate(`/exercises/${exerciseId}`)
            }}
          >
            Ver técnica y detalles
          </Button>
        )}
      </div>
    </Sheet>
  )
}
