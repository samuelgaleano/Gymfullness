import { useMemo, useState } from 'react'
import { useLocation } from 'wouter'
import { BookOpen, ChevronRight, Clock, Play, Plus, Repeat, Sparkles } from 'lucide-react'
import type { Goal, Level, Routine } from '@/lib/types'
import type { RoutineTemplate } from '@/data/templates'
import { SPLIT_LABEL, templatesFor } from '@/data/templates'
import { useApp, useRoutines, useSessions } from '@/store/app'
import { buildRoutinesFromTemplate, clampDays, generatePlanFromTemplate, nextRoutineId } from '@/lib/planner'
import { Button, Card, CardButton, Chip, EmptyState, Header, IconButton, Sheet, toast } from '@/ui'
import { PlanWizard } from './PlanWizard'
import { GOAL_LABEL, LEVEL_LABEL, PLACE_LABEL, estimateMinutes, exerciseCountLabel, useStartWorkout } from './routineUtils'
import './routines.css'

export default function RoutinesScreen() {
  const [, navigate] = useLocation()
  const plan = useApp((s) => s.plan)
  const profile = useApp((s) => s.profile)
  const routines = useRoutines()
  const sessions = useSessions()
  const start = useStartWorkout()
  const [wizardOpen, setWizardOpen] = useState(false)
  const [template, setTemplate] = useState<RoutineTemplate | null>(null)

  const nextId = useMemo(() => nextRoutineId(plan, sessions, routines), [plan, sessions, routines])
  const byId = useMemo(() => new Map(routines.map((r) => [r.id, r])), [routines])
  const planRoutines = useMemo(() => (plan ? plan.routineIds.map((id) => byId.get(id)).filter((r): r is Routine => !!r) : []), [plan, byId])
  const inPlan = useMemo(() => new Set(planRoutines.map((r) => r.id)), [planRoutines])
  const templates = useMemo(() => templatesFor(profile.equipment), [profile.equipment])

  const goal: Goal = plan?.goal ?? profile.goal ?? 'muscle'
  const level: Level = plan?.level ?? profile.level ?? 'beginner'

  const applyTemplate = (t: RoutineTemplate, asPlan: boolean) => {
    const st = useApp.getState()
    if (asPlan) {
      const wanted = clampDays(plan?.daysPerWeek ?? profile.daysPerWeek ?? t.daysPerWeek[0])
      const days = t.daysPerWeek.includes(wanted) ? wanted : t.daysPerWeek[0]
      const { plan: p, routines: rs } = generatePlanFromTemplate(t, { goal, level, daysPerWeek: days, equipment: t.equipment })
      st.setPlan(p, rs)
      toast.success(`Plan “${t.name}” activado`)
    } else {
      const rs = buildRoutinesFromTemplate(t, { goal, level })
      for (const r of rs) st.upsertRoutine(r)
      toast.success(`${rs.length} ${rs.length === 1 ? 'rutina añadida' : 'rutinas añadidas'}`)
    }
    setTemplate(null)
  }

  return (
    <main className="screen">
      <Header
        title="Rutinas"
        actions={
          <IconButton label="Biblioteca de ejercicios" variant="glass" onClick={() => navigate('/exercises')}>
            <BookOpen size={22} />
          </IconButton>
        }
      />

      <div className="stack-lg">
        {/* ---------- Plan ---------- */}
        {plan && planRoutines.length > 0 ? (
          <section className="stack" aria-label="Tu plan">
            <Card accent pad="lg" className="rt-plan">
              <div className="row-between">
                <div className="grow">
                  <div className="rt-eyebrow">Tu plan</div>
                  <div className="rt-plan__title">{plan.daysPerWeek} días por semana</div>
                </div>
                <Button variant="glass" icon={<Repeat size={16} />} onClick={() => setWizardOpen(true)}>
                  Cambiar
                </Button>
              </div>
              <div className="rt-plan__chips">
                <Chip>{GOAL_LABEL[plan.goal]}</Chip>
                <Chip>{LEVEL_LABEL[plan.level]}</Chip>
                <Chip>{PLACE_LABEL[plan.equipment]}</Chip>
              </div>
              <ol className="rt-rotation" aria-label="Orden de rotación">
                {planRoutines.map((r, i) => {
                  const isNext = r.id === nextId
                  return (
                    <li key={r.id}>
                      <button type="button" className={`rt-rotation__item ${isNext ? 'is-next' : ''}`} onClick={() => navigate(`/routines/${r.id}`)}>
                        <span className="rt-rotation__n num">{i + 1}</span>
                        <span className="grow">
                          <span className="rt-rotation__name truncate">{r.name}</span>
                        </span>
                        {isNext && <Chip tone="accent">Hoy toca</Chip>}
                        <ChevronRight size={16} className="faint" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ol>
            </Card>
          </section>
        ) : (
          <Card pad="lg">
            <EmptyState
              icon={<Sparkles size={28} />}
              title="Crea tu plan"
              text="Responde 4 preguntas y armo una semana de entrenos a tu medida."
              action={
                <Button variant="primary" size="lg" onClick={() => setWizardOpen(true)}>
                  Crear mi plan
                </Button>
              }
            />
          </Card>
        )}

        {/* ---------- Routines ---------- */}
        <section className="stack" aria-label="Mis rutinas">
          <div className="row-between">
            <h2 className="section-title">Mis rutinas</h2>
            <Button variant="glass" icon={<Plus size={16} />} onClick={() => navigate('/routines/new')}>
              Nueva rutina
            </Button>
          </div>
          {routines.length === 0 ? (
            <p className="muted rt-note">Aún no tienes rutinas. Crea una desde cero o elige una plantilla abajo.</p>
          ) : (
            routines.map((r) => (
              <Card key={r.id} pad="none" className="rt-routine">
                <button type="button" className="rt-routine__main" onClick={() => navigate(`/routines/${r.id}`)}>
                  <span className="rt-routine__name truncate">{r.name}</span>
                  {r.focus && <span className="rt-routine__focus truncate">{r.focus}</span>}
                  <span className="rt-routine__meta">
                    <span>{exerciseCountLabel(r.items.length)}</span>
                    <span aria-hidden="true">·</span>
                    <span className="rt-inline">
                      <Clock size={13} aria-hidden="true" />~{estimateMinutes(r)} min
                    </span>
                    {inPlan.has(r.id) && <Chip tone={r.id === nextId ? 'accent' : undefined}>{r.id === nextId ? 'Hoy toca' : 'En tu plan'}</Chip>}
                  </span>
                </button>
                <IconButton label={`Empezar ${r.name}`} variant="glass" size="lg" className="rt-routine__play" disabled={r.items.length === 0} onClick={() => start(r.id)}>
                  <Play size={22} fill="currentColor" />
                </IconButton>
              </Card>
            ))
          )}
        </section>

        {/* ---------- Templates ---------- */}
        <section className="stack" aria-label="Plantillas">
          <h2 className="section-title">Plantillas</h2>
          {templates.map((t) => (
            <Card key={t.id} className="rt-template">
              <div className="row-between" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className="rt-template__name">{t.name}</div>
                  <div className="rt-template__meta">
                    {SPLIT_LABEL[t.split]} · {t.days.length} {t.days.length === 1 ? 'rutina' : 'rutinas'} · ~{t.minutes} min
                  </div>
                </div>
                <Button variant="glass" onClick={() => setTemplate(t)}>
                  Usar
                </Button>
              </div>
              <p className="rt-template__desc">{t.description}</p>
              <div className="rt-plan__chips">
                {t.daysPerWeek.map((d) => (
                  <Chip key={d}>{d} días</Chip>
                ))}
              </div>
            </Card>
          ))}
        </section>

        <CardButton onClick={() => navigate('/exercises')} className="rt-lib">
          <span className="rt-lib__icon">
            <BookOpen size={20} />
          </span>
          <span className="grow">
            <span className="rt-routine__name">Biblioteca de ejercicios</span>
            <span className="rt-routine__focus">Técnica, músculos y tu historial</span>
          </span>
          <ChevronRight size={18} className="faint" aria-hidden="true" />
        </CardButton>
      </div>

      <Sheet open={wizardOpen} onClose={() => setWizardOpen(false)} title={plan ? 'Cambiar plan' : 'Crear mi plan'}>
        <PlanWizard
          embedded
          onDone={() => {
            setWizardOpen(false)
            toast.success('Plan actualizado')
          }}
        />
      </Sheet>

      <Sheet
        open={!!template}
        onClose={() => setTemplate(null)}
        title={template?.name}
        footer={
          template && (
            <div className="rt-sheet-actions">
              <Button variant="primary" size="lg" block onClick={() => applyTemplate(template, true)}>
                Usar como mi plan
              </Button>
              <Button variant="glass" size="lg" block onClick={() => applyTemplate(template, false)}>
                Solo añadir las rutinas
              </Button>
            </div>
          )
        }
      >
        {template && (
          <div className="stack">
            <p className="muted">{template.description}</p>
            <ul className="rt-template__days">
              {template.days.map((d) => (
                <li key={d.name}>
                  <strong>{d.name}</strong>
                  <span className="muted">{d.focus}</span>
                </li>
              ))}
            </ul>
            <p className="rt-note muted">Ajusto series y descansos a tu objetivo ({GOAL_LABEL[goal].toLowerCase()}) y nivel.</p>
          </div>
        )}
      </Sheet>
    </main>
  )
}
