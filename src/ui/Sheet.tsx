import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { IconButton } from './Button'

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /** Hide the close (X) button — e.g. for blocking confirmations. */
  hideClose?: boolean
  labelledBy?: string
}

/** Bottom sheet (dialog on desktop). Closes on scrim tap, Escape, or swipe-down on the grab handle. */
export function Sheet({ open, onClose, title, children, footer, hideClose }: SheetProps) {
  const ref = useRef<HTMLDivElement>(null)
  const startY = useRef<number | null>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // focus first focusable for a11y
    requestAnimationFrame(() => {
      const el = ref.current?.querySelector<HTMLElement>('[autofocus], input, button:not([data-close]), [tabindex]')
      el?.focus({ preventScroll: true })
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [open, onClose])

  if (!open) return null

  const onPointerDown = (e: React.PointerEvent) => {
    startY.current = e.clientY
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (startY.current === null || !ref.current) return
    const dy = Math.max(0, e.clientY - startY.current)
    ref.current.style.transform = `translateY(${dy}px)`
  }
  const onPointerUp = (e: React.PointerEvent) => {
    if (startY.current === null || !ref.current) return
    const dy = e.clientY - startY.current
    startY.current = null
    ref.current.style.transform = ''
    if (dy > 90) onClose()
  }

  return createPortal(
    <div className="sheet-root" role="presentation">
      <div className="sheet-scrim" onClick={onClose} />
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined}>
        <div
          style={{ padding: '4px 0', touchAction: 'none', cursor: 'grab' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="sheet__grab" />
        </div>
        {(title || !hideClose) && (
          <div className="sheet__head">
            <div className="sheet__title">{title}</div>
            {!hideClose && (
              <IconButton label="Cerrar" variant="glass" size="sm" onClick={onClose} data-close>
                <X size={18} />
              </IconButton>
            )}
          </div>
        )}
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
