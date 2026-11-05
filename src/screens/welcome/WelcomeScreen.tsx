import { useRef, useState } from 'react'
import { useLocation } from 'wouter'
import { ArrowLeft, CircleAlert, FileUp, Mic, Timer, Route, Lock, UserRound } from 'lucide-react'
import { Button, Sheet, Spinner, toast } from '@/ui'
import { useApp } from '@/store/app'
import { useAuth, useAuthStore } from '@/store/auth'
import { PlanWizard } from '@/screens/routines/PlanWizard'
import { parseImportText } from '@/screens/profile/importValidate'
import { ensureDefaultPlan, finishOnboarding, waitForRemoteData } from './welcomeLogic'
import './welcome.css'

type Step = 'hero' | 'setup'

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c5.35 0 8.9-3.76 8.9-9.05 0-.6-.06-1.07-.15-1.5z" />
    </svg>
  )
}

const FEATURES = [
  { icon: Route, label: 'Rutina guiada' },
  { icon: Timer, label: 'Descansos' },
  { icon: Mic, label: 'Registro por voz' },
]

export default function WelcomeScreen() {
  const [, navigate] = useLocation()
  const auth = useAuth()
  const [step, setStep] = useState<Step>('hero')
  const [name, setName] = useState('')
  const [checking, setChecking] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [restoreOpen, setRestoreOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const goHome = () => navigate('/', { replace: true })

  const startGuest = () => {
    setNote(null)
    setStep('setup')
  }

  const google = async () => {
    setNote(null)
    setRestoreOpen(false)
    const since = Date.now()
    const ok = await auth.signIn()
    if (!ok) {
      if (!useAuthStore.getState().error) setNote('No se completó el inicio de sesión.')
      return
    }
    setChecking(true)
    const found = await waitForRemoteData({
      isSyncing: () => useAuthStore.getState().syncing,
      lastSyncAt: () => useAuthStore.getState().lastSyncAt,
      since,
    })
    setChecking(false)
    if (found) {
      ensureDefaultPlan() // no-op when the cloud already brought a plan
      finishOnboarding(useApp.getState().profile.name ?? '')
      toast.success('Datos recuperados')
      goHome()
    } else {
      setStep('setup')
    }
  }

  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const res = parseImportText(await file.text(), useApp.getState().settings)
      if (!res.ok) {
        setRestoreOpen(false)
        setNote(res.error)
        return
      }
      useApp.getState().importData(res.data, 'replace')
      ensureDefaultPlan()
      useApp.getState().updateProfile({ onboarded: true })
      setRestoreOpen(false)
      toast.success('Copia restaurada')
      goHome()
    } catch {
      setNote('No pude abrir el archivo.')
    }
  }

  const skipSetup = () => {
    ensureDefaultPlan()
    finishOnboarding(name)
    goHome()
  }
  const doneSetup = () => {
    finishOnboarding(name)
    goHome()
  }

  /* ------------------------------------------------------------- setup */
  if (step === 'setup') {
    return (
      <main className="screen screen--full wl-screen wl-screen--setup">
        <div className="wl-setup">
          <button type="button" className="wl-back" onClick={() => setStep('hero')}>
            <ArrowLeft size={18} aria-hidden="true" /> Atrás
          </button>

          <div className="wl-name glass">
            <label htmlFor="wl-name" className="wl-name__label">
              ¿Cómo te llamas? <span className="faint">(opcional)</span>
            </label>
            <input
              id="wl-name"
              className="input"
              value={name}
              maxLength={40}
              autoComplete="given-name"
              placeholder="Tu nombre"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <PlanWizard embedded onDone={doneSetup} />

          <Button variant="ghost" size="lg" block onClick={skipSetup}>
            Saltar por ahora
          </Button>
          <p className="wl-hint">Te preparo una rutina de cuerpo completo, 3 días por semana. Puedes cambiarla cuando quieras.</p>
        </div>
      </main>
    )
  }

  /* -------------------------------------------------------------- hero */
  return (
    <main className="screen screen--full wl-screen">
      <div className="wl-hero">
        <div className="wl-brand" aria-hidden="true">
          <span className="wl-brand__glow" />
          <img src="/favicon.svg" alt="" width={96} height={96} className="wl-brand__img" />
        </div>
        <h1 className="wl-title">
          Entrena <span className="wl-title__accent">sin pensar.</span>
        </h1>
        <p className="wl-sub">Una rutina que te guía serie a serie, un descanso que se cuenta solo y tu progreso con una nota de voz.</p>
        <ul className="wl-features" aria-label="Qué incluye">
          {FEATURES.map(({ icon: Icon, label }) => (
            <li key={label} className="wl-feature glass">
              <Icon size={16} aria-hidden="true" />
              {label}
            </li>
          ))}
        </ul>
      </div>

      <div className="wl-actions">
        {checking ? (
          <div className="wl-checking" role="status">
            <Spinner />
            <span>Buscando tus datos…</span>
          </div>
        ) : (
          <>
            <Button variant="primary" size="xl" block onClick={startGuest} icon={<UserRound size={22} aria-hidden="true" />}>
              Empezar sin cuenta
            </Button>
            {auth.cloudEnabled && (
              <Button
                variant="glass"
                size="lg"
                block
                disabled={auth.signingIn || auth.status === 'unknown'}
                onPointerEnter={auth.prefetch}
                onFocus={auth.prefetch}
                onClick={google}
                icon={auth.signingIn ? <Spinner /> : <GoogleMark />}
              >
                Continuar con Google
              </Button>
            )}
            {(auth.error || note) && (
              <p className="wl-error" role="alert">
                <CircleAlert size={15} aria-hidden="true" />
                {auth.error ?? note}
              </p>
            )}
            <Button variant="ghost" size="md" block onClick={() => setRestoreOpen(true)}>
              Ya tengo cuenta
            </Button>
          </>
        )}
        <p className="wl-privacy">
          <Lock size={13} aria-hidden="true" /> Tus datos se guardan en tu teléfono
        </p>
      </div>

      <Sheet open={restoreOpen} onClose={() => setRestoreOpen(false)} title="Recupera tus datos">
        <div className="wl-restore">
          {auth.cloudEnabled && (
            <Button variant="primary" size="lg" block onClick={google} disabled={auth.signingIn} icon={<GoogleMark />}>
              Iniciar sesión con Google
            </Button>
          )}
          <Button variant="glass" size="lg" block onClick={() => fileRef.current?.click()} icon={<FileUp size={20} aria-hidden="true" />}>
            Importar copia (.json)
          </Button>
          <p className="wl-hint">La copia es el archivo que descargas desde Perfil → Exportar.</p>
        </div>
      </Sheet>
      <input
        ref={fileRef}
        type="file"
        accept="application/json,.json"
        hidden
        aria-label="Elegir archivo de copia"
        onChange={(e) => {
          void onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </main>
  )
}
