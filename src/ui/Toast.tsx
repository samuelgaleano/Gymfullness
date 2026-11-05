import { useEffect } from 'react'
import { create } from 'zustand'
import { CheckCircle2, Info, Trophy, AlertCircle } from 'lucide-react'

export type ToastKind = 'success' | 'info' | 'pr' | 'error'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
  actionLabel?: string
  onAction?: () => void
  duration: number
}

interface ToastState {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id' | 'duration'> & { duration?: number }) => number
  dismiss: (id: number) => void
}

let seq = 1
const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = seq++
    // keep at most 2 visible — newest wins
    set((s) => ({ items: [...s.items.slice(-1), { duration: 3200, ...t, id }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
}))

/** Fire-and-forget toast. `toast.success('Serie guardada', { actionLabel: 'Deshacer', onAction })`. */
export const toast = {
  show: (message: string, opts: Partial<Omit<ToastItem, 'id' | 'message'>> = {}) =>
    useToasts.getState().push({ kind: 'info', message, ...opts }),
  success: (message: string, opts: Partial<Omit<ToastItem, 'id' | 'message' | 'kind'>> = {}) =>
    useToasts.getState().push({ kind: 'success', message, ...opts }),
  pr: (message: string, opts: Partial<Omit<ToastItem, 'id' | 'message' | 'kind'>> = {}) =>
    useToasts.getState().push({ kind: 'pr', message, duration: 4200, ...opts }),
  error: (message: string, opts: Partial<Omit<ToastItem, 'id' | 'message' | 'kind'>> = {}) =>
    useToasts.getState().push({ kind: 'error', message, duration: 4500, ...opts }),
  dismiss: (id: number) => useToasts.getState().dismiss(id),
}

const ICONS = { success: CheckCircle2, info: Info, pr: Trophy, error: AlertCircle }

function ToastView({ item }: { item: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  useEffect(() => {
    const t = setTimeout(() => dismiss(item.id), item.duration)
    return () => clearTimeout(t)
  }, [item.id, item.duration, dismiss])
  const Icon = ICONS[item.kind]
  return (
    <div className={`toast glass toast--${item.kind}`} role="status" onClick={() => !item.onAction && dismiss(item.id)}>
      <Icon size={20} className="toast__icon" />
      <span>{item.message}</span>
      {item.actionLabel && (
        <button
          className="toast__action"
          onClick={(e) => {
            e.stopPropagation()
            item.onAction?.()
            dismiss(item.id)
          }}
        >
          {item.actionLabel}
        </button>
      )}
    </div>
  )
}

export function Toaster() {
  const items = useToasts((s) => s.items)
  return (
    <div className="toaster" aria-live="polite">
      {items.map((t) => (
        <ToastView key={t.id} item={t} />
      ))}
    </div>
  )
}
