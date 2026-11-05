import { useState, type ReactNode } from 'react'
import { Flag, ListOrdered, Plus, Timer, Trash2 } from 'lucide-react'
import { Button, List, ListRow, Sheet } from '@/ui'
import { plural } from './helpers'

export function MenuSheet({
  open,
  onClose,
  canRest,
  onAdd,
  onOverview,
  onRest,
  onFinish,
  onDiscard,
}: {
  open: boolean
  onClose: () => void
  canRest: boolean
  onAdd: () => void
  onOverview: () => void
  onRest: () => void
  onFinish: () => void
  onDiscard: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Opciones">
      <div className="stack">
        <List>
          <ListRow icon={<Plus size={20} />} title="Añadir ejercicio" onClick={onAdd} chevron />
          <ListRow icon={<ListOrdered size={20} />} title="Ver todos y reordenar" onClick={onOverview} chevron />
          {canRest && <ListRow icon={<Timer size={20} />} title="Iniciar descanso" onClick={onRest} chevron />}
          <ListRow icon={<Flag size={20} />} title="Terminar entreno" onClick={onFinish} chevron />
        </List>
        <Button variant="danger" size="lg" block icon={<Trash2 size={18} />} onClick={onDiscard}>
          Descartar entreno
        </Button>
      </div>
    </Sheet>
  )
}

function Confirm({
  open,
  onClose,
  title,
  text,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  text: ReactNode
  children: ReactNode
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} hideClose>
      <p className="wk-confirm-text">{text}</p>
      <div className="wk-confirm-actions">{children}</div>
    </Sheet>
  )
}

export function FinishSheet({
  open,
  onClose,
  remaining,
  logged,
  onFinish,
  onDiscard,
}: {
  open: boolean
  onClose: () => void
  remaining: number
  logged: number
  onFinish: () => void
  onDiscard: () => void
}) {
  if (logged === 0) {
    return (
      <Confirm open={open} onClose={onClose} title="Aún no hay series" text="No has registrado ninguna serie, así que no hay nada que guardar.">
        <Button variant="glass" size="lg" block onClick={onClose}>
          Seguir entrenando
        </Button>
        <Button variant="danger" size="lg" block icon={<Trash2 size={18} />} onClick={onDiscard}>
          Descartar entreno
        </Button>
      </Confirm>
    )
  }
  return (
    <Confirm
      open={open}
      onClose={onClose}
      title="¿Terminar entreno?"
      text={remaining > 0 ? `Te faltan ${plural(remaining, 'serie', 'series')}. ¿Terminar igual?` : 'Hiciste todas las series. ¡Buen trabajo!'}
    >
      <Button variant="primary" size="lg" block onClick={onFinish}>
        {remaining > 0 ? 'Terminar igual' : 'Terminar'}
      </Button>
      <Button variant="glass" size="lg" block onClick={onClose}>
        Seguir entrenando
      </Button>
    </Confirm>
  )
}

export function DiscardSheet({
  open,
  onClose,
  logged,
  onDiscard,
}: {
  open: boolean
  onClose: () => void
  logged: number
  onDiscard: () => void
}) {
  return (
    <Confirm
      open={open}
      onClose={onClose}
      title="¿Descartar entreno?"
      text={logged > 0 ? `Se perderán ${plural(logged, 'serie registrada', 'series registradas')}. Esto no se puede deshacer.` : 'Se cerrará este entreno sin guardar nada.'}
    >
      <Button variant="danger" size="lg" block icon={<Trash2 size={18} />} onClick={onDiscard}>
        Descartar
      </Button>
      <Button variant="glass" size="lg" block onClick={onClose}>
        Cancelar
      </Button>
    </Confirm>
  )
}

export function NotesSheet({
  open,
  onClose,
  title,
  initial,
  onSave,
}: {
  open: boolean
  onClose: () => void
  title: string
  initial: string
  onSave: (text: string) => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Notas">
      <NotesBody key={String(open)} title={title} initial={initial} onSave={onSave} onClose={onClose} />
    </Sheet>
  )
}

function NotesBody({ title, initial, onSave, onClose }: { title: string; initial: string; onSave: (t: string) => void; onClose: () => void }) {
  const [text, setText] = useState(initial)
  return (
    <div className="stack">
      <p className="muted">{title}</p>
      <textarea
        className="input"
        value={text}
        maxLength={600}
        rows={4}
        placeholder="Ajuste del asiento, sensaciones, molestias…"
        aria-label="Notas del ejercicio"
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="primary"
        size="lg"
        block
        onClick={() => {
          onSave(text.trim())
          onClose()
        }}
      >
        Guardar
      </Button>
    </div>
  )
}
