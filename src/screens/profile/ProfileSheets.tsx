import { useEffect, useState } from 'react'
import { AlertTriangle, GitMerge, Plus, RefreshCcw, Share, SquarePlus, Trash2, MoreVertical } from 'lucide-react'
import { Button, Sheet, Switch } from '@/ui'
import type { ImportSummary } from './importValidate'
import { confirmWordMatches } from './settingsHelpers'

/* ------------------------------------------------------------------ import */

export type ImportMode = 'merge' | 'replace'

export function ImportSheet({
  open,
  fileName,
  summary,
  warnings,
  onClose,
  onConfirm,
}: {
  open: boolean
  fileName: string
  summary: ImportSummary | null
  warnings: string[]
  onClose: () => void
  onConfirm: (mode: ImportMode) => void
}) {
  const [mode, setMode] = useState<ImportMode>('merge')
  useEffect(() => {
    if (open) setMode('merge')
  }, [open])

  const parts = summary
    ? [
        `${summary.sessions} ${summary.sessions === 1 ? 'entreno' : 'entrenos'}`,
        `${summary.routines} ${summary.routines === 1 ? 'rutina' : 'rutinas'}`,
        summary.bodyLogs > 0 ? `${summary.bodyLogs} ${summary.bodyLogs === 1 ? 'medida' : 'medidas'}` : null,
      ].filter(Boolean)
    : []

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Importar datos"
      footer={
        <>
          <Button variant="glass" size="lg" block onClick={onClose}>
            Cancelar
          </Button>
          <Button variant={mode === 'replace' ? 'danger' : 'primary'} size="lg" block onClick={() => onConfirm(mode)}>
            {mode === 'replace' ? 'Reemplazar' : 'Mezclar'}
          </Button>
        </>
      }
    >
      <div className="pf-sheet">
        <div className="pf-import-file">
          <div className="pf-import-file__name truncate">{fileName}</div>
          <div className="pf-import-file__sub">{parts.join(' · ') || 'Sin entrenos ni rutinas'}</div>
        </div>
        {warnings.length > 0 && (
          <ul className="pf-warn" aria-label="Avisos">
            {warnings.slice(0, 4).map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        )}
        <div className="pf-choice" role="radiogroup" aria-label="Cómo importar">
          <button type="button" role="radio" aria-checked={mode === 'merge'} className="pf-choice__opt glass" onClick={() => setMode('merge')}>
            <GitMerge size={20} aria-hidden="true" />
            <span>
              <strong>Mezclar</strong>
              <small>Conserva lo que tienes y añade lo del archivo. Gana lo más reciente.</small>
            </span>
          </button>
          <button type="button" role="radio" aria-checked={mode === 'replace'} className="pf-choice__opt glass" onClick={() => setMode('replace')}>
            <RefreshCcw size={20} aria-hidden="true" />
            <span>
              <strong>Reemplazar</strong>
              <small>Borra lo actual y deja solo lo del archivo.</small>
            </span>
          </button>
        </div>
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ delete */

export function DeleteSheet({
  open,
  signedIn,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean
  signedIn: boolean
  busy: boolean
  onClose: () => void
  onConfirm: (alsoCloud: boolean) => void
}) {
  const [text, setText] = useState('')
  const [cloud, setCloud] = useState(true)
  useEffect(() => {
    if (open) {
      setText('')
      setCloud(true)
    }
  }, [open])
  const ok = confirmWordMatches(text)

  return (
    <Sheet
      open={open}
      onClose={busy ? () => undefined : onClose}
      title="Borrar todos los datos"
      footer={
        <>
          <Button variant="glass" size="lg" block onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button variant="danger" size="lg" block disabled={!ok || busy} onClick={() => onConfirm(signedIn && cloud)} icon={<Trash2 size={18} />}>
            {busy ? 'Borrando…' : 'Borrar todo'}
          </Button>
        </>
      }
    >
      <div className="pf-sheet">
        <div className="pf-danger-note">
          <AlertTriangle size={22} aria-hidden="true" />
          <p>Se eliminarán tus rutinas, entrenos, medidas y ajustes de este dispositivo. No se puede deshacer.</p>
        </div>
        <label className="pf-confirm">
          <span>
            Escribe <strong>BORRAR</strong> para confirmar
          </span>
          <input
            className="input pf-confirm__input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            placeholder="BORRAR"
            aria-label="Escribe BORRAR para confirmar"
          />
        </label>
        {signedIn && (
          <div className="pf-inline-row">
            <div className="grow">
              <div className="pf-inline-row__title">Borrar también mi copia en la nube</div>
              <div className="pf-inline-row__sub">Si no, se volverá a descargar al iniciar sesión.</div>
            </div>
            <Switch checked={cloud} onChange={setCloud} label="Borrar también mi copia en la nube" />
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ install */

export function InstallSheet({ open, ios, onClose }: { open: boolean; ios: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Instalar Gymfullness"
      footer={
        <Button variant="primary" size="lg" block onClick={onClose}>
          Entendido
        </Button>
      }
    >
      <div className="pf-sheet">
        <p className="muted">Ábrela como una app más: pantalla completa, sin barra del navegador y funciona sin internet.</p>
        {ios ? (
          <ol className="pf-steps">
            <li>
              <span className="pf-steps__ic">
                <Share size={20} aria-hidden="true" />
              </span>
              <span>
                Toca <strong>Compartir</strong> en la barra de Safari.
              </span>
            </li>
            <li>
              <span className="pf-steps__ic">
                <SquarePlus size={20} aria-hidden="true" />
              </span>
              <span>
                Elige <strong>Añadir a pantalla de inicio</strong>.
              </span>
            </li>
            <li>
              <span className="pf-steps__ic">
                <Plus size={20} aria-hidden="true" />
              </span>
              <span>
                Toca <strong>Añadir</strong>. Listo.
              </span>
            </li>
          </ol>
        ) : (
          <ol className="pf-steps">
            <li>
              <span className="pf-steps__ic">
                <MoreVertical size={20} aria-hidden="true" />
              </span>
              <span>Abre el menú de tu navegador.</span>
            </li>
            <li>
              <span className="pf-steps__ic">
                <SquarePlus size={20} aria-hidden="true" />
              </span>
              <span>
                Elige <strong>Instalar app</strong> o <strong>Añadir a pantalla de inicio</strong>.
              </span>
            </li>
          </ol>
        )}
      </div>
    </Sheet>
  )
}
