import { useMemo, useState } from 'react'
import { Link, useLocation } from 'wouter'
import { Check, ChevronRight, Dumbbell, Flame, Lightbulb, ListChecks, Play, Sparkles, Timer, Trophy } from 'lucide-react'
import { getExercise, useApp, useBodyLogs, useRoutines, useSessions } from '@/store/app'
import { getCursorInfo } from '@/lib/workout/engine'
import { useElapsed } from '@/lib/workout/useElapsed'
import { nextRoutineId } from '@/lib/planner'
import { streak, summarizeSession } from '@/lib/stats'
import { formatClock, formatDate, formatDuration, formatRelativeDay, greeting, toDateKey } from '@/lib/date'
import { formatVolume, formatWeight } from '@/lib/units'
import { Button, Card, CardButton, Chip, EmptyState, Header, ProgressBar, ProgressRing, Sheet, Stepper, toast } from '@/ui'
import { PlanWizard } from '../routines/PlanWizard'
import { AssistantPill } from '../assistant'
import { estimateMinutes, exerciseCountLabel, useStartWorkout } from '../routines/routineUtils'
import { readSnooze, smartTip, snoozeWeightPrompt, weekDays, weightPromptDue } from './homeLogic'
import './home.css'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Hero while a workout is in progress: elapsed time + resume. */
function ActiveHero() {
  const [, navigate] = useLocation()
  const active = useApp((s) => s.activeSession)
  const elapsed = useElapsed(active?.startedAt)
  if (!active) return null
  const info = getCursorInfo(active)
  return (
    <Card accent pad="lg" className="home-hero">
      <div className="row-between">
        <Chip tone="accent" icon={<Timer size={14} />}>
          En curso
        </Chip>
        <span className="home-hero__elapsed num" aria-label="Tiempo transcurrido">
          {formatClock(elapsed)}
        </span>
      </div>
      <div>
        <h2 className="home-hero__title">{active.name}</h2>
        <p className="home-hero__sub">
          {info.doneSets} de {info.totalSessionSets} series hechas
        </p>
      </div>
      <ProgressBar value={info.progress} />
      <Button variant="primary" size="xl" block icon={<Play size={24} fill="currentColor" />} onClick={() => navigate('/workout')}>
        Continuar entreno
      </Button>
    </Card>
  )
}

export default function HomeScreen() {
  const [, navigate] = useLocation()
  const start = useStartWorkout()
  const profile = useApp((s) => s.profile)
  const plan = useApp((s) => s.plan)
  const unit = useApp((s) => s.settings.unit)
  const hasActive = useApp((s) => s.activeSession !== null)
  const routines = useRoutines()
  const sessions = useSessions()
  const bodyLogs = useBodyLogs()
  const [pickOpen, setPickOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)

  const now = Date.now()
  const nextId = useMemo(() => nextRoutineId(plan, sessions, routines), [plan, sessions, routines])
  const next = useMemo(() => routines.find((r) => r.id === nextId) ?? null, [routines, nextId])
  const goal = plan?.daysPerWeek ?? profile.daysPerWeek ?? 3

  const week = useMemo(() => weekDays(sessions, now), [sessions]) // eslint-disable-line react-hooks/exhaustive-deps
  const st = useMemo(() => streak(sessions, now), [sessions]) // eslint-disable-line react-hooks/exhaustive-deps
  const last = sessions.length ? sessions[sessions.length - 1] : null
  const lastSummary = useMemo(() => (last ? summarizeSession(last, getExercise) : null), [last])
  const tip = useMemo(() => smartTip({ sessions, getExercise, daysPerWeek: goal, now }), [sessions, goal]) // eslint-disable-line react-hooks/exhaustive-deps

  const [snoozed, setSnoozed] = useState(readSnooze)
  const [logged, setLogged] = useState(false)
  const showWeight = sessions.length > 0 && !logged && weightPromptDue(bodyLogs, now, snoozed)
  const lastWeight = useMemo(() => {
    for (let i = bodyLogs.length - 1; i >= 0; i--) {
      const l = bodyLogs[i]
      if (typeof l.weight === 'number') return l.unit === unit ? l.weight : null
    }
    return null
  }, [bodyLogs, unit])
  const [weight, setWeight] = useState<number | null>(lastWeight ?? (unit === 'kg' ? 70 : 155))

  const saveWeight = () => {
    if (weight === null) return
    useApp.getState().upsertBodyLog({ date: toDateKey(), weight, unit })
    snoozeWeightPrompt()
    setLogged(true)
    toast.success(`Peso guardado · ${formatWeight(weight)} ${unit}`)
  }
  const skipWeight = () => {
    snoozeWeightPrompt()
    setSnoozed(readSnooze())
  }

  const name = profile.name?.trim().split(/\s+/)[0]
  const title = name ? `${greeting()}, ${name}` : greeting()
  const ringValue = goal > 0 ? Math.min(1, st.thisWeek / goal) : 0
  const prCount = lastSummary?.prs.length ?? 0

  return (
    <main className="screen">
      <Header eyebrow={cap(formatDate(now))} title={title} />

      <div className="stack-lg">
        {/* ---------- Hero ---------- */}
        {hasActive ? (
          <ActiveHero />
        ) : next ? (
          <Card accent pad="lg" className="home-hero">
            <Chip tone="accent" icon={<Sparkles size={14} />}>
              Hoy toca
            </Chip>
            <div>
              <h2 className="home-hero__title">{next.name}</h2>
              {next.focus && <p className="home-hero__sub">{next.focus}</p>}
            </div>
            <div className="home-hero__meta">
              <span className="home-hero__meta-item">
                <Dumbbell size={16} aria-hidden="true" />
                {exerciseCountLabel(next.items.length)}
              </span>
              <span className="home-hero__meta-item">
                <Timer size={16} aria-hidden="true" />~{estimateMinutes(next)} min
              </span>
            </div>
            <Button variant="primary" size="xl" block icon={<Play size={24} fill="currentColor" />} onClick={() => start(next.id)}>
              Empezar entreno
            </Button>
          </Card>
        ) : (
          <Card pad="lg" className="home-hero">
            <EmptyState
              icon={<Sparkles size={28} />}
              title="Armemos tu plan"
              text="Cuatro preguntas rápidas y te dejo listas tus rutinas de la semana."
              action={
                <Button variant="primary" size="lg" onClick={() => setPlanOpen(true)}>
                  Crear mi plan
                </Button>
              }
            />
          </Card>
        )}

        {/* ---------- Secondary starts ---------- */}
        {!hasActive && (
          <div className="home-quick">
            <Button variant="glass" size="lg" block icon={<Dumbbell size={20} />} onClick={() => start(null)}>
              Entreno libre
            </Button>
            {routines.length > 0 && (
              <Button variant="glass" size="lg" block icon={<ListChecks size={20} />} onClick={() => setPickOpen(true)}>
                {next ? 'Otra rutina' : 'Elegir rutina'}
              </Button>
            )}
          </div>
        )}

        <AssistantPill />

        {/* ---------- Week ---------- */}
        {(plan || sessions.length > 0) && (
        <Card pad="lg" className="home-week" aria-label="Progreso semanal">
          <div className="home-week__top">
            <ProgressRing value={ringValue} size={96} stroke={10}>
              <span className="home-ring__value num">
                {st.thisWeek}
                <span className="home-ring__of">/{goal}</span>
              </span>
            </ProgressRing>
            <div className="grow">
              <div className="home-week__label">Esta semana</div>
              <div className="home-week__headline">
                {st.thisWeek >= goal ? 'Meta cumplida' : `${goal - st.thisWeek} ${goal - st.thisWeek === 1 ? 'entreno' : 'entrenos'} para tu meta`}
              </div>
              {st.weeks > 0 && (
                <div style={{ marginTop: 'var(--s-2)' }}>
                  <Chip tone="pr" icon={<Flame size={14} />}>
                    {st.weeks} {st.weeks === 1 ? 'semana' : 'semanas'} seguidas
                  </Chip>
                </div>
              )}
            </div>
          </div>
          <ol className="home-strip" aria-label="Días de la semana">
            {week.map((d) => (
              <li key={d.key} className={`home-strip__day ${d.today ? 'is-today' : ''} ${d.future ? 'is-future' : ''}`}>
                <span className="home-strip__label" aria-hidden="true">
                  {d.label}
                </span>
                <span className={`home-strip__dot ${d.trained ? 'is-trained' : ''}`} aria-hidden="true">
                  {d.trained && <Check size={14} strokeWidth={3} />}
                </span>
                <span className="sr-only">
                  {d.name}
                  {d.today ? ' (hoy)' : ''}: {d.trained ? 'entrenaste' : d.future ? 'pendiente' : 'sin entreno'}
                </span>
              </li>
            ))}
          </ol>
        </Card>
        )}

        {/* ---------- Tip ---------- */}
        {tip && (
          <div className="home-tip" role="note">
            <span className="home-tip__icon" aria-hidden="true">
              <Lightbulb size={18} />
            </span>
            <p>{tip.text}</p>
          </div>
        )}

        {/* ---------- Last session ---------- */}
        {last && lastSummary && (
          <section className="stack" aria-label="Último entreno">
            <h2 className="section-title">Último entreno</h2>
            <Link href={`/history/${last.id}`} className="card glass card--interactive home-last" aria-label={`Ver ${last.name}`}>
              <div className="row-between">
                <div className="grow">
                  <div className="home-last__name truncate">{last.name}</div>
                  <div className="home-last__when">{formatRelativeDay(last.startedAt, now)}</div>
                </div>
                <ChevronRight size={20} className="faint" aria-hidden="true" />
              </div>
              <div className="home-last__stats">
                <span>
                  <b className="num">{formatDuration(lastSummary.durationSec)}</b>
                </span>
                <span>
                  <b className="num">{lastSummary.totalSets}</b> series
                </span>
                {lastSummary.volume > 0 && (
                  <span>
                    <b className="num">{formatVolume(lastSummary.volume, lastSummary.unit)}</b>
                  </span>
                )}
              </div>
              {prCount > 0 && (
                <div className="home-last__prs">
                  {lastSummary.prs.slice(0, 3).map((p) => (
                    <Chip key={p.exerciseId} tone="pr" icon={<Trophy size={13} />}>
                      {p.name}
                    </Chip>
                  ))}
                  {prCount > 3 && <Chip tone="pr">+{prCount - 3}</Chip>}
                </div>
              )}
            </Link>
          </section>
        )}

        {/* ---------- Weekly weight ---------- */}
        {showWeight && (
          <Card pad="lg" className="home-weight" aria-label="Tu peso">
            <div>
              <h2 className="home-weight__title">¿Cuánto pesas hoy?</h2>
              <p className="muted home-weight__sub">Un registro por semana basta para ver tu tendencia.</p>
            </div>
            <Stepper label={`Peso (${unit})`} value={weight} onChange={setWeight} step={unit === 'kg' ? 0.1 : 0.5} decimals={1} min={20} max={400} />
            <div className="row">
              <Button variant="ghost" size="lg" onClick={skipWeight}>
                Ahora no
              </Button>
              <Button variant="glass" size="lg" className="grow" disabled={weight === null} onClick={saveWeight}>
                Guardar peso
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* ---------- Sheets ---------- */}
      <Sheet open={pickOpen} onClose={() => setPickOpen(false)} title="Elegir rutina">
        <div className="home-pick">
          {routines.map((r) => (
            <CardButton
              key={r.id}
              className="home-pick__item"
              disabled={r.items.length === 0}
              onClick={() => {
                setPickOpen(false)
                start(r.id)
              }}
            >
              <span className="grow">
                <span className="home-pick__name truncate">{r.name}</span>
                <span className="home-pick__meta">
                  {exerciseCountLabel(r.items.length)} · ~{estimateMinutes(r)} min
                </span>
              </span>
              {r.id === nextId && <Chip tone="accent">Hoy toca</Chip>}
              <Play size={18} className="faint" aria-hidden="true" />
            </CardButton>
          ))}
          <Button variant="ghost" block onClick={() => navigate('/routines')}>
            Gestionar rutinas
          </Button>
        </div>
      </Sheet>

      <Sheet open={planOpen} onClose={() => setPlanOpen(false)} title="Crear mi plan">
        <PlanWizard embedded onDone={() => setPlanOpen(false)} />
      </Sheet>
    </main>
  )
}
