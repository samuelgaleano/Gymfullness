import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'wouter'
import {
  Bell,
  Check,
  CircleAlert,
  Cloud,
  Download,
  FileSpreadsheet,
  FileUp,
  Globe,
  Info,
  LogOut,
  Minus,
  Mic,
  Moon,
  Play,
  Plus,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Timer,
  Trash2,
  Volume2,
  Vibrate,
  Weight,
  Zap,
  Eye,
  Hourglass,
  Target,
  TrendingUp,
  CalendarDays,
  Dumbbell,
  Cake,
  Users,
  UserRound,
} from 'lucide-react'
import type { EquipmentProfile, Goal, Level, Profile, Settings, ThemePref } from '@/lib/types'
import { useApp, getExercise } from '@/store/app'
import { useAuth, useAuthStore } from '@/store/auth'
import { Button, Card, Header, List, Segmented, Spinner, Switch, toast } from '@/ui'
import { DAYS_OPTIONS, EQUIPMENT_OPTIONS, GOAL_OPTIONS, LEVEL_OPTIONS } from '@/lib/planner'
import { downloadBlob } from '@/lib/export'
import { speak, isTTSSupported } from '@/lib/voice'
import { toDateKey } from '@/lib/date'
import { parseImportText, type ImportSummary } from './importValidate'
import { ImportSheet, DeleteSheet, InstallSheet, type ImportMode } from './ProfileSheets'
import {
  buildAllSetsCsv,
  formatRest,
  formatSyncAgo,
  initials,
  parseBounded,
  planFieldsChanged,
  speechLangOptions,
  stepRest,
} from './settingsHelpers'
import { regeneratePlanFromProfile } from './planActions'
import { useInstallPrompt } from './useInstallPrompt'
import './profile.css'

const APP_VERSION = '1.0.0'

type GroupId = 'train' | 'look' | 'notif' | 'body'

/** Re-render every `ms` so relative times stay fresh. */
function useTick(ms: number): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.64 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.95S8.78 6.28 12 6.28c1.83 0 3.06.78 3.76 1.45l2.56-2.47C16.68 3.7 14.55 2.75 12 2.75 6.9 2.75 2.75 6.9 2.75 12S6.9 21.25 12 21.25c5.35 0 8.9-3.76 8.9-9.05 0-.6-.06-1.07-.15-1.5z" />
    </svg>
  )
}

/* ------------------------------------------------------------------ rows */

function Row({
  icon,
  title,
  sub,
  children,
  onClick,
  stack,
}: {
  icon?: ReactNode
  title: ReactNode
  sub?: ReactNode
  children?: ReactNode
  onClick?: () => void
  stack?: boolean
}) {
  return (
    <div
      className={`list-row pf-row ${stack ? 'pf-row--stack' : ''} ${onClick ? 'pf-row--tap' : ''}`}
      onClick={onClick}
      {...(onClick && !children
        ? {
            role: 'button',
            tabIndex: 0,
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onClick()
              }
            },
          }
        : {})}
    >
      <div className="pf-row__head">
        {icon && <div className="list-row__icon">{icon}</div>}
        <div className="grow">
          <div className="list-row__title">{title}</div>
          {sub && <div className="list-row__sub pf-row__sub">{sub}</div>}
        </div>
        {!stack && children && (
          <div className="pf-row__ctrl" onClick={(e) => e.stopPropagation()}>
            {children}
          </div>
        )}
      </div>
      {stack && children && <div className="pf-row__body">{children}</div>}
    </div>
  )
}

function SwitchRow({
  icon,
  title,
  sub,
  checked,
  onChange,
}: {
  icon: ReactNode
  title: string
  sub?: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <Row icon={icon} title={title} sub={sub} onClick={() => onChange(!checked)}>
      <Switch checked={checked} onChange={onChange} label={title} />
    </Row>
  )
}

function SelectRow<T extends string | number>({
  icon,
  title,
  value,
  options,
  onChange,
  placeholder = 'Sin definir',
}: {
  icon?: ReactNode
  title: string
  value: T | null | undefined
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  placeholder?: string
}) {
  return (
    <Row icon={icon} title={title}>
      <select
        className="pf-select"
        aria-label={title}
        value={value === null || value === undefined ? '' : String(value)}
        onChange={(e) => {
          const o = options.find((x) => String(x.value) === e.target.value)
          if (o) onChange(o.value)
        }}
      >
        {(value === null || value === undefined) && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </Row>
  )
}

function NumberRow({
  icon,
  title,
  value,
  unit,
  min,
  max,
  placeholder,
  onCommit,
}: {
  icon?: ReactNode
  title: string
  value: number | null | undefined
  unit?: string
  min: number
  max: number
  placeholder: string
  onCommit: (v: number | null) => void
}) {
  const [draft, setDraft] = useState(value == null ? '' : String(value))
  const [bad, setBad] = useState(false)
  useEffect(() => setDraft(value == null ? '' : String(value)), [value])
  const commit = () => {
    if (draft.trim() === '') {
      setBad(false)
      if (value != null) onCommit(null)
      return
    }
    const n = parseBounded(draft, min, max)
    if (n === null) {
      setBad(true)
      return
    }
    setBad(false)
    if (n !== value) onCommit(Math.round(n))
  }
  return (
    <Row icon={icon} title={title}>
      <div className="pf-numfield">
        <input
          className={`pf-input num ${bad ? 'is-bad' : ''}`}
          inputMode="numeric"
          value={draft}
          placeholder={placeholder}
          aria-label={title}
          aria-invalid={bad}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d.,]/g, ''))}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        {unit && <span className="pf-numfield__unit">{unit}</span>}
      </div>
    </Row>
  )
}

function Group({
  title,
  saved,
  children,
}: {
  title: string
  saved?: boolean
  children: ReactNode
}) {
  return (
    <section className="pf-group" aria-label={title}>
      <div className="pf-group__head">
        <h2 className="section-title">{title}</h2>
        <span className={`pf-saved ${saved ? 'is-on' : ''}`} role="status" aria-live="polite">
          {saved && (
            <>
              <Check size={13} strokeWidth={3} aria-hidden="true" /> Guardado
            </>
          )}
        </span>
      </div>
      <List>{children}</List>
    </section>
  )
}

/* ------------------------------------------------------------------ account */

function AccountCard() {
  const auth = useAuth()
  const name = useApp((s) => s.profile.name)
  useTick(30_000)
  const signedIn = auth.status === 'signed_in' && !!auth.user
  const display = signedIn ? auth.user?.name || name || auth.user?.email || 'Tu cuenta' : name || 'Invitado'
  const ini = initials(signedIn ? auth.user?.name || auth.user?.email : name, '')
  const [imgOk, setImgOk] = useState(true)
  const photo = signedIn && imgOk ? auth.user?.photoURL : null

  return (
    <Card pad="lg" className="pf-account">
      <div className="pf-account__top">
        <div className="pf-avatar" aria-hidden="true">
          {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" onError={() => setImgOk(false)} /> : ini || <Smartphone size={26} />}
        </div>
        <div className="grow">
          <div className="pf-account__name truncate">{display}</div>
          <div className="pf-account__status">
            {signedIn ? (
              <>
                <span className="pf-dot pf-dot--on" aria-hidden="true" />
                <span className="truncate">{auth.user?.email ?? 'Cuenta de Google'}</span>
              </>
            ) : (
              <>
                <span className="pf-dot" aria-hidden="true" />
                <span>Invitado · solo en este teléfono</span>
              </>
            )}
          </div>
        </div>
      </div>

      {signedIn && (
        <div className="pf-sync">
          <div className="pf-sync__text" role="status" aria-live="polite">
            {auth.syncing ? 'Sincronizando…' : auth.error ? <span className="pf-sync__err">{auth.error}</span> : formatSyncAgo(auth.lastSyncAt)}
          </div>
          <Button
            variant="glass"
            size="sm"
            aria-label="Sincronizar ahora"
            onClick={() => void auth.syncNow()}
            disabled={auth.syncing}
            icon={auth.syncing ? <Spinner /> : <RefreshCw size={16} aria-hidden="true" />}
          >
            Sincronizar
          </Button>
        </div>
      )}
    </Card>
  )
}

function CloudCard() {
  const auth = useAuth()
  if (!auth.cloudEnabled || auth.status === 'signed_in') return null
  return (
    <Card accent pad="lg" className="pf-cloud">
      <div className="pf-cloud__ic" aria-hidden="true">
        <Cloud size={22} />
      </div>
      <div className="pf-cloud__title">Guarda tu progreso en la nube</div>
      <p className="pf-cloud__text">Cambia de teléfono sin perder nada. Seguirás entrenando igual, sin conexión.</p>
      <Button
        variant="primary"
        size="lg"
        block
        disabled={auth.signingIn || auth.status === 'unknown'}
        onPointerEnter={auth.prefetch}
        onFocus={auth.prefetch}
        onClick={async () => {
          const ok = await auth.signIn()
          if (ok) toast.success('Sesión iniciada. Sincronizando…')
        }}
        icon={auth.signingIn ? <Spinner /> : <GoogleMark />}
      >
        Continuar con Google
      </Button>
      {auth.error && (
        <p className="pf-cloud__err" role="alert">
          <CircleAlert size={14} aria-hidden="true" /> {auth.error}
        </p>
      )}
    </Card>
  )
}

/* ------------------------------------------------------------------ screen */

export default function ProfileScreen() {
  const [, navigate] = useLocation()
  const auth = useAuth()
  const settings = useApp((s) => s.settings)
  const profile = useApp((s) => s.profile)
  const hasPlan = useApp((s) => s.plan !== null)
  const updateSettings = useApp((s) => s.updateSettings)
  const updateProfile = useApp((s) => s.updateProfile)
  const install = useInstallPrompt()

  const [saved, setSaved] = useState<GroupId | null>(null)
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flash = useCallback((g: GroupId) => {
    setSaved(g)
    clearTimeout(savedTimer.current)
    savedTimer.current = setTimeout(() => setSaved(null), 1600)
  }, [])
  useEffect(() => () => clearTimeout(savedTimer.current), [])

  const setSetting = <K extends keyof Settings>(group: GroupId, key: K, value: Settings[K]) => {
    updateSettings({ [key]: value } as Partial<Settings>)
    flash(group)
  }

  /* ---- profile edits + plan regeneration offer ---- */
  const [planDirty, setPlanDirty] = useState(false)
  const editProfile = (patch: Partial<Profile>) => {
    const changesPlan = planFieldsChanged(useApp.getState().profile, patch)
    updateProfile(patch)
    flash('body')
    if (changesPlan) setPlanDirty(true)
  }

  /* ---- notifications ---- */
  const notifSupported = typeof Notification !== 'undefined'
  const [perm, setPerm] = useState<NotificationPermission | 'unsupported'>(notifSupported ? Notification.permission : 'unsupported')
  const askNotif = async () => {
    if (!notifSupported) return
    try {
      const r = await Notification.requestPermission()
      setPerm(r)
      if (r === 'granted') toast.success('Avisos activados')
    } catch {
      toast.error('No se pudo pedir el permiso')
    }
  }

  /* ---- voice test ---- */
  const testVoice = () => {
    if (!isTTSSupported()) {
      toast.error('Tu navegador no puede hablar. Prueba con otro.')
      return
    }
    void speak('Descanso terminado. Siguiente: press de banca, serie dos de cuatro.', { lang: settings.speechLang })
  }

  /* ---- data: export / import / delete ---- */
  const exportJson = () => {
    const data = useApp.getState().exportData()
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `gymfullness-${toDateKey()}.json`)
    toast.success('Copia descargada')
  }
  const exportCsv = () => {
    const sessions = useApp.getState().sessions
    const csv = buildAllSetsCsv(sessions, (id) => getExercise(id)?.name ?? id)
    if (csv.split('\n').length < 2) {
      toast.show('Aún no tienes series registradas')
      return
    }
    downloadBlob(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }), `gymfullness-series-${toDateKey()}.csv`)
    toast.success('CSV descargado')
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<{ name: string; data: import('@/lib/types').UserData; summary: ImportSummary; warnings: string[] } | null>(null)
  const onFile = async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      const res = parseImportText(text, useApp.getState().settings)
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setPending({ name: file.name, data: res.data, summary: res.summary, warnings: res.warnings })
    } catch {
      toast.error('No pude abrir el archivo')
    }
  }
  const confirmImport = (mode: ImportMode) => {
    if (!pending) return
    useApp.getState().importData(pending.data, mode)
    // an imported profile must never send the user back to the welcome screen
    useApp.getState().updateProfile({ onboarded: true })
    setPending(null)
    toast.success(mode === 'merge' ? 'Datos mezclados' : 'Datos importados')
  }

  const [delOpen, setDelOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const confirmDelete = async (alsoCloud: boolean) => {
    setDeleting(true)
    if (alsoCloud) {
      // Abort if the cloud copy could not be deleted: otherwise sync would bring the data back.
      const ok = await useAuthStore.getState().deleteCloudData().catch(() => false)
      if (!ok) {
        setDeleting(false)
        toast.error(useAuthStore.getState().error ?? 'No se pudo borrar la copia en la nube. Inténtalo de nuevo.')
        return
      }
    }
    useApp.getState().resetAll()
    setDeleting(false)
    setDelOpen(false)
    toast.success('Datos borrados')
    navigate('/welcome', { replace: true })
  }

  const [installOpen, setInstallOpen] = useState(false)
  const onInstall = async () => {
    if (install.state === 'prompt') {
      const r = await install.install()
      if (r === 'accepted') toast.success('Instalada')
    } else setInstallOpen(true)
  }

  const speechOptions = useMemo(() => speechLangOptions(settings.speechLang), [settings.speechLang])
  const year = new Date().getFullYear()

  return (
    <main className="screen pf-screen">
      <Header title="Perfil" />

      <div className="stack-lg">
        <div className="stack">
          <AccountCard />
          <CloudCard />
        </div>

        <Group title="Entreno" saved={saved === 'train'}>
          <Row icon={<Weight size={18} />} title="Unidad de peso">
            <div className="pf-seg-sm">
              <Segmented<Settings['unit']>
                label="Unidad de peso"
                value={settings.unit}
                options={[
                  { value: 'kg', label: 'kg' },
                  { value: 'lb', label: 'lb' },
                ]}
                onChange={(v) => setSetting('train', 'unit', v)}
              />
            </div>
          </Row>
          <Row icon={<Timer size={18} />} title="Descanso" sub="Por defecto, entre 0:30 y 5:00">
            <div className="pf-stepper" role="group" aria-label="Descanso por defecto">
              <button
                type="button"
                className="pf-stepper__btn"
                aria-label="Menos descanso"
                disabled={settings.defaultRestSec <= 30}
                onClick={() => setSetting('train', 'defaultRestSec', stepRest(settings.defaultRestSec, -1))}
              >
                <Minus size={18} />
              </button>
              <output className="pf-stepper__val num" aria-live="polite">
                {formatRest(settings.defaultRestSec)}
              </output>
              <button
                type="button"
                className="pf-stepper__btn"
                aria-label="Más descanso"
                disabled={settings.defaultRestSec >= 300}
                onClick={() => setSetting('train', 'defaultRestSec', stepRest(settings.defaultRestSec, 1))}
              >
                <Plus size={18} />
              </button>
            </div>
          </Row>
          <SwitchRow icon={<Hourglass size={18} />} title="Descanso automático" sub="Arranca al terminar cada serie" checked={settings.autoStartRest} onChange={(v) => setSetting('train', 'autoStartRest', v)} />
          <SwitchRow icon={<Zap size={18} />} title="Contador 3-2-1" sub="Pitidos al acabar el descanso" checked={settings.countdownBeeps} onChange={(v) => setSetting('train', 'countdownBeeps', v)} />
          <SwitchRow icon={<Volume2 size={18} />} title="Sonidos" checked={settings.sounds} onChange={(v) => setSetting('train', 'sounds', v)} />
          <SwitchRow icon={<Vibrate size={18} />} title="Vibración" checked={settings.vibration} onChange={(v) => setSetting('train', 'vibration', v)} />
          <SwitchRow icon={<Eye size={18} />} title="Pantalla encendida" sub="No se apaga durante el entreno" checked={settings.keepAwake} onChange={(v) => setSetting('train', 'keepAwake', v)} />
          <SwitchRow icon={<Mic size={18} />} title="Anuncios por voz" sub="“Siguiente: press de banca”" checked={settings.voiceAnnouncements} onChange={(v) => setSetting('train', 'voiceAnnouncements', v)} />
          <Row icon={<Globe size={18} />} title="Idioma de voz">
            <select className="pf-select" aria-label="Idioma de voz" value={settings.speechLang} onChange={(e) => setSetting('train', 'speechLang', e.target.value)}>
              {speechOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Row>
          <Row icon={<Play size={18} />} title="Probar voz" sub="Escucha cómo sonarán los anuncios" onClick={testVoice}>
            <Button variant="glass" size="sm" onClick={testVoice}>
              Reproducir
            </Button>
          </Row>
        </Group>

        <Group title="Apariencia" saved={saved === 'look'}>
          <Row icon={<Moon size={18} />} title="Tema" stack>
            <Segmented<ThemePref>
              label="Tema"
              value={settings.theme}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dark', label: 'Oscuro' },
                { value: 'light', label: 'Claro' },
              ]}
              onChange={(v) => setSetting('look', 'theme', v)}
            />
          </Row>
        </Group>

        <Group title="Notificaciones" saved={false}>
          <Row
            icon={<Bell size={18} />}
            title="Avisos de descanso"
            sub={
              perm === 'granted'
                ? 'Te aviso aunque cambies de app'
                : perm === 'denied'
                  ? 'Bloqueadas en los ajustes del navegador'
                  : perm === 'unsupported'
                    ? 'Tu navegador no las admite'
                    : 'Para avisarte si sales de la app'
            }
          >
            {perm === 'granted' ? (
              <span className="pf-badge pf-badge--ok">
                <Check size={13} strokeWidth={3} aria-hidden="true" /> Activadas
              </span>
            ) : perm === 'default' ? (
              <Button variant="glass" size="sm" onClick={askNotif}>
                Activar
              </Button>
            ) : (
              <span className="pf-badge">{perm === 'denied' ? 'Bloqueadas' : 'No disponibles'}</span>
            )}
          </Row>
        </Group>

        <Group title="Datos" saved={false}>
          <Row icon={<Download size={18} />} title="Exportar copia (JSON)" sub="Todo tu historial y ajustes" onClick={exportJson} />
          <Row icon={<FileUp size={18} />} title="Importar copia" sub="Mezclar o reemplazar" onClick={() => fileRef.current?.click()} />
          <Row icon={<FileSpreadsheet size={18} />} title="Exportar series (CSV)" sub="Para Excel o Google Sheets" onClick={exportCsv} />
          <Row icon={<Trash2 size={18} />} title={<span className="pf-danger-text">Borrar todos los datos</span>} onClick={() => setDelOpen(true)} />
        </Group>
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

        <section className="pf-group" aria-label="Perfil físico">
          <div className="pf-group__head">
            <h2 className="section-title">Perfil físico</h2>
            <span className={`pf-saved ${saved === 'body' ? 'is-on' : ''}`} role="status" aria-live="polite">
              {saved === 'body' && (
                <>
                  <Check size={13} strokeWidth={3} aria-hidden="true" /> Guardado
                </>
              )}
            </span>
          </div>
          {planDirty && (
            <Card accent className="pf-regen">
              <div className="pf-regen__row">
                <Sparkles size={20} aria-hidden="true" />
                <div className="grow">
                  <div className="pf-regen__title">Cambiaste datos de tu plan</div>
                  <div className="pf-regen__sub">{hasPlan ? 'Puedo crear uno nuevo con tus respuestas.' : 'Puedo crearte un plan con tus respuestas.'}</div>
                </div>
              </div>
              <div className="pf-regen__actions">
                <Button variant="ghost" size="sm" onClick={() => setPlanDirty(false)}>
                  Ahora no
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    regeneratePlanFromProfile()
                    setPlanDirty(false)
                    toast.success('Plan actualizado')
                  }}
                >
                  Regenerar plan
                </Button>
              </div>
            </Card>
          )}
          <List>
            <NameRow value={profile.name ?? ''} onCommit={(name) => editProfile({ name })} />
            <SelectRow<Goal> icon={<Target size={18} />} title="Objetivo" value={profile.goal} options={GOAL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => editProfile({ goal: v })} />
            <SelectRow<Level> icon={<TrendingUp size={18} />} title="Nivel" value={profile.level} options={LEVEL_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => editProfile({ level: v })} />
            <SelectRow<number> icon={<CalendarDays size={18} />} title="Días por semana" value={profile.daysPerWeek} options={DAYS_OPTIONS.map((o) => ({ value: o.value, label: String(o.value) }))} onChange={(v) => editProfile({ daysPerWeek: v })} />
            <SelectRow<EquipmentProfile> icon={<Dumbbell size={18} />} title="Equipamiento" value={profile.equipment} options={EQUIPMENT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))} onChange={(v) => editProfile({ equipment: v })} />
            <NumberRow icon={<Ruler size={18} />} title="Estatura" unit="cm" value={profile.heightCm} min={100} max={250} placeholder="175" onCommit={(v) => editProfile({ heightCm: v })} />
            <NumberRow icon={<Cake size={18} />} title="Año de nacimiento" value={profile.birthYear} min={year - 100} max={year - 10} placeholder="1995" onCommit={(v) => editProfile({ birthYear: v })} />
            <SelectRow<'male' | 'female' | 'other'>
              icon={<Users size={18} />}
              title="Sexo"
              value={profile.sex}
              options={[
                { value: 'male', label: 'Hombre' },
                { value: 'female', label: 'Mujer' },
                { value: 'other', label: 'Otro' },
              ]}
              onChange={(v) => editProfile({ sex: v })}
            />
          </List>
        </section>

        <section className="pf-group" aria-label="Acerca de">
          <div className="pf-group__head">
            <h2 className="section-title">Acerca de</h2>
          </div>
          <List>
            {install.state !== 'installed' && (
              <Row icon={<Smartphone size={18} />} title="Instalar app" sub="Pantalla completa y sin conexión" onClick={onInstall}>
                <Button variant="glass" size="sm" onClick={onInstall}>
                  Instalar
                </Button>
              </Row>
            )}
            <Row icon={<ShieldCheck size={18} />} title="Privacidad" sub="Tus datos se guardan en tu teléfono. Solo salen si inicias sesión para sincronizar." />
            <Row icon={<Mic size={18} />} title="Cómo funciona la voz" sub="Mantén pulsado el micrófono y di “ochenta kilos, diez reps”. El reconocimiento lo hace tu navegador." />
            <Row icon={<Info size={18} />} title="Gymfullness" sub={`Versión ${APP_VERSION}`} />
          </List>
        </section>

        {auth.status === 'signed_in' && (
          <Button
            variant="glass"
            size="lg"
            block
            icon={<LogOut size={18} aria-hidden="true" />}
            onClick={async () => {
              await auth.signOut()
              toast.show('Sesión cerrada. Tus datos siguen en este teléfono.')
            }}
          >
            Cerrar sesión
          </Button>
        )}
        <p className="pf-foot">
          Gymfullness {APP_VERSION} · Hecho para entrenar sin pensar
        </p>
      </div>

      <ImportSheet
        open={pending !== null}
        fileName={pending?.name ?? ''}
        summary={pending?.summary ?? null}
        warnings={pending?.warnings ?? []}
        onClose={() => setPending(null)}
        onConfirm={confirmImport}
      />
      <DeleteSheet open={delOpen} signedIn={auth.status === 'signed_in'} busy={deleting} onClose={() => setDelOpen(false)} onConfirm={(c) => void confirmDelete(c)} />
      <InstallSheet open={installOpen} ios={install.state === 'ios'} onClose={() => setInstallOpen(false)} />
    </main>
  )
}

function NameRow({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = () => {
    const t = draft.trim().slice(0, 40)
    if (t !== value) onCommit(t)
    setDraft(t)
  }
  return (
    <Row icon={<UserRound size={18} />} title="Nombre">
      <input
        className="pf-input pf-input--text"
        value={draft}
        placeholder="Tu nombre"
        maxLength={40}
        aria-label="Nombre"
        autoComplete="given-name"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </Row>
  )
}
