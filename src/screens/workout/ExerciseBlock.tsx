import { ArrowLeftRight, BookOpen, Check, ChevronRight, Hash, History, NotebookPen, Plus, SkipForward, Trophy, TrendingUp } from 'lucide-react'
import { Chip, Stepper } from '@/ui'
import { MUSCLE_LABEL } from '@/data/exercises'
import { loadStep } from '@/lib/workout/engine'
import type { CursorInfo, Exercise, ExerciseKind, Unit } from '@/lib/types'
import { formatSetCompact, formatSetValues, targetLine, type SetValues } from './helpers'
import { TimeSetPanel } from './TimeSetPanel'

export interface ExerciseBlockProps {
  info: CursorInfo
  exercise: Exercise | undefined
  kind: ExerciseKind
  unit: Unit
  exerciseCount: number
  last: (SetValues & { at: number }) | null
  nextName: string | null
  nextSetsCount: number
  values: SetValues
  onValues: (patch: Partial<SetValues>) => void
  prFlash: boolean
  sound: boolean
  vibration: boolean
  onEditSet: (i: number) => void
  onJump: (i: number) => void
  onAddSet: () => void
  onTechnique: () => void
  onSwap: () => void
  onSkip: () => void
  onNotes: () => void
  onCount: () => void
}

export function ExerciseBlock(p: ExerciseBlockProps) {
  const { info, exercise, kind, unit, values } = p
  const se = info.exercise
  if (!se) return null
  const name = exercise?.name ?? 'Ejercicio'
  const step = loadStep(exercise, unit)
  const muscles = exercise ? [exercise.primary, ...exercise.secondary.filter((m) => m !== exercise.primary)].slice(0, 3) : []
  const reason = se.target.reason
  const showLast = p.last && formatSetValues(p.last, kind, unit) !== '–'
  const lastOfExercise = info.isLastSetOfExercise

  return (
    <section className="wk-block" aria-label={`Ejercicio ${info.exIndex + 1} de ${p.exerciseCount}: ${name}`}>
      <div className="wk-block__eyebrow">
        Ejercicio {info.exIndex + 1} de {p.exerciseCount}
        {se.swappedFrom && <span className="wk-block__swap"> · cambiado</span>}
      </div>
      <h1 className="wk-block__name">{name}</h1>
      {muscles.length > 0 && (
        <div className="wk-chips">
          {muscles.map((m, i) => (
            <Chip key={m} tone={i === 0 ? 'accent' : undefined}>
              {MUSCLE_LABEL[m]}
            </Chip>
          ))}
        </div>
      )}

      <div className="wk-setline">
        <div className="wk-setline__now num" aria-live="polite">
          Serie {info.setNumber} de {info.totalSets}
        </div>
        <div className="wk-setline__target">{targetLine(se, kind)}</div>
      </div>

      {(showLast || reason || p.prFlash) && (
        <div className="wk-hints">
          {p.prFlash && (
            <div className="wk-hint wk-hint--pr" role="status">
              <Trophy size={16} aria-hidden="true" /> ¡Récord personal!
            </div>
          )}
          {showLast && p.last && (
            <div className="wk-hint">
              <History size={16} aria-hidden="true" /> Última vez: {formatSetValues(p.last, kind, unit)}
            </div>
          )}
          {reason && (
            <div className="wk-hint wk-hint--reason">
              <TrendingUp size={16} aria-hidden="true" /> {reason}
            </div>
          )}
        </div>
      )}

      <div className={`wk-steppers ${kind === 'weight_reps' ? 'wk-steppers--two' : ''}`}>
        {kind === 'time' ? (
          <TimeSetPanel
            key={se.sets[info.setIndex]?.id}
            seconds={values.seconds}
            onSeconds={(seconds) => p.onValues({ seconds })}
            sound={p.sound}
            vibration={p.vibration}
          />
        ) : (
          <>
            {kind === 'weight_reps' && (
              <Stepper
                label="Peso"
                unit={unit}
                value={values.weight}
                onChange={(weight) => p.onValues({ weight })}
                step={step}
                max={1000}
                decimals={step % 1 ? 1 : 0}
              />
            )}
            <Stepper label="Reps" unit="repeticiones" value={values.reps} onChange={(reps) => p.onValues({ reps })} step={1} max={100} />
          </>
        )}
      </div>

      <div className="wk-sets">
        <div className="wk-sets__head">
          <span className="section-title">Series</span>
          {kind !== 'time' && (
            <button type="button" className="wk-link" onClick={p.onCount}>
              <Hash size={15} aria-hidden="true" /> Contar reps
            </button>
          )}
        </div>
        <div className="wk-sets__list" role="group" aria-label="Series">
          {se.sets.map((s, i) => {
            const current = i === info.setIndex
            const shown = current && !s.done ? values : s
            const compact = formatSetCompact(shown, kind)
            const cls = ['wk-set', s.done && 'wk-set--done', current && 'wk-set--cur', s.isPR && 'wk-set--pr'].filter(Boolean).join(' ')
            const label = s.done
              ? `Serie ${i + 1} hecha: ${formatSetValues(s, kind, unit)}${s.isPR ? ', récord' : ''}. Toca para editar`
              : current
                ? `Serie ${i + 1}, actual`
                : `Serie ${i + 1}, pendiente. Toca para ir a esta serie`
            return (
              <button
                key={s.id}
                type="button"
                className={cls}
                aria-label={label}
                aria-current={current ? 'step' : undefined}
                onClick={() => (s.done ? p.onEditSet(i) : current ? undefined : p.onJump(i))}
              >
                <span className="wk-set__n">
                  {s.done ? s.isPR ? <Trophy size={12} /> : <Check size={12} strokeWidth={3} /> : i + 1}
                </span>
                <span className="wk-set__v num">{compact}</span>
              </button>
            )
          })}
          <button type="button" className="wk-set wk-set--add" onClick={p.onAddSet} aria-label="Añadir una serie">
            <Plus size={16} aria-hidden="true" />
            <span className="wk-set__v">Serie</span>
          </button>
        </div>
      </div>

      <div className="wk-actions" role="group" aria-label="Acciones del ejercicio">
        <ActionTile icon={<BookOpen size={20} />} label="Técnica" onClick={p.onTechnique} />
        <ActionTile icon={<ArrowLeftRight size={20} />} label="Cambiar" onClick={p.onSwap} />
        <ActionTile icon={<SkipForward size={20} />} label="Saltar" onClick={p.onSkip} />
        <ActionTile icon={<NotebookPen size={20} />} label="Notas" onClick={p.onNotes} dot={!!se.note} />
      </div>

      {se.note && (
        <button type="button" className="wk-note" onClick={p.onNotes}>
          {se.note}
        </button>
      )}

      {lastOfExercise && p.nextName && (
        <div className="wk-after">
          <ChevronRight size={16} aria-hidden="true" />
          <span className="truncate">
            Después: <strong>{p.nextName}</strong>
            {p.nextSetsCount > 0 && ` · ${p.nextSetsCount} ${p.nextSetsCount === 1 ? 'serie' : 'series'}`}
          </span>
        </div>
      )}
    </section>
  )
}

function ActionTile({ icon, label, onClick, dot }: { icon: React.ReactNode; label: string; onClick: () => void; dot?: boolean }) {
  return (
    <button type="button" className="wk-action" onClick={onClick}>
      <span className="wk-action__icon">
        {icon}
        {dot && <i className="wk-action__dot" aria-hidden="true" />}
      </span>
      <span>{label}</span>
    </button>
  )
}
