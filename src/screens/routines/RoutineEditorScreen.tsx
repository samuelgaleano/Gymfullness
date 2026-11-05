import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useRoute } from 'wouter'
import { ArrowDown, ArrowUp, Check, Minus, Play, Plus, Trash2, Dumbbell } from 'lucide-react'
import type { Goal, Level, Routine, RoutineItem } from '@/lib/types'
import { MUSCLE_LABEL, EQUIPMENT_LABEL } from '@/data/exercises'
import { uid } from '@/lib/id'
import { formatClock } from '@/lib/date'
import { muscleSets } from '@/lib/stats'
import { suggestAddOns } from '@/lib/recommend'
import { allExercises, getExercise, useApp, useRoutines } from '@/store/app'
import { setNavGuard } from '@/ui/navGuard'
import { Button, Card, EmptyState, Field, IconButton, Sheet, TopBar, toast } from '@/ui'
import { ExercisePicker } from '../exercises/ExercisePicker'
import { LIMITS, draftSignature, insertAt, itemFromExercise, moveItem, patchItem, toDraft, type Draft } from './editorLogic'
import { estimateMinutes, exerciseCountLabel, useStartWorkout } from './routineUtils'
import './routines.css'

function MiniStepper({
  label,
  ariaLabel,
  value,
  onChange,
  step = 1,
  min,
  max,
  format,
}: {
  label: string
  ariaLabel: string
  value: number
  onChange: (v: number) => void
  step?: number
  min: number
  max: number
  format?: (v: number) => string
}) {
  const bump = (dir: 1 | -1) => {
    onChange(Math.min(max, Math.max(min, value + dir * step)))
    if (navigator.vibrate) navigator.vibrate(6)
  }
  return (
    <div className="rt-mini">
      <span className="rt-mini__label">{label}</span>
      <div className="rt-mini__ctrl" role="group" aria-label={ariaLabel}>
        <button type="button" className="rt-mini__btn" aria-label={`Menos ${ariaLabel}`} disabled={value <= min} onClick={() => bump(-1)}>
          <Minus size={18} />
        </button>
        <span className="rt-mini__value num" aria-live="polite">
          {format ? format(value) : value}
        </span>
        <button type="button" className="rt-mini__btn" aria-label={`Más ${ariaLabel}`} disabled={value >= max} onClick={() => bump(1)}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}

function ItemCard({
  item,
  index,
  total,
  onChange,
  onMove,
  onRemove,
}: {
  item: RoutineItem
  index: number
  total: number
  onChange: (next: RoutineItem) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const ex = getExercise(item.exerciseId)
  const name = ex?.name ?? 'Ejercicio no disponible'
  const timed = ex?.kind === 'time'
  const set = (field: Parameters<typeof patchItem>[1]) => (v: number) => onChange(patchItem(item, field, v))
  return (
    <Card className="rt-item" aria-label={`${index + 1}. ${name}`}>
      <div className="rt-item__head">
        <div className="rt-item__title">
          <span className="rt-item__name">
            {index + 1}. {name}
          </span>
          {ex && (
            <span className="rt-item__sub">
              {MUSCLE_LABEL[ex.primary]} · {ex.equipment.map((e) => EQUIPMENT_LABEL[e]).join(', ')}
            </span>
          )}
        </div>
        <div className="rt-item__tools">
          <IconButton label={`Subir ${name}`} size="sm" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp size={18} />
          </IconButton>
          <IconButton label={`Bajar ${name}`} size="sm" disabled={index === total - 1} onClick={() => onMove(1)}>
            <ArrowDown size={18} />
          </IconButton>
          <IconButton label={`Quitar ${name}`} size="sm" onClick={onRemove}>
            <Trash2 size={18} />
          </IconButton>
        </div>
      </div>
      <div className="rt-item__grid">
        <MiniStepper label="Series" ariaLabel={`series de ${name}`} value={item.sets} min={LIMITS.sets.min} max={LIMITS.sets.max} onChange={set('sets')} />
        {timed ? (
          <MiniStepper
            label="Segundos"
            ariaLabel={`segundos de ${name}`}
            value={item.targetSeconds ?? 30}
            step={LIMITS.seconds.step}
            min={LIMITS.seconds.min}
            max={LIMITS.seconds.max}
            onChange={set('targetSeconds')}
          />
        ) : (
          <MiniStepper label="Reps mín." ariaLabel={`repeticiones mínimas de ${name}`} value={item.repsMin} min={LIMITS.reps.min} max={LIMITS.reps.max} onChange={set('repsMin')} />
        )}
        <MiniStepper
          label="Descanso"
          ariaLabel={`descanso de ${name}`}
          value={item.restSec}
          step={LIMITS.rest.step}
          min={LIMITS.rest.min}
          max={LIMITS.rest.max}
          format={formatClock}
          onChange={set('restSec')}
        />
        {!timed && (
          <MiniStepper label="Reps máx." ariaLabel={`repeticiones máximas de ${name}`} value={item.repsMax} min={LIMITS.reps.min} max={LIMITS.reps.max} onChange={set('repsMax')} />
        )}
      </div>
    </Card>
  )
}

function Editor({ routine, isNew }: { routine: Routine; isNew: boolean }) {
  const [, navigate] = useLocation()
  const profile = useApp((s) => s.profile)
  const plan = useApp((s) => s.plan)
  const start = useStartWorkout()
  const goal: Goal = plan?.goal ?? profile.goal ?? 'muscle'
  const level: Level = plan?.level ?? profile.level ?? 'beginner'

  const baseline = useRef(draftSignature(toDraft(routine)))
  const [draft, setDraft] = useState<Draft>(() => toDraft(routine))
  const [pickerOpen, setPickerOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [nameError, setNameError] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  const saved = useRef(false)

  const dirty = draftSignature(draft) !== baseline.current

  // Warn on tab close / reload with unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  // Tab-bar navigation with unsaved edits: ask first, then continue to the tapped tab.
  const pendingHref = useRef<string | null>(null)
  useEffect(() => {
    if (!dirty || saved.current) return
    setNavGuard((href) => {
      pendingHref.current = href
      setConfirmLeave(true)
      return false
    })
    return () => setNavGuard(null)
  }, [dirty])

  const stay = () => {
    pendingHref.current = null
    setConfirmLeave(false)
  }
  const goBack = () => {
    const href = pendingHref.current
    pendingHref.current = null
    navigate(href ?? '/routines')
  }
  const onBack = () => (dirty && !saved.current ? setConfirmLeave(true) : goBack())

  const setItems = useCallback((fn: (items: RoutineItem[]) => RoutineItem[]) => setDraft((d) => ({ ...d, items: fn(d.items) })), [])

  const removeItem = (index: number) => {
    const removed = draft.items[index]
    setItems((items) => items.filter((_, i) => i !== index))
    toast.show('Ejercicio quitado', {
      actionLabel: 'Deshacer',
      onAction: () => setItems((items) => (items.some((x) => x.id === removed.id) ? items : insertAt(items, index, removed))),
    })
  }

  const addExercise = (exerciseId: string) => {
    const ex = getExercise(exerciseId)
    if (!ex) return
    setItems((items) => [...items, itemFromExercise(ex, goal, level, items.length < 2 && ex.isCompound)])
  }

  const persist = (): boolean => {
    const name = draft.name.trim()
    if (!name) {
      setNameError(true)
      nameRef.current?.focus()
      toast.error('Ponle un nombre a la rutina')
      return false
    }
    if (draft.items.length === 0) {
      toast.error('Añade al menos un ejercicio')
      return false
    }
    const focus = draft.focus.trim()
    const next: Routine = { ...routine, name, focus: focus || undefined, items: draft.items, updatedAt: Date.now() }
    useApp.getState().upsertRoutine(next)
    baseline.current = draftSignature(toDraft({ name, focus, items: draft.items }))
    saved.current = true
    return true
  }

  const onSave = () => {
    if (!persist()) return
    toast.success('Rutina guardada')
    goBack()
  }

  const onStart = () => {
    if (dirty || isNew) {
      if (!persist()) return
    }
    start(routine.id)
  }

  const onDelete = () => {
    const st = useApp.getState()
    const planBefore = st.plan
    st.deleteRoutine(routine.id)
    saved.current = true
    toast.show('Rutina eliminada', {
      actionLabel: 'Deshacer',
      onAction: () => {
        const cur = useApp.getState()
        cur.upsertRoutine({ ...routine, deleted: false })
        if (planBefore && cur.plan) cur.setPlan({ ...cur.plan, routineIds: planBefore.routineIds })
      },
    })
    goBack()
  }

  // Suggestions: muscles that are lagging this week, equipment-aware.
  const recommendedIds = useMemo(() => {
    if (!pickerOpen) return []
    const st = useApp.getState()
    const weekly = muscleSets(st.sessions.filter((s) => !s.deleted && s.endedAt), getExercise, 7)
    return suggestAddOns(
      draft.items.map((i) => i.exerciseId),
      weekly,
      allExercises(),
      profile.equipment,
      5,
    ).map((e) => e.id)
  }, [pickerOpen, draft.items, profile.equipment])

  const excludeIds = useMemo(() => draft.items.map((i) => i.exerciseId), [draft.items])
  const minutes = estimateMinutes({ items: draft.items })

  return (
    <main className="screen">
      <TopBar
        title={isNew ? 'Nueva rutina' : 'Editar rutina'}
        onBack={onBack}
        right={
          !isNew && (
            <IconButton label="Eliminar rutina" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={20} />
            </IconButton>
          )
        }
      />
      <div className="rt-ed">
        <div className="rt-ed__fields">
          <Field label="Nombre" htmlFor="rt-name">
            <input
              id="rt-name"
              ref={nameRef}
              className="input rt-ed__title-input"
              placeholder="Ej. Día A · Empuje"
              maxLength={50}
              autoComplete="off"
              aria-invalid={nameError && !draft.name.trim()}
              style={nameError && !draft.name.trim() ? { borderColor: 'var(--danger)' } : undefined}
              value={draft.name}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            />
          </Field>
          <Field label="Enfoque (opcional)" htmlFor="rt-focus">
            <input
              id="rt-focus"
              className="input"
              placeholder="Ej. Pecho · Hombros · Tríceps"
              maxLength={60}
              autoComplete="off"
              value={draft.focus}
              onChange={(e) => setDraft((d) => ({ ...d, focus: e.target.value }))}
            />
          </Field>
        </div>

        <section className="stack" aria-label="Ejercicios">
          <div className="row-between">
            <h2 className="section-title">Ejercicios</h2>
            {draft.items.length > 0 && (
              <span className="faint" style={{ fontSize: 'var(--fs-sm)' }}>
                {exerciseCountLabel(draft.items.length)} · ~{minutes} min
              </span>
            )}
          </div>

          {draft.items.length === 0 && (
            <Card>
              <EmptyState icon={<Dumbbell size={28} />} title="Sin ejercicios todavía" text="Añade el primero y ajusto series y repeticiones según tu objetivo." />
            </Card>
          )}

          {draft.items.map((it, i) => (
            <ItemCard
              key={it.id}
              item={it}
              index={i}
              total={draft.items.length}
              onChange={(next) => setItems((items) => items.map((x) => (x.id === next.id ? next : x)))}
              onMove={(dir) => setItems((items) => moveItem(items, i, i + dir))}
              onRemove={() => removeItem(i)}
            />
          ))}

          <Button variant="glass" size="lg" block className="rt-add" icon={<Plus size={20} />} onClick={() => setPickerOpen(true)}>
            Añadir ejercicio
          </Button>
        </section>
      </div>

      <div className="rt-ed__bar glass">
        <Button variant="glass" size="lg" icon={<Play size={18} fill="currentColor" />} disabled={draft.items.length === 0} onClick={onStart}>
          Empezar
        </Button>
        <Button variant="primary" size="lg" icon={<Check size={20} />} onClick={onSave}>
          Guardar
        </Button>
      </div>

      <ExercisePicker open={pickerOpen} onClose={() => setPickerOpen(false)} onPick={addExercise} excludeIds={excludeIds} recommendedIds={recommendedIds} />

      <Sheet
        open={confirmLeave}
        onClose={stay}
        title="¿Salir sin guardar?"
        footer={
          <div className="rt-sheet-actions">
            <Button variant="primary" size="lg" block onClick={stay}>
              Seguir editando
            </Button>
            <Button
              variant="danger"
              size="lg"
              block
              onClick={() => {
                saved.current = true
                setConfirmLeave(false)
                goBack()
              }}
            >
              Descartar cambios
            </Button>
          </div>
        }
      >
        <p className="muted">Tienes cambios sin guardar en esta rutina. Si sales ahora, se perderán.</p>
      </Sheet>

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="¿Eliminar esta rutina?"
        footer={
          <div className="rt-sheet-actions">
            <Button variant="danger" size="lg" block onClick={onDelete}>
              Eliminar rutina
            </Button>
            <Button variant="glass" size="lg" block onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        }
      >
        <p className="muted">
          “{routine.name || 'Sin nombre'}” se quitará de tus rutinas y de tu plan. Tu historial de entrenos se conserva.
        </p>
      </Sheet>
    </main>
  )
}

export default function RoutineEditorScreen() {
  const [, params] = useRoute('/routines/:id')
  const [, navigate] = useLocation()
  const routines = useRoutines()
  const id = params?.id ?? 'new'
  const isNew = id === 'new'
  const [fresh] = useState<Routine>(() => ({ id: uid('r_'), name: '', items: [], createdAt: Date.now(), updatedAt: Date.now() }))
  const existing = isNew ? undefined : routines.find((r) => r.id === id)

  if (!isNew && !existing) {
    return (
      <main className="screen">
        <TopBar onBack={() => navigate('/routines')} />
        <EmptyState
          icon={<Dumbbell size={28} />}
          title="No encontramos esta rutina"
          text="Puede que la hayas eliminado."
          action={
            <Button variant="primary" onClick={() => navigate('/routines')}>
              Ver mis rutinas
            </Button>
          }
        />
      </main>
    )
  }
  const routine = existing ?? fresh
  return <Editor key={routine.id} routine={routine} isNew={isNew} />
}
