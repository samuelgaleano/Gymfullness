import type { ReactNode } from 'react'
import { ChevronLeft } from 'lucide-react'
import { IconButton } from './Button'

/** iOS-style large title header for tab screens. */
export function Header({ title, eyebrow, actions }: { title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="header">
      <div className="grow">
        {eyebrow && <div className="header__eyebrow">{eyebrow}</div>}
        <h1 className="header__title">{title}</h1>
      </div>
      {actions && <div className="row">{actions}</div>}
    </header>
  )
}

/** Compact top bar with back button for pushed screens. */
export function TopBar({ title, onBack, right }: { title?: ReactNode; onBack?: () => void; right?: ReactNode }) {
  return (
    <div className="topbar">
      {onBack ? (
        <IconButton label="Atrás" variant="glass" onClick={onBack}>
          <ChevronLeft size={22} />
        </IconButton>
      ) : (
        <span style={{ width: 48 }} />
      )}
      <div className="topbar__title truncate" role="heading" aria-level={1}>
        {title}
      </div>
      <div style={{ minWidth: 48, display: 'flex', justifyContent: 'flex-end' }}>{right}</div>
    </div>
  )
}
