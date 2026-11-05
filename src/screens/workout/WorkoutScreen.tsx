import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { Check, ChevronDown, Ellipsis, Plus } from 'lucide-react'
import { Button, IconButton, toast } from '@/ui'
import { getExercise, useApp, useSessions, allExercises } from '@/store/app'
import { getCursorInfo } from '@/lib/workout/engine'
import { useElapsed } from '@/lib/workout/useElapsed'
import { useWakeLock } from '@/lib/workout/useWakeLock'
import { cue } from '@/lib/audio'
import { formatClock } from '@/lib/date'
import { suggestAddOns } from '@/lib/recommend'
import { muscleSets } from '@/lib/stats'
import { formatParsed, parsedToLogInput, unlockMediaOnFirstGesture, type ParsedCommand, type ParsedSet } from '@/lib/voice'
import type { LogSetInput, SetLog, SetSource, VoiceContext, WorkoutSession } from '@/lib/types'
import { ExercisePicker } from '@/screens/exercises/ExercisePicker'
import { ExerciseBlock } from './ExerciseBlock'
import { RestView } from './RestView'
import { CompleteView, NothingToDo } from './CompleteView'
import { RepCounter } from './RepCounter'
import { TechniqueSheet } from './TechniqueSheet'
import { SwapSheet, useAlternatives } from './SwapSheet'
import { OverviewSheet } from './OverviewSheet'
import { EditSetSheet } from './EditSetSheet'
import { DiscardSheet, FinishSheet, MenuSheet, NotesSheet } from './SessionSheets'
import { WorkoutBottom } from './VoiceDock'
import { useVoice } from './useVoice'
import {
  kindOfExercise,
  lastDoneSet,
  lastPerformance,
  loggedSets,
  recentSummaryFor,
  remainingSets,
  formatSetValues,
  segments,
  type SetValues,
} from './helpers'
import './workout.css'

type Sheet = null | 'menu' | 'technique' | 'swap' | 'swapPicker' | 'add' | 'overview' | 'finish' | 'discard' | 'notes'
type Edits = { key: string } & Partial<SetValues>

const keyOf = (s: WorkoutSession): string => {
  const info = getCursorInfo(s)
  const set = info.exercise?.sets[info.setIndex]
  return info.exercise && set ? `${info.exercise.id}:${set.id}` : ''
}

/** Values shown in the steppers: edits made to the current set, else the set's own prefill. */
function resolveValues(session: WorkoutSession, edits: Edits): SetValues {
  const info = getCursorInfo(session)
  const se = info.exercise
  const cur = se?.sets[info.setIndex]
  const e = edits.key === keyOf(session) ? edits : null
  const pick = <K extends keyof SetValues>(k: K, fallback: SetValues[K]): SetValues[K] => (e && e[k] !== undefined ? (e[k] as SetValues[K]) : fallback)
  return {
    weight: pick('weight', cur?.weight ?? null),
    reps: pick('reps', cur?.reps ?? null),
    seconds: pick('seconds', cur?.seconds ?? se?.target.targetSeconds ?? null),
  }
}

export default function WorkoutScreen() {
  const [, navigate] = useLocation()
  const session = useApp((s) => s.activeSession)
  const finishing = useRef(false)

  useEffect(() => {
    if (!session && !finishing.current) navigate('/', { replace: true })
  }, [session, navigate])

  if (!session) return null
  return <Workout session={session} finishing={finishing} />
}

function Workout({ session, finishing }: { session: WorkoutSession; finishing: React.MutableRefObject<boolean> }) {
  const [, navigate] = useLocation()
  const settings = useApp((s) => s.settings)
  const profile = useApp((s) => s.profile)
  const history = useSessions()

  const [sheet, setSheet] = useState<Sheet>(null)
  const [editIdx, setEditIdx] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [prFlash, setPrFlash] = useState(false)
  const [edits, setEdits] = useState<Edits>({ key: '' })
  const editsRef = useRef(edits)
  editsRef.current = edits
  const prTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useWakeLock(settings.keepAwake)
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])
  useEffect(() => unlockMediaOnFirstGesture(), [])
  useEffect(() => () => clearTimeout(prTimer.current), [])

  const elapsed = useElapsed(session.startedAt)
  const info = useMemo(() => getCursorInfo(session), [session])
  const se = info.exercise
  const exercise = se ? getExercise(se.exerciseId) : undefined
  const kind = kindOfExercise(exercise, se ?? undefined)
  const values = useMemo(() => resolveValues(session, edits), [session, edits])
  const resting = !!session.rest
  const exerciseCount = session.exercises.length
  const logged = loggedSets(session)
  const segs = useMemo(() => segments(session), [session])
  const last = useMemo(
    () => (se ? lastPerformance(history, se.exerciseId, session.unit, session.id) : null),
    [history, se, session.unit, session.id],
  )
  const sessionIds = useMemo(() => session.exercises.map((e) => e.exerciseId), [session.exercises])
  const swapOptions = useAlternatives(se?.exerciseId, profile.equipment, sessionIds)
  const addOnIds = useMemo(() => {
    if (sheet !== 'add') return []
    return suggestAddOns(sessionIds, muscleSets(history, getExercise, 7), allExercises(), profile.equipment, 6).map((e) => e.id)
  }, [sheet, sessionIds, history, profile.equipment])

  const patchValues = useCallback((patch: Partial<SetValues>) => {
    const s = useApp.getState().activeSession
    if (!s) return
    const key = keyOf(s)
    setEdits((prev) => ({ ...(prev.key === key ? prev : { key }), ...patch }))
  }, [])

  /* ------------------------------ actions ------------------------------ */

  const undo = useCallback(() => {
    useApp.getState().undoLastSet()
    setPrFlash(false)
  }, [])

  const logCurrent = useCallback(
    (over: Partial<SetValues> = {}, source: SetSource = 'tap') => {
      const st = useApp.getState()
      const s = st.activeSession
      if (!s) return
      const cinfo = getCursorInfo(s)
      const cse = cinfo.exercise
      if (!cse) return
      const ex = getExercise(cse.exerciseId)
      const k = kindOfExercise(ex, cse)
      const v = { ...resolveValues(s, editsRef.current), ...over }
      const input: LogSetInput = { source }
      if (k === 'time') input.seconds = v.seconds
      else {
        if (k === 'weight_reps') input.weight = v.weight
        input.reps = v.reps
      }
      const res = st.logSet(input)
      if (!res) return
      const sets = res.session.exercises[cinfo.exIndex]?.sets ?? []
      let idx = cinfo.setIndex
      sets.forEach((x, i) => {
        if (x.done && (x.completedAt ?? 0) >= (sets[idx]?.completedAt ?? 0)) idx = i
      })
      const logged: SetLog | undefined = sets[idx]
      const label = logged ? formatSetValues(logged, k, s.unit) : ''
      const opts = { sound: settings.sounds, vibration: settings.vibration }
      if (res.isPR) {
        cue('pr', opts)
        toast.pr(`Récord · ${ex?.name ?? 'Ejercicio'} · ${label}`, { actionLabel: 'Deshacer', onAction: undo })
        setPrFlash(true)
        clearTimeout(prTimer.current)
        prTimer.current = setTimeout(() => setPrFlash(false), 5000)
      } else {
        cue('success', opts)
        toast.success(`Serie ${idx + 1} · ${label}`, { actionLabel: 'Deshacer', onAction: undo })
        setPrFlash(false)
      }
      if (!res.workoutCompleted && settings.autoStartRest && res.restSec > 0) st.startRest(res.restSec)
    },
    [settings.sounds, settings.vibration, settings.autoStartRest, undo],
  )

  const requestFinish = useCallback(() => setSheet('finish'), [])

  const doFinish = () => {
    finishing.current = true
    setSheet(null)
    const done = useApp.getState().finishWorkout()
    if (done) navigate(`/summary/${done.id}`, { replace: true })
    else {
      toast.show('No había series que guardar.')
      navigate('/', { replace: true })
    }
  }

  const doDiscard = () => {
    finishing.current = true
    setSheet(null)
    useApp.getState().discardWorkout()
    navigate('/', { replace: true })
  }

  const skipCurrent = () => {
    const exIndex = getCursorInfo(useApp.getState().activeSession ?? session).exIndex
    useApp.getState().skipExercise(exIndex)
    toast.show('Ejercicio saltado', { actionLabel: 'Deshacer', onAction: () => useApp.getState().setCursor(exIndex) })
  }

  const swapTo = (id: string) => {
    useApp.getState().swapExercise(info.exIndex, id)
    setSheet(null)
    toast.show(`Cambiado a ${getExercise(id)?.name ?? 'otro ejercicio'}`)
  }

  const addExercise = (id: string) => {
    const wasFinished = info.isFinished
    useApp.getState().addExercise(id)
    setSheet(null)
    if (wasFinished) {
      const n = useApp.getState().activeSession?.exercises.length ?? 0
      if (n > 0) useApp.getState().setCursor(n - 1)
    }
    toast.success(`${getExercise(id)?.name ?? 'Ejercicio'} añadido`)
  }

  const saveNote = (text: string) => {
    const st = useApp.getState()
    const s = st.activeSession
    if (!s) return
    const exIndex = getCursorInfo(s).exIndex
    st.patchActive({
      exercises: s.exercises.map((e, i) => {
        if (i !== exIndex) return e
        const copy = { ...e }
        if (text) copy.note = text
        else delete copy.note
        return copy
      }),
    })
  }

  /* ------------------------------ voice ------------------------------ */

  const runCommand = (cmd: ParsedCommand) => {
    const st = useApp.getState()
    const s = st.activeSession
    if (!s) return
    const cinfo = getCursorInfo(s)
    const hint = (msg?: string) => toast.show(msg ?? formatParsed(cmd, s.unit), { duration: 1600 })
    switch (cmd.command) {
      case 'next':
        if (s.rest) {
          st.endRest()
          hint('Descanso omitido')
        } else if (cinfo.isFinished) hint('Ya terminaste. Toca «Ver resumen».')
        else logCurrent({}, 'voice')
        break
      case 'repeat': {
        if (s.rest) st.endRest()
        const prev = cinfo.exercise ? lastDoneSet(cinfo.exercise) : null
        logCurrent(prev ? { weight: prev.weight, reps: prev.reps, seconds: prev.seconds ?? null } : {}, 'voice')
        break
      }
      case 'skip':
        skipCurrent()
        break
      case 'undo':
        undo()
        hint('Serie deshecha')
        break
      case 'rest':
        st.startRest(cmd.seconds ?? cinfo.exercise?.target.restSec ?? st.settings.defaultRestSec)
        hint()
        break
      case 'skip_rest':
        if (s.rest) st.endRest()
        hint('Descanso omitido')
        break
      case 'add_time':
        if (s.rest) {
          st.adjustRest(cmd.seconds ?? 30)
          hint()
        } else hint('No hay un descanso en curso')
        break
      case 'finish':
        requestFinish()
        break
      case 'technique':
        setSheet('technique')
        break
      case 'swap':
        setSheet('swap')
        break
    }
  }

  const voice = useVoice({
    lang: settings.speechLang,
    haptics: settings.vibration,
    unit: session.unit,
    getContext: (): VoiceContext => {
      const s = useApp.getState().activeSession ?? session
      const cinfo = getCursorInfo(s)
      const v = resolveValues(s, editsRef.current)
      return {
        lastWeight: v.weight,
        lastReps: v.reps,
        unit: s.unit,
        kind: kindOfExercise(cinfo.exercise ? getExercise(cinfo.exercise.exerciseId) : undefined, cinfo.exercise ?? undefined),
      }
    },
    onSet: (p: ParsedSet) => {
      const inp = parsedToLogInput(p, session.unit)
      const over: Partial<SetValues> = {}
      if (inp.weight != null) over.weight = inp.weight
      if (inp.reps != null) over.reps = inp.reps
      if (inp.seconds != null) over.seconds = inp.seconds
      logCurrent(over, voiceRef.current?.hold.supported === false ? 'text' : 'voice')
    },
    onEdit: (p: ParsedSet) => {
      const inp = parsedToLogInput(p, session.unit)
      const patch: Partial<SetValues> = {}
      if (inp.weight != null) patch.weight = inp.weight
      if (inp.reps != null) patch.reps = inp.reps
      if (inp.seconds != null) patch.seconds = inp.seconds
      patchValues(patch)
    },
    onCommand: runCommand,
    onUnknown: () => toast.show('No te entendí. Prueba «80 por 10» o «siguiente».', { duration: 2400 }),
    onError: (message) => toast.error(message),
  })
  const voiceRef = useRef(voice)
  voiceRef.current = voice

  /* ------------------------------ render ------------------------------ */

  const empty = exerciseCount === 0
  const finished = !empty && info.isFinished
  const nothingDone = finished && logged === 0
  const next = info.next && info.next.exIndex !== info.exIndex ? info.next : null
  const nextName = next ? (getExercise(next.exercise.exerciseId)?.name ?? null) : null

  let primary: React.ReactNode
  if (resting) {
    primary = (
      <Button variant="rest" size="xl" block onClick={() => useApp.getState().endRest()}>
        Saltar descanso
      </Button>
    )
  } else if (empty || nothingDone) {
    primary = (
      <Button variant="primary" size="xl" block icon={<Plus size={28} />} onClick={() => setSheet('add')}>
        Añadir ejercicio
      </Button>
    )
  } else if (finished) {
    primary = (
      <Button variant="primary" size="xl" block onClick={doFinish}>
        Ver resumen
      </Button>
    )
  } else {
    primary = (
      <Button variant="primary" size="xl" block icon={<Check size={30} strokeWidth={3} />} onClick={() => logCurrent()}>
        Serie hecha
      </Button>
    )
  }

  return (
    <main className="screen screen--full wk">
      <header className="wk-top">
        <IconButton label="Minimizar entreno" variant="glass" onClick={() => navigate('/')}>
          <ChevronDown size={24} />
        </IconButton>
        <div className="wk-top__mid">
          <div className="wk-top__time num" role="timer" aria-label="Tiempo de entreno">
            {formatClock(elapsed)}
          </div>
          <div className="wk-top__name truncate">{session.name}</div>
        </div>
        <IconButton label="Más opciones" variant="glass" onClick={() => setSheet('menu')}>
          <Ellipsis size={22} />
        </IconButton>
      </header>

      {exerciseCount > 0 && (
        <button type="button" className="wk-seg" onClick={() => setSheet('overview')} aria-label={`Progreso: ${info.doneSets} de ${info.totalSessionSets} series. Ver todos los ejercicios`}>
          {segs.map((g, i) => (
            <span key={i} className={`wk-seg__item ${g.current ? 'wk-seg__item--cur' : ''} ${g.skipped ? 'wk-seg__item--skip' : ''}`}>
              <span style={{ width: `${Math.round(g.fill * 100)}%` }} />
            </span>
          ))}
        </button>
      )}

      <div className="wk-content">
        {resting ? (
          <RestView session={session} />
        ) : empty ? (
          <NothingToDo onAdd={() => setSheet('add')} onDiscard={() => setSheet('discard')} />
        ) : nothingDone ? (
          <NothingToDo onAdd={() => setSheet('add')} onDiscard={() => setSheet('discard')} />
        ) : finished ? (
          <CompleteView
            logged={logged}
            durationSec={elapsed}
            onAdd={() => setSheet('add')}
            onOverview={() => setSheet('overview')}
          />
        ) : (
          <ExerciseBlock
            info={info}
            exercise={exercise}
            kind={kind}
            unit={session.unit}
            exerciseCount={exerciseCount}
            last={last}
            nextName={nextName}
            nextSetsCount={next?.exercise.sets.length ?? 0}
            values={values}
            onValues={patchValues}
            prFlash={prFlash}
            sound={settings.sounds}
            vibration={settings.vibration}
            onEditSet={(i) => setEditIdx(i)}
            onJump={(i) => useApp.getState().setCursor(info.exIndex, i)}
            onAddSet={() => useApp.getState().addSet(info.exIndex)}
            onTechnique={() => setSheet('technique')}
            onSwap={() => setSheet('swap')}
            onSkip={skipCurrent}
            onNotes={() => setSheet('notes')}
            onCount={() => setCounting(true)}
          />
        )}
      </div>

      <WorkoutBottom voice={voice}>{primary}</WorkoutBottom>

      {counting && se && (
        <RepCounter
          title={exercise?.name ?? 'Ejercicio'}
          subtitle={`Serie ${info.setNumber} de ${info.totalSets}`}
          vibration={settings.vibration}
          onClose={() => setCounting(false)}
          onDone={(reps) => {
            patchValues({ reps })
            setCounting(false)
          }}
        />
      )}

      <MenuSheet
        open={sheet === 'menu'}
        onClose={() => setSheet(null)}
        canRest={!resting && !empty}
        onAdd={() => setSheet('add')}
        onOverview={() => setSheet('overview')}
        onRest={() => {
          setSheet(null)
          useApp.getState().startRest(se?.target.restSec ?? settings.defaultRestSec)
        }}
        onFinish={requestFinish}
        onDiscard={() => setSheet('discard')}
      />
      <TechniqueSheet
        key={se?.exerciseId}
        open={sheet === 'technique'}
        onClose={() => setSheet(null)}
        exercise={exercise}
        profile={profile}
        recentSummary={recentSummaryFor(last, exercise, session.unit)}
      />
      <SwapSheet
        open={sheet === 'swap'}
        onClose={() => setSheet(null)}
        exerciseName={exercise?.name ?? 'este ejercicio'}
        options={swapOptions}
        onPick={swapTo}
        onSearch={() => setSheet('swapPicker')}
      />
      <ExercisePicker
        open={sheet === 'swapPicker'}
        onClose={() => setSheet(null)}
        onPick={swapTo}
        title="Cambiar ejercicio"
        excludeIds={sessionIds}
        recommendedIds={swapOptions.map((e) => e.id)}
      />
      <ExercisePicker
        open={sheet === 'add'}
        onClose={() => setSheet(null)}
        onPick={addExercise}
        title="Añadir ejercicio"
        excludeIds={sessionIds}
        recommendedIds={addOnIds}
      />
      <OverviewSheet
        open={sheet === 'overview'}
        onClose={() => setSheet(null)}
        session={session}
        onJump={(i) => {
          useApp.getState().setCursor(i)
          setSheet(null)
        }}
        onMove={(a, b) => useApp.getState().moveExercise(a, b)}
        onSkip={(i) => useApp.getState().skipExercise(i)}
        onAdd={() => setSheet('add')}
      />
      <EditSetSheet
        session={session}
        exIndex={info.exIndex}
        setIndex={editIdx}
        onClose={() => setEditIdx(null)}
        onSave={(e, i, patch) => useApp.getState().updateActiveSet(e, i, patch)}
        onDelete={(e, i) => useApp.getState().removeSet(e, i)}
      />
      <FinishSheet
        open={sheet === 'finish'}
        onClose={() => setSheet(null)}
        remaining={remainingSets(session)}
        logged={logged}
        onFinish={doFinish}
        onDiscard={doDiscard}
      />
      <DiscardSheet open={sheet === 'discard'} onClose={() => setSheet(null)} logged={logged} onDiscard={doDiscard} />
      <NotesSheet
        open={sheet === 'notes'}
        onClose={() => setSheet(null)}
        title={exercise?.name ?? 'Ejercicio'}
        initial={se?.note ?? ''}
        onSave={saveNote}
      />
    </main>
  )
}
