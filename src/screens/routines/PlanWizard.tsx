/**
 * PlanWizard — 4 quick questions (goal, days/week, place/equipment, level) + a preview, then
 * generatePlan() → store.setPlan() + profile update.
 * SHARED CONTRACT: owned by the home-routines-ui agent; imported by Welcome (onboarding) and Routines.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Check, Sparkles } from 'lucide-react'
import type { EquipmentProfile, Goal, Level, Plan } from '@/lib/types'
import { useApp } from '@/store/app'
import {
  DAYS_OPTIONS,
  EQUIPMENT_OPTIONS,
  GOAL_OPTIONS,
  LEVEL_OPTIONS,
  clampDays,
  describePlan,
  describeScheme,
  generatePlan,
  type Option,
  type PlanInput,
} from '@/lib/planner'
import { Button } from '@/ui'
import { exerciseCountLabel } from './routineUtils'
import './wizard.css'

export interface PlanWizardProps {
  /** Called after the plan + routines are saved to the store. */
  onDone: (plan: Plan) => void
  /** Optional "Saltar" action (onboarding). */
  onSkip?: () => void
  /** Render without its own outer card/padding (inside a Sheet or onboarding page). */
  embedded?: boolean
}

type StepId = 'goal' | 'days' | 'equipment' | 'level'
const STEPS: { id: StepId; title: string; hint: string }[] = [
  { id: 'goal', title: '¿Cuál es tu objetivo?', hint: 'Ajusto series, repeticiones y descansos a esto.' },
  { id: 'days', title: '¿Cuántos días entrenas?', hint: 'Elige los que de verdad puedes cumplir.' },
  { id: 'equipment', title: '¿Dónde entrenas?', hint: 'Solo te propondré ejercicios que puedas hacer.' },
  { id: 'level', title: '¿Cuál es tu nivel?', hint: 'Sin presión, puedes cambiarlo cuando quieras.' },
]
const PREVIEW = STEPS.length // index of the preview page

function OptionGroup<T extends string | number>({
  label,
  options,
  value,
  onSelect,
}: {
  label: string
  options: Option<T>[]
  value: T | null
  onSelect: (v: T) => void
}) {
  return (
    <div className="rt-wiz__options" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const selected = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            className="rt-wiz__option glass"
            onClick={() => onSelect(o.value)}
          >
            <span className="rt-wiz__option-text">
              <span className="rt-wiz__option-label">{o.label}</span>
              <span className="rt-wiz__option-desc">{o.description}</span>
            </span>
            <span className="rt-wiz__check" aria-hidden="true">
              {selected && <Check size={16} strokeWidth={3} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}

export function PlanWizard({ onDone, onSkip, embedded }: PlanWizardProps) {
  const profile = useApp((s) => s.profile)
  const [step, setStep] = useState(0)
  const [goal, setGoal] = useState<Goal | null>(profile.goal ?? null)
  const [days, setDays] = useState<number | null>(profile.daysPerWeek ? clampDays(profile.daysPerWeek) : null)
  const [equipment, setEquipment] = useState<EquipmentProfile | null>(profile.equipment ?? null)
  const [level, setLevel] = useState<Level | null>(profile.level ?? null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => () => clearTimeout(timer.current), [])
  // Move focus to the new question so keyboard / screen-reader users follow along.
  useEffect(() => {
    if (step > 0) heading.current?.focus({ preventScroll: true })
  }, [step])

  const answers = [goal, days, equipment, level]
  const complete = answers.every((a) => a !== null)
  const input: PlanInput | null = complete
    ? { goal: goal as Goal, daysPerWeek: days as number, equipment: equipment as EquipmentProfile, level: level as Level }
    : null

  // Generated once per set of answers, so the preview and the saved plan are identical.
  const generated = useMemo(() => (input ? generatePlan(input) : null), [input?.goal, input?.daysPerWeek, input?.equipment, input?.level]) // eslint-disable-line react-hooks/exhaustive-deps

  const select = <T,>(set: (v: T) => void) => (v: T) => {
    set(v)
    clearTimeout(timer.current)
    // Zero friction: picking an answer moves on by itself (Atrás / Siguiente still work).
    timer.current = setTimeout(() => setStep((s) => Math.min(PREVIEW, s + 1)), 200)
  }

  const create = () => {
    if (!input || !generated) return
    const st = useApp.getState()
    st.setPlan(generated.plan, generated.routines)
    st.updateProfile({ goal: input.goal, level: input.level, daysPerWeek: input.daysPerWeek, equipment: input.equipment })
    onDone(useApp.getState().plan ?? generated.plan)
  }

  const onPreview = step === PREVIEW
  const current = STEPS[step]
  const canNext = !onPreview && answers[step] !== null

  return (
    <section className={`rt-wiz ${embedded ? 'rt-wiz--embedded' : 'rt-wiz--card glass'}`} aria-label="Crear mi plan">
      <div className="rt-wiz__top">
        <div className="rt-wiz__dots" role="progressbar" aria-valuemin={1} aria-valuemax={PREVIEW + 1} aria-valuenow={step + 1} aria-label={`Paso ${step + 1} de ${PREVIEW + 1}`}>
          {Array.from({ length: PREVIEW + 1 }, (_, i) => (
            <span key={i} className={`rt-wiz__dot ${i === step ? 'is-current' : i < step ? 'is-done' : ''}`} />
          ))}
        </div>
        {onSkip && (
          <Button variant="ghost" onClick={onSkip}>
            Saltar
          </Button>
        )}
      </div>

      <div className="rt-wiz__page" key={step}>
        {!onPreview && current && (
          <>
            <h2 className="rt-wiz__title" tabIndex={-1} ref={heading}>
              {current.title}
            </h2>
            <p className="rt-wiz__hint">{current.hint}</p>
            {current.id === 'goal' && <OptionGroup label="Objetivo" options={GOAL_OPTIONS} value={goal} onSelect={select(setGoal)} />}
            {current.id === 'days' && <OptionGroup label="Días por semana" options={DAYS_OPTIONS} value={days} onSelect={select(setDays)} />}
            {current.id === 'equipment' && (
              <OptionGroup label="Dónde entrenas" options={EQUIPMENT_OPTIONS} value={equipment} onSelect={select(setEquipment)} />
            )}
            {current.id === 'level' && <OptionGroup label="Nivel" options={LEVEL_OPTIONS} value={level} onSelect={select(setLevel)} />}
          </>
        )}

        {onPreview && input && generated && (
          <>
            <h2 className="rt-wiz__title" tabIndex={-1} ref={heading}>
              Tu plan está listo
            </h2>
            <div className="rt-wiz__preview glass">
              <div className="rt-wiz__preview-head">
                <span className="rt-wiz__spark" aria-hidden="true">
                  <Sparkles size={18} />
                </span>
                <div className="grow">
                  <div className="rt-wiz__preview-name">{describePlan(input)}</div>
                  <div className="rt-wiz__preview-scheme">{describeScheme(input.goal)}</div>
                </div>
              </div>
              <ol className="rt-wiz__days">
                {generated.routines.map((r, i) => (
                  <li key={r.id} className="rt-wiz__day">
                    <span className="rt-wiz__day-n num">{i + 1}</span>
                    <span className="grow">
                      <span className="rt-wiz__day-name truncate">{r.name}</span>
                      {r.focus && <span className="rt-wiz__day-focus truncate">{r.focus}</span>}
                    </span>
                    <span className="rt-wiz__day-count">{exerciseCountLabel(r.items.length)}</span>
                  </li>
                ))}
              </ol>
            </div>
            <p className="rt-wiz__hint">Rotas entre estas rutinas; siempre verás cuál toca hoy.</p>
          </>
        )}
      </div>

      <div className="rt-wiz__nav">
        {step > 0 ? (
          <Button variant="glass" size="lg" icon={<ArrowLeft size={20} />} onClick={() => setStep(step - 1)} aria-label="Atrás" />
        ) : (
          <span />
        )}
        {onPreview ? (
          <Button variant="primary" size="lg" className="rt-wiz__cta" disabled={!generated} onClick={create}>
            Crear mi plan
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            className="rt-wiz__cta"
            disabled={!canNext}
            iconRight={<ArrowRight size={20} />}
            onClick={() => setStep(step + 1)}
          >
            Siguiente
          </Button>
        )}
      </div>
    </section>
  )
}
