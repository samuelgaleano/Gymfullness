import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import { Button, Stepper } from '@/ui'
import { cue } from '@/lib/audio'
import { clock } from './helpers'

/**
 * Time-based sets (plank, holds, cardio): a built-in countdown from the target seconds.
 * Stopping early records the elapsed time; reaching 0 records the full target.
 */
export function TimeSetPanel({
  seconds,
  onSeconds,
  sound,
  vibration,
}: {
  seconds: number | null
  onSeconds: (n: number | null) => void
  sound: boolean
  vibration: boolean
}) {
  const goal = seconds && seconds > 0 ? seconds : 30
  const [run, setRun] = useState<{ startedAt: number; goal: number } | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const cb = useRef({ onSeconds, sound, vibration })
  cb.current = { onSeconds, sound, vibration }

  useEffect(() => {
    if (!run) return
    const id = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (t - run.startedAt >= run.goal * 1000) {
        clearInterval(id)
        setRun(null)
        cb.current.onSeconds(run.goal)
        cue('end', { sound: cb.current.sound, vibration: cb.current.vibration })
      }
    }, 200)
    return () => clearInterval(id)
  }, [run])

  const elapsed = run ? Math.max(0, (now - run.startedAt) / 1000) : 0
  const remaining = run ? Math.max(0, Math.ceil(run.goal - elapsed)) : goal

  const start = () => {
    const t = Date.now()
    setNow(t)
    setRun({ startedAt: t, goal })
    cue('go', { sound, vibration })
  }
  const stop = () => {
    if (!run) return
    onSeconds(Math.max(1, Math.round((Date.now() - run.startedAt) / 1000)))
    setRun(null)
  }

  return (
    <div className="wk-time">
      <div className={`wk-time__clock num ${run ? 'wk-time__clock--run' : ''}`} aria-live="off">
        {clock(remaining)}
      </div>
      {run ? (
        <Button variant="glass" size="lg" icon={<Square size={20} />} onClick={stop}>
          Parar
        </Button>
      ) : (
        <Button variant="glass" size="lg" icon={<Play size={20} />} onClick={start}>
          Iniciar cuenta atrás
        </Button>
      )}
      <div className="wk-time__stepper">
        <Stepper label="Tiempo" unit="segundos" value={seconds} onChange={onSeconds} step={5} min={0} max={3600} />
      </div>
    </div>
  )
}
