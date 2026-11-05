import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useRoute } from 'wouter'
import { ChevronDown, Dumbbell, ExternalLink, Trash2, Trophy } from 'lucide-react'
import type { Exercise, WorkoutSession } from '@/lib/types'
import { EQUIPMENT_LABEL, EXERCISES, MUSCLE_LABEL, videoQueryFor } from '@/data/exercises'
import { useApp, useSessions } from '@/store/app'
import { alternatives } from '@/lib/recommend'
import { exerciseHistory, isWorkingSet, personalRecords } from '@/lib/stats'
import { convertWeight, formatWeight } from '@/lib/units'
import { formatRelativeDay } from '@/lib/date'
import { Button, Card, EmptyState, IconButton, Sheet, Stat, TopBar, toast } from '@/ui'
import { LineChart } from '@/ui/charts'
import { ExerciseBadges, ExerciseRow } from './ExerciseRow'
import './exercises.css'

const LEVEL_LABEL = { beginner: 'Principiante', intermediate: 'Intermedio', advanced: 'Avanzado' } as const
const KIND_LABEL = { weight_reps: 'Peso y reps', reps: 'Solo reps', time: 'Tiempo' } as const

function Accordion({ items }: { items: { id: string; title: string; open?: boolean; body: ReactNode }[] }) {
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(items.filter((i) => i.open).map((i) => i.id)))
  const toggle = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  return (
    <div className="ex-acc glass">
      {items.map((it) => {
        const open = openIds.has(it.id)
        return (
          <div key={it.id} className="ex-acc__item">
            <button type="button" className="ex-acc__btn" aria-expanded={open} aria-controls={`ex-acc-${it.id}`} onClick={() => toggle(it.id)}>
              {it.title}
              <ChevronDown size={20} className="ex-acc__chev" aria-hidden="true" />
            </button>
            {open && (
              <div id={`ex-acc-${it.id}`} className="ex-acc__panel">
                {it.body}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const Bullets = ({ items, warn }: { items: string[]; warn?: boolean }) => (
  <ul className={`ex-bullets ${warn ? 'ex-bullets--warn' : ''}`}>
    {items.map((t, i) => (
      <li key={i}>{t}</li>
    ))}
  </ul>
)

/** "80 × 10" / "12 reps" / "45 s" for a logged set in the user's unit. */
function describeSet(set: WorkoutSession['exercises'][number]['sets'][number], from: WorkoutSession['unit'], to: WorkoutSession['unit'], kind: Exercise['kind']): string {
  if (kind === 'time') return `${set.seconds ?? set.reps ?? 0} s`
  if (kind === 'reps' || set.weight == null) return `${set.reps ?? 0} reps`
  const w = from === to ? set.weight : Math.round(convertWeight(set.weight, from, to) * 2) / 2
  return `${formatWeight(w)}×${set.reps ?? 0}`
}

export default function ExerciseDetailScreen() {
  const [, params] = useRoute('/exercises/:id')
  const [, navigate] = useLocation()
  const id = params?.id ?? ''
  const custom = useApp((s) => s.customExercises)
  const unit = useApp((s) => s.settings.unit)
  const equipmentProfile = useApp((s) => s.profile.equipment)
  const sessions = useSessions()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const ex = useMemo(() => EXERCISES.find((e) => e.id === id) ?? custom.find((e) => e.id === id), [id, custom])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [id])

  const back = () => (window.history.length > 1 ? window.history.back() : navigate('/exercises'))

  const history = useMemo(() => (ex ? exerciseHistory(sessions, ex.id, unit) : []), [sessions, ex, unit])
  const record = useMemo(() => (ex ? personalRecords(sessions, unit).find((r) => r.exerciseId === ex.id) : undefined), [sessions, ex, unit])
  const alts = useMemo(() => (ex ? alternatives(ex.id, [...EXERCISES, ...custom], equipmentProfile, 5) : []), [ex, custom, equipmentProfile])
  const recent = useMemo(() => {
    if (!ex) return []
    return sessions
      .filter((s) => s.exercises.some((e) => e.exerciseId === ex.id))
      .slice(-5)
      .reverse()
      .map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        sets: s.exercises
          .filter((e) => e.exerciseId === ex.id)
          .flatMap((e) => e.sets.filter(isWorkingSet))
          .map((set) => describeSet(set, s.unit, unit, ex.kind)),
      }))
      .filter((r) => r.sets.length > 0)
  }, [sessions, ex, unit])

  if (!ex) {
    return (
      <main className="screen">
        <TopBar onBack={back} />
        <EmptyState
          icon={<Dumbbell size={28} />}
          title="No encontramos este ejercicio"
          text="Puede que se haya eliminado o que el enlace no sea correcto."
          action={
            <Button variant="primary" onClick={() => navigate('/exercises')}>
              Ver biblioteca
            </Button>
          }
        />
      </main>
    )
  }

  const trend = history.filter((h) => h.bestE1rm !== null).map((h) => ({ x: h.date, y: h.bestE1rm as number }))
  const videoUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(ex.videoQuery ?? videoQueryFor(ex.name))}`
  const sections = [
    ex.cues.length > 0 && { id: 'cues', title: 'Ejecución', open: true, body: <Bullets items={ex.cues} /> },
    ex.setup.length > 0 && { id: 'setup', title: 'Preparación', body: <Bullets items={ex.setup} /> },
    ex.mistakes.length > 0 && { id: 'mistakes', title: 'Errores comunes', body: <Bullets items={ex.mistakes} warn /> },
    ex.breathing && { id: 'breathing', title: 'Respiración', body: <p className="muted">{ex.breathing}</p> },
  ].filter(Boolean) as { id: string; title: string; open?: boolean; body: ReactNode }[]

  const records = [
    ex.kind === 'weight_reps' && record?.bestE1rm != null && { value: `${formatWeight(record.bestE1rm)} ${unit}`, label: 'e1RM estimado' },
    ex.kind === 'weight_reps' && record?.bestWeight != null && { value: `${formatWeight(record.bestWeight)} ${unit}`, label: 'Mejor peso' },
    ex.kind !== 'time' && record?.bestReps != null && { value: String(record.bestReps), label: 'Más reps' },
  ].filter(Boolean) as { value: string; label: string }[]

  return (
    <main className="screen">
      <TopBar
        onBack={back}
        right={
          ex.custom && (
            <IconButton label="Eliminar ejercicio" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={20} />
            </IconButton>
          )
        }
      />
      <div className="ex-detail">
        <div>
          <h1 className="ex-detail__title">{ex.name}</h1>
          <div className="ex-detail__badges">
            <ExerciseBadges ex={ex} />
            <span className="ex-badge">{LEVEL_LABEL[ex.level]}</span>
            <span className="ex-badge">{KIND_LABEL[ex.kind]}</span>
          </div>
        </div>

        <Card>
          <div className="ex-muscles">
            <div className="ex-muscles__row">
              <span className="ex-muscles__label">Principal</span>
              <span className="chip chip--accent">{MUSCLE_LABEL[ex.primary]}</span>
            </div>
            {ex.secondary.length > 0 && (
              <div className="ex-muscles__row">
                <span className="ex-muscles__label">Secundarios</span>
                {ex.secondary.map((m) => (
                  <span key={m} className="chip">
                    {MUSCLE_LABEL[m]}
                  </span>
                ))}
              </div>
            )}
            <div className="ex-muscles__row">
              <span className="ex-muscles__label">Equipo</span>
              {ex.equipment.map((q) => (
                <span key={q} className="chip">
                  {EQUIPMENT_LABEL[q]}
                </span>
              ))}
            </div>
          </div>
        </Card>

        {sections.length > 0 ? (
          <Accordion key={ex.id} items={sections} />
        ) : (
          ex.custom && <p className="ex-hint">Es un ejercicio propio: aún no tiene guía de técnica.</p>
        )}

        <Button variant="glass" size="lg" block icon={<ExternalLink size={18} />} onClick={() => window.open(videoUrl, '_blank', 'noopener,noreferrer')}>
          Ver video
        </Button>

        <section className="stack" aria-label="Tu progreso">
          <h2 className="section-title">Tu progreso</h2>
          <Card pad="lg">
            {history.length === 0 ? (
              <p className="ex-hint">Todavía no has hecho este ejercicio. Cuando lo registres verás aquí tus récords y tu tendencia.</p>
            ) : (
              <div className="ex-records">
                {records.length > 0 && (
                  <div className="stats-grid">
                    {records.map((r) => (
                      <Stat key={r.label} value={r.value} label={r.label} />
                    ))}
                  </div>
                )}
                {record && (
                  <div className="row ex-hint">
                    <Trophy size={16} color="var(--pr)" aria-hidden="true" />
                    <span>Récord logrado {formatRelativeDay(record.date).toLowerCase()}</span>
                  </div>
                )}
                {trend.length >= 2 ? (
                  <LineChart data={trend} height={150} color="var(--pr)" area formatY={(y) => `${formatWeight(y)} ${unit}`} ariaLabel={`Tendencia de e1RM en ${ex.name}`} />
                ) : (
                  trend.length > 0 && <p className="ex-hint">Con un entreno más verás tu gráfica de tendencia.</p>
                )}
              </div>
            )}
          </Card>
        </section>

        {recent.length > 0 && (
          <section className="stack" aria-label="Últimas series">
            <h2 className="section-title">Últimas series</h2>
            <Card>
              <div className="ex-history">
                {recent.map((r) => (
                  <div key={r.id} className="ex-history__row">
                    <span className="ex-history__date">{formatRelativeDay(r.startedAt)}</span>
                    <span className="ex-history__sets num">{r.sets.join(' · ')}</span>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {alts.length > 0 && (
          <section className="stack" aria-label="Alternativas">
            <h2 className="section-title">Alternativas</h2>
            <div className="ex-list glass">
              {alts.map((a) => (
                <ExerciseRow key={a.id} ex={a} href={`/exercises/${a.id}`} />
              ))}
            </div>
          </section>
        )}
      </div>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="¿Eliminar este ejercicio?"
        footer={
          <div className="stack">
            <Button
              variant="danger"
              size="lg"
              block
              onClick={() => {
                useApp.getState().deleteCustomExercise(ex.id)
                setConfirmDelete(false)
                toast.show(`“${ex.name}” eliminado`)
                navigate('/exercises', { replace: true })
              }}
            >
              Eliminar ejercicio
            </Button>
            <Button variant="glass" size="lg" block onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        }
      >
        <p className="muted">
          “{ex.name}” se quitará de tu biblioteca. Las series que ya registraste se conservan en tu historial, pero ya no aparecerá al armar rutinas.
        </p>
      </Sheet>
    </main>
  )
}
