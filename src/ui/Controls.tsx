import type { ReactNode } from 'react'

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: ReactNode }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="seg glass" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="seg__opt"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} className="switch" onClick={() => onChange(!checked)} />
  )
}

export function Chip({
  children,
  tone,
  icon,
}: {
  children: ReactNode
  tone?: 'accent' | 'rest' | 'pr' | 'danger'
  icon?: ReactNode
}) {
  return (
    <span className={`chip ${tone ? `chip--${tone}` : ''}`}>
      {icon}
      {children}
    </span>
  )
}

/** Toggleable chip button (filters, quick picks). */
export function ChipButton({
  children,
  pressed,
  onClick,
  icon,
}: {
  children: ReactNode
  pressed?: boolean
  onClick?: () => void
  icon?: ReactNode
}) {
  return (
    <button type="button" className="chip" aria-pressed={pressed} onClick={onClick}>
      {icon}
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon && <div className="empty__icon">{icon}</div>}
      <div className="empty__title">{title}</div>
      {text && <p className="empty__text">{text}</p>}
      {action}
    </div>
  )
}

export function Stat({ value, label }: { value: ReactNode; label: ReactNode }) {
  return (
    <div className="stat">
      <div className="stat__value num">{value}</div>
      <div className="stat__label">{label}</div>
    </div>
  )
}

export function Spinner() {
  return <div className="spinner" role="status" aria-label="Cargando" />
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
    </div>
  )
}
