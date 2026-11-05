import { useMemo, useState } from 'react'
import { ArrowDownRight, ArrowUpRight, Minus, Plus, Scale, Trash2 } from 'lucide-react'
import { Button, Card, ChipButton, EmptyState, IconButton, toast } from '@/ui'
import { LineChart, Sparkline } from '@/ui/charts'
import { useApp } from '@/store/app'
import type { BodyLog } from '@/lib/types'
import { bodySeries } from '@/lib/stats'
import { formatRelativeDay, fromDateKey } from '@/lib/date'
import { formatWeightEs } from './progressLogic'
import { BODY_METRICS, deltaOver, deltaTone, filterRange, lastDelta, logExtras, type BodyRange } from './progressLogic'
import { BodySheet } from './BodySheet'

const RANGES: { value: BodyRange; label: string; aria: string }[] = [
  { value: '1M', label: '1M', aria: 'Último mes' },
  { value: '3M', label: '3M', aria: 'Últimos 3 meses' },
  { value: '6M', label: '6M', aria: 'Últimos 6 meses' },
  { value: 'all', label: 'Todo', aria: 'Todo el historial' },
]
const PAGE = 8

function signed(n: number): string {
  const s = formatWeightEs(Math.abs(n))
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s
}

export function BodyTab({ logs }: { logs: BodyLog[] }) {
  const unit = useApp((s) => s.settings.unit)
  const goal = useApp((s) => s.profile.goal)
  const remove = useApp((s) => s.deleteBodyLog)
  const upsert = useApp((s) => s.upsertBodyLog)
  const [range, setRange] = useState<BodyRange>('3M')
  const [sheet, setSheet] = useState(false)
  const [shown, setShown] = useState(PAGE)

  const weights = useMemo(() => bodySeries(logs, 'weight', unit), [logs, unit])
  const ranged = useMemo(() => filterRange(weights, range), [weights, range])
  const chartData = useMemo(() => ranged.map((p) => ({ x: fromDateKey(p.date).getTime(), y: p.value })), [ranged])
  const delta = useMemo(() => deltaOver(weights, 30), [weights])
  const cards = useMemo(
    () =>
      BODY_METRICS.flatMap((m) => {
        const s = bodySeries(logs, m.key, unit)
        return s.length ? [{ ...m, series: s, last: s[s.length - 1], delta: lastDelta(s) }] : []
      }),
    [logs, unit],
  )
  const history = useMemo(() => logs.slice().sort((a, b) => b.date.localeCompare(a.date)), [logs])

  const del = (log: BodyLog) => {
    remove(log.id)
    toast.success('Registro eliminado', {
      actionLabel: 'Deshacer',
      onAction: () => upsert({ ...log, deleted: false }),
    })
  }

  if (logs.length === 0) {
    return (
      <>
        <EmptyState
          icon={<Scale size={30} />}
          title="Aún no registras tu peso"
          text="Anota tu peso y medidas cuando quieras. Verás tu tendencia sin presión."
          action={
            <Button variant="primary" size="lg" icon={<Plus size={20} />} onClick={() => setSheet(true)}>
              Registrar peso
            </Button>
          }
        />
        <BodySheet open={sheet} onClose={() => setSheet(false)} logs={logs} />
      </>
    )
  }

  const lastW = weights[weights.length - 1]
  const tone = delta ? deltaTone(goal, delta.delta) : 'neutral'
  const lastDate = history[0] ? formatRelativeDay(fromDateKey(history[0].date).getTime()) : ''

  return (
    <div className="stack-lg">
      <Card pad="lg" className="stack">
        <div className="pg-weight">
          <div>
            <div className="pg-weight__label">Peso actual</div>
            {lastW ? (
              <div className="pg-weight__value num">
                {formatWeightEs(lastW.value)}
                <small> {unit}</small>
              </div>
            ) : (
              <div className="pg-weight__value num">–</div>
            )}
          </div>
          {delta && (
            <div className={`pg-delta pg-delta--${tone}`} aria-label={`Cambio en ${delta.days} días: ${signed(delta.delta)} ${unit}`}>
              {delta.delta > 0 ? <ArrowUpRight size={16} /> : delta.delta < 0 ? <ArrowDownRight size={16} /> : <Minus size={16} />}
              <span className="num">
                {signed(delta.delta)} {unit}
              </span>
              <small>en {delta.days >= 28 ? '30 días' : `${delta.days} días`}</small>
            </div>
          )}
        </div>
        <div className="pg-ranges" role="group" aria-label="Rango de la gráfica">
          {RANGES.map((r) => (
            <span key={r.value} title={r.aria}>
              <ChipButton pressed={range === r.value} onClick={() => setRange(r.value)}>
                {r.label}
              </ChipButton>
            </span>
          ))}
        </div>
        <LineChart
          data={chartData}
          height={190}
          formatY={(y) => `${formatWeightEs(Math.round(y * 10) / 10)} ${unit}`}
          ariaLabel={`Peso corporal, ${RANGES.find((r) => r.value === range)?.aria.toLowerCase()}`}
        />
      </Card>

      <Button variant="primary" size="lg" block icon={<Plus size={20} />} onClick={() => setSheet(true)}>
        Registrar peso y medidas
      </Button>

      {cards.length > 0 && (
        <section className="stack" aria-label="Medidas">
          <h2 className="section-title">Medidas</h2>
          <div className="pg-meas">
            {cards.map((c) => (
              <Card key={c.key} className="pg-meas__card">
                <div className="pg-meas__label">{c.label}</div>
                <div className="pg-meas__value num">
                  {formatWeightEs(c.last.value)}
                  <small> {c.unit}</small>
                </div>
                <div className="pg-meas__foot">
                  <span className="pg-meas__delta num">{c.delta === null ? 'Primer registro' : `${signed(c.delta)} ${c.unit}`}</span>
                  <Sparkline values={c.series.slice(-12).map((p) => p.value)} width={56} height={24} color="var(--rest)" ariaLabel={`Tendencia de ${c.label.toLowerCase()}`} />
                </div>
              </Card>
            ))}
          </div>
        </section>
      )}

      <section className="stack" aria-label="Registros">
        <h2 className="section-title">Registros</h2>
        <div className="list glass">
          {history.slice(0, shown).map((l) => {
            const when = formatRelativeDay(fromDateKey(l.date).getTime())
            const extras = logExtras(l)
            return (
              <div key={l.id} className="list-row pg-log">
                <div className="grow">
                  <div className="list-row__title">
                    {typeof l.weight === 'number' ? `${formatWeightEs(l.weight)} ${l.unit}` : 'Medidas'}
                  </div>
                  <div className="list-row__sub truncate">{[when, extras].filter(Boolean).join(' · ')}</div>
                </div>
                <IconButton label={`Eliminar registro de ${when}`} onClick={() => del(l)}>
                  <Trash2 size={18} />
                </IconButton>
              </div>
            )
          })}
        </div>
        {history.length > shown && (
          <Button variant="ghost" block onClick={() => setShown((n) => n + PAGE)}>
            Ver más registros
          </Button>
        )}
      </section>
      <p className="pg-note pg-note--center">{lastDate && `Último registro: ${lastDate.toLowerCase()}`}</p>

      <BodySheet open={sheet} onClose={() => setSheet(false)} logs={logs} />
    </div>
  )
}
