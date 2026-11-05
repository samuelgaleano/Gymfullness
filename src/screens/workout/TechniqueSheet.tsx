import { useRef, useState } from 'react'
import { ExternalLink, Send, Sparkles } from 'lucide-react'
import { Chip, IconButton, Sheet, Spinner } from '@/ui'
import { askCoach, type CoachAnswer } from '@/lib/coach'
import type { Exercise, Profile } from '@/lib/types'
import { videoUrl } from './helpers'

const QUICK = ['¿Cómo respiro?', '¿Qué errores evito?', '¿Cuánto peso uso?', 'Me duele…']

export function TechniqueSheet({
  open,
  onClose,
  exercise,
  profile,
  recentSummary,
}: {
  open: boolean
  onClose: () => void
  exercise: Exercise | undefined
  profile: Profile
  recentSummary?: string
}) {
  return (
    <Sheet open={open} onClose={onClose} title={exercise?.name ?? 'Técnica'}>
      {exercise ? (
        <Body exercise={exercise} profile={profile} recentSummary={recentSummary} />
      ) : (
        <p className="muted">No hay información de técnica para este ejercicio.</p>
      )}
    </Sheet>
  )
}

function Body({ exercise, profile, recentSummary }: { exercise: Exercise; profile: Profile; recentSummary?: string }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [answer, setAnswer] = useState<(CoachAnswer & { question: string }) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    setBusy(true)
    setAnswer(null)
    try {
      const res = await askCoach(text, { exercise, profile, recentSummary })
      setAnswer({ ...res, question: text })
    } finally {
      setBusy(false)
    }
  }

  const pickQuick = (text: string) => {
    if (text.endsWith('…')) {
      setQ(text.replace('…', ' '))
      inputRef.current?.focus()
      return
    }
    setQ(text)
    void ask(text)
  }

  const offline = typeof navigator !== 'undefined' && navigator.onLine === false

  return (
    <div className="wk-tech">
      <Section title="Preparación" items={exercise.setup} />
      <Section title="Claves" items={exercise.cues} />
      <Section title="Errores comunes" items={exercise.mistakes} tone="warn" />
      {exercise.breathing && (
        <div className="wk-tech__sec">
          <h3 className="wk-tech__h">Respiración</h3>
          <p className="wk-tech__p">{exercise.breathing}</p>
        </div>
      )}

      <a className="btn btn--glass btn--block wk-tech__video" href={videoUrl(exercise)} target="_blank" rel="noopener noreferrer">
        <ExternalLink size={18} aria-hidden="true" /> Ver video
      </a>

      <div className="wk-tech__sec">
        <h3 className="wk-tech__h">Pregúntale al entrenador</h3>
        <div className="wk-tech__quick">
          {QUICK.map((t) => (
            <button key={t} type="button" className="chip" onClick={() => pickQuick(t)}>
              {t}
            </button>
          ))}
        </div>
        <form
          className="wk-tech__ask"
          onSubmit={(e) => {
            e.preventDefault()
            void ask(q)
          }}
        >
          <input
            ref={inputRef}
            className="input"
            value={q}
            maxLength={500}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Escribe tu duda sobre este ejercicio"
            aria-label="Pregunta para el entrenador"
            enterKeyHint="send"
          />
          <IconButton label="Preguntar" variant="glass" type="submit" disabled={!q.trim() || busy}>
            <Send size={20} />
          </IconButton>
        </form>

        {busy && (
          <div className="wk-tech__loading" role="status">
            <Spinner /> <span className="muted">Pensando…</span>
          </div>
        )}
        {answer && !busy && (
          <div className="wk-tech__answer glass" role="status" aria-live="polite">
            <div className="wk-tech__answer-head">
              <span className="wk-tech__q truncate">{answer.question}</span>
              {answer.source === 'ai' ? (
                <Chip tone="accent" icon={<Sparkles size={12} />}>
                  IA
                </Chip>
              ) : (
                <Chip>{offline ? 'Sin internet' : 'Guía local'}</Chip>
              )}
            </div>
            <p className="wk-tech__text">{answer.answer}</p>
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, items, tone }: { title: string; items: string[]; tone?: 'warn' }) {
  if (!items?.length) return null
  return (
    <div className="wk-tech__sec">
      <h3 className="wk-tech__h">{title}</h3>
      <ul className={`wk-tech__list ${tone === 'warn' ? 'wk-tech__list--warn' : ''}`}>
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  )
}
