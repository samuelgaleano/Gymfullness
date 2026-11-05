import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useParams, useRoute } from 'wouter'
import { Check, Cloud, Copy, FileSpreadsheet, Image as ImageIcon, Share2, Trash2, Trophy, X } from 'lucide-react'
import { Button, Card, Chip, EmptyState, IconButton, Sheet, Spinner, toast, TopBar } from '@/ui'
import { getExercise, useApp } from '@/store/app'
import { useAuth } from '@/store/auth'
import { summarizeSession } from '@/lib/stats'
import { formatVolume, formatWeight } from '@/lib/units'
import { MUSCLE_LABEL } from '@/data/exercises'
import {
  FEELING_LABEL,
  buildCsv,
  buildSummaryText,
  copyText,
  describePR,
  csvBlob,
  downloadBlob,
  exportFileName,
  formatLongDate,
  formatSummarySet,
  renderSummaryImage,
  shareSummary,
} from '@/lib/export'
import type { MuscleGroup, SessionSummary, WorkoutSession } from '@/lib/types'
import './summary.css'

type Feeling = 1 | 2 | 3 | 4 | 5
const FEELINGS: Feeling[] = [1, 2, 3, 4, 5]
const PROMPT_KEY = 'gymfullness:summary-prompt-dismissed'

export default function SummaryScreen() {
  const [, navigate] = useLocation()
  const [isHistory] = useRoute('/history/:id')
  const { id } = useParams<{ id: string }>()
  const session = useApp((s) => s.sessions.find((x) => x.id === id && !x.deleted))

  const goBack = () => {
    if (isHistory && window.history.length > 1) window.history.back()
    else navigate(isHistory ? '/progress' : '/')
  }

  if (!session) {
    return (
      // /history/:id keeps the tab bar (see FULLSCREEN in App.tsx), /summary/:id does not
      <main className={`screen sm ${isHistory ? 'sm--tabs' : 'screen--full'}`}>
        <TopBar onBack={goBack} />
        <EmptyState
          title="No encontramos este entreno"
          text="Puede que se haya eliminado."
          action={
            <Button variant="glass" onClick={() => navigate('/')}>
              Ir al inicio
            </Button>
          }
        />
      </main>
    )
  }
  return <Summary key={session.id} session={session} history={isHistory} onBack={goBack} />
}

function durationStat(sec: number): { value: string; label: string } {
  const min = Math.max(0, Math.round(sec / 60))
  if (min < 1) return { value: '<1', label: 'Duración (min)' }
  if (min < 60) return { value: String(min), label: 'Duración (min)' }
  return { value: `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`, label: 'Duración (h:min)' }
}

function volumeStat(summary: SessionSummary): { value: string; label: string } {
  if (summary.volume <= 0) return { value: '–', label: 'Volumen' }
  if (summary.unit === 'kg' && summary.volume >= 10000) return { value: (summary.volume / 1000).toFixed(1), label: 'Volumen (t)' }
  return { value: Math.round(summary.volume).toLocaleString('es'), label: `Volumen (${summary.unit})` }
}

function Summary({ session, history, onBack }: { session: WorkoutSession; history: boolean; onBack: () => void }) {
  const [, navigate] = useLocation()
  const summary = useMemo(() => summarizeSession(session, getExercise), [session])
  const [busy, setBusy] = useState<null | 'image' | 'share' | 'csv' | 'copy'>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  const extras = { feeling: session.feeling ?? null, notes: session.notes ?? null }

  const setFeeling = (f: Feeling) => useApp.getState().updateSession(session.id, { feeling: f })

  /* ---------- exports ---------- */
  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void> | void) => {
    if (busy) return
    setBusy(kind)
    try {
      await fn()
    } catch {
      toast.error(kind === 'image' || kind === 'share' ? 'No se pudo crear la imagen.' : 'No se pudo completar la acción.')
    } finally {
      setBusy(null)
    }
  }

  const downloadImage = () =>
    run('image', async () => {
      const blob = await renderSummaryImage(summary, extras)
      downloadBlob(blob, exportFileName(summary, 'png'))
      toast.success('Imagen guardada')
    })

  const share = () =>
    run('share', async () => {
      const blob = await renderSummaryImage(summary, extras)
      const res = await shareSummary(summary, blob)
      if (res === 'shared') toast.success('Compartido')
      else if (res === 'downloaded') toast.show('Tu navegador no puede compartir: guardamos la imagen.')
    })

  const csv = () =>
    run('csv', () => {
      downloadBlob(csvBlob(buildCsv(summary)), exportFileName(summary, 'csv'))
      toast.success('CSV descargado')
    })

  const copy = () =>
    run('copy', async () => {
      const ok = await copyText(buildSummaryText(summary, extras))
      if (ok) toast.success('Resumen copiado')
      else toast.error('No se pudo copiar.')
    })

  const dur = durationStat(summary.durationSec)
  const vol = volumeStat(summary)
  const stats: { value: string; label: string; tone?: 'pr' }[] = [
    dur,
    { value: String(summary.totalSets), label: 'Series' },
    { value: summary.totalReps.toLocaleString('es'), label: 'Repeticiones' },
    vol,
    { value: String(summary.prs.length), label: summary.prs.length === 1 ? 'Récord' : 'Récords', tone: summary.prs.length ? 'pr' : undefined },
    { value: String(summary.exercises.length), label: 'Ejercicios' },
  ]

  const muscles = (Object.entries(summary.muscles) as [MuscleGroup, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)

  const time = new Date(summary.startedAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })

  return (
    <main className={`screen sm ${history ? 'sm--tabs' : 'screen--full'}`}>
      {history ? (
        <TopBar
          onBack={onBack}
          title="Entreno"
          right={
            <IconButton label="Eliminar entreno" variant="glass" onClick={() => setConfirmDelete(true)}>
              <Trash2 size={20} />
            </IconButton>
          }
        />
      ) : null}

      <header className="sm-head">
        {!history && (
          <div className="sm-head__eyebrow">
            <span className="sm-head__badge" aria-hidden="true">
              <Check size={14} strokeWidth={3} />
            </span>
            Entreno completado
          </div>
        )}
        <h1 className="sm-head__title">{summary.name}</h1>
        <p className="sm-head__sub">
          {formatLongDate(summary.startedAt)} · {time}
        </p>
      </header>

      <div className="sm-stack">
        <section className="sm-stats" aria-label="Resumen">
          {stats.map((s) => (
            <div key={s.label} className={`sm-stat glass ${s.tone === 'pr' ? 'sm-stat--pr' : ''}`}>
              <div className="sm-stat__value num">{s.value}</div>
              <div className="sm-stat__label">{s.label}</div>
            </div>
          ))}
        </section>

        {summary.totalSets === 0 && (
          <Card>
            <p className="muted">Este entreno no tiene series registradas.</p>
          </Card>
        )}

        {summary.prs.length > 0 && (
          <section className="sm-pr glass" aria-label="Récords personales">
            <div className="sm-pr__head">
              <Trophy size={18} aria-hidden="true" /> {summary.prs.length === 1 ? 'Récord personal' : 'Récords personales'}
            </div>
            <ul className="sm-pr__list">
              {summary.prs.map((pr) => (
                <li key={pr.exerciseId} className="sm-pr__row">
                  <span className="sm-pr__name truncate">{pr.name}</span>
                  <span className="sm-pr__val num">{describePR(summary, pr)}</span>
                  {pr.e1rm ? <span className="sm-pr__sub num">1RM est. {formatWeight(Math.round(pr.e1rm))} {summary.unit}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        )}

        {muscles.length > 0 && (
          <section className="sm-block" aria-label="Músculos trabajados">
            <h2 className="section-title">Músculos trabajados</h2>
            <div className="sm-chips">
              {muscles.map(([m, n], i) => (
                <Chip key={m} tone={i === 0 ? 'accent' : undefined}>
                  {MUSCLE_LABEL[m]} · {formatWeight(Math.round(n * 2) / 2)}
                </Chip>
              ))}
            </div>
          </section>
        )}

        <section className="sm-block" aria-label="Ejercicios">
          <h2 className="section-title">Ejercicios</h2>
          <div className="sm-ex">
            {summary.exercises.map((ex) => (
              <article key={ex.exerciseId} className="sm-exc glass">
                <header className="sm-exc__head">
                  <h3 className="sm-exc__name truncate">{ex.name}</h3>
                  <span className="sm-exc__meta num">
                    {ex.sets.length} {ex.sets.length === 1 ? 'serie' : 'series'}
                    {ex.volume > 0 ? ` · ${formatVolume(ex.volume, summary.unit)}` : ''}
                  </span>
                </header>
                <ol className="sm-sets">
                  {ex.sets.map((s, i) => (
                    <li key={i} className={`sm-set ${s.isPR ? 'sm-set--pr' : ''}`}>
                      <span className="sm-set__n">{i + 1}</span>
                      <span className="sm-set__v num">{formatSummarySet(s, summary.unit)}</span>
                      {s.isPR && (
                        <span className="sm-set__pr">
                          <Trophy size={13} aria-hidden="true" /> Récord
                        </span>
                      )}
                    </li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
        </section>

        <section className="sm-block" aria-label="Sensación">
          <h2 className="section-title">¿Cómo te sentiste?</h2>
          <div className="sm-feel" role="radiogroup" aria-label="Sensación del entreno">
            {FEELINGS.map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={session.feeling === f}
                aria-label={`${f} de 5, ${FEELING_LABEL[f]}`}
                className="sm-feel__opt"
                onClick={() => setFeeling(f)}
              >
                <span className="num">{f}</span>
              </button>
            ))}
          </div>
          <div className="sm-feel__legend" aria-hidden="true">
            <span>Muy duro</span>
            <span>{session.feeling ? FEELING_LABEL[session.feeling] : ''}</span>
            <span>Genial</span>
          </div>
        </section>

        <NotesField sessionId={session.id} initial={session.notes ?? ''} />

        <section className="sm-block" aria-label="Exportar">
          <h2 className="section-title">Guardar y compartir</h2>
          <div className="sm-actions">
            <Button variant="glass" size="lg" icon={busy === 'image' ? <Spinner /> : <ImageIcon size={20} />} onClick={downloadImage} disabled={!!busy}>
              Descargar imagen
            </Button>
            <Button variant="glass" size="lg" icon={busy === 'share' ? <Spinner /> : <Share2 size={20} />} onClick={share} disabled={!!busy}>
              Compartir
            </Button>
            <Button variant="glass" size="lg" icon={<FileSpreadsheet size={20} />} onClick={csv} disabled={!!busy}>
              Descargar CSV
            </Button>
            <Button variant="glass" size="lg" icon={<Copy size={20} />} onClick={copy} disabled={!!busy}>
              Copiar texto
            </Button>
          </div>
        </section>

        {!history && <GuestPrompt />}
      </div>

      {!history && (
        <div className="sm-bottom">
          <Button variant="primary" size="xl" block onClick={() => navigate('/', { replace: true })}>
            Listo
          </Button>
        </div>
      )}

      <Sheet
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        hideClose
        title="¿Eliminar este entreno?"
        footer={
          <div className="sm-confirm-actions">
            <Button variant="danger" size="lg" block icon={<Trash2 size={18} />} onClick={() => {
              useApp.getState().deleteSession(session.id)
              toast.show('Entreno eliminado')
              navigate('/progress', { replace: true })
            }}>
              Eliminar
            </Button>
            <Button variant="glass" size="lg" block onClick={() => setConfirmDelete(false)}>
              Cancelar
            </Button>
          </div>
        }
      >
        <p className="muted sm-confirm-text">Se quitará de tu historial y de tus estadísticas. Esto no se puede deshacer.</p>
      </Sheet>
    </main>
  )
}

function NotesField({ sessionId, initial }: { sessionId: string; initial: string }) {
  const [text, setText] = useState(initial)
  const saved = useRef(initial)

  const save = (value: string) => {
    const v = value.trim()
    if (v === saved.current) return
    saved.current = v
    useApp.getState().updateSession(sessionId, { notes: v })
  }

  // debounce while typing so nothing is lost if the user leaves right away
  useEffect(() => {
    const t = setTimeout(() => save(text), 700)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return (
    <section className="sm-block" aria-label="Notas">
      <h2 className="section-title">Notas</h2>
      <textarea
        className="input"
        value={text}
        rows={3}
        maxLength={1000}
        placeholder="Cómo te fue, qué ajustar la próxima vez…"
        aria-label="Notas del entreno"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => save(text)}
      />
    </section>
  )
}

function readDismissed(): boolean {
  try {
    return localStorage.getItem(PROMPT_KEY) === '1'
  } catch {
    return false
  }
}

function GuestPrompt() {
  const { status, cloudEnabled, signIn, signingIn } = useAuth()
  const [dismissed, setDismissed] = useState(readDismissed)
  if (!cloudEnabled || status !== 'guest' || dismissed) return null
  const dismiss = () => {
    setDismissed(true)
    try {
      localStorage.setItem(PROMPT_KEY, '1')
    } catch {
      /* ignore */
    }
  }
  return (
    <section className="sm-guest glass" aria-label="Guardar progreso">
      <div className="sm-guest__icon" aria-hidden="true">
        <Cloud size={22} />
      </div>
      <div className="sm-guest__body">
        <div className="sm-guest__title">Guarda tu progreso con Google</div>
        <p className="sm-guest__text">Respalda tus entrenos y recupéralos en cualquier dispositivo.</p>
        <Button variant="glass" size="md" icon={signingIn ? <Spinner /> : undefined} onClick={() => void signIn()} disabled={signingIn}>
          Continuar con Google
        </Button>
      </div>
      <IconButton label="Ahora no" variant="plain" size="sm" onClick={dismiss}>
        <X size={18} />
      </IconButton>
    </section>
  )
}
