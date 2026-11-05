import { useState } from 'react'
import { Header, Segmented } from '@/ui'
import { useBodyLogs, useSessions } from '@/store/app'
import { SummaryTab } from './SummaryTab'
import { BodyTab } from './BodyTab'
import { ExercisesTab } from './ExercisesTab'
import { HistoryTab } from './HistoryTab'
import { ExerciseSheet } from './ExerciseSheet'
import './progress.css'

type Tab = 'summary' | 'body' | 'exercises' | 'history'
const TAB_KEY = 'gymfullness:progress:tab'
const TABS: { value: Tab; label: string }[] = [
  { value: 'summary', label: 'Resumen' },
  { value: 'body', label: 'Cuerpo' },
  { value: 'exercises', label: 'Ejercicios' },
  { value: 'history', label: 'Historial' },
]

function readTab(): Tab {
  try {
    const v = sessionStorage.getItem(TAB_KEY)
    if (TABS.some((t) => t.value === v)) return v as Tab
  } catch {
    /* storage unavailable */
  }
  return 'summary'
}

function writeTab(tab: Tab) {
  try {
    sessionStorage.setItem(TAB_KEY, tab)
  } catch {
    /* storage unavailable */
  }
}

export default function ProgressScreen() {
  const [tab, setTab] = useState<Tab>(readTab)
  const [exerciseId, setExerciseId] = useState<string | null>(null)
  const sessions = useSessions()
  const logs = useBodyLogs()

  const change = (t: Tab) => {
    setTab(t)
    writeTab(t)
  }

  return (
    <main className="screen pg">
      <Header title="Progreso" />
      <div className="pg-seg">
        <Segmented value={tab} options={TABS} onChange={change} label="Sección de progreso" />
      </div>
      <div key={tab} className="pg-pane">
        {tab === 'summary' && <SummaryTab sessions={sessions} onOpenExercise={setExerciseId} />}
        {tab === 'body' && <BodyTab logs={logs} />}
        {tab === 'exercises' && <ExercisesTab sessions={sessions} onOpenExercise={setExerciseId} />}
        {tab === 'history' && <HistoryTab sessions={sessions} />}
      </div>
      <ExerciseSheet exerciseId={exerciseId} sessions={sessions} onClose={() => setExerciseId(null)} />
    </main>
  )
}
