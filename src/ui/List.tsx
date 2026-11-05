import type { ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import { Link } from 'wouter'

interface RowProps {
  icon?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  chevron?: boolean
  onClick?: () => void
  href?: string
}

export function List({ children }: { children: ReactNode }) {
  return <div className="list glass">{children}</div>
}

export function ListRow({ icon, title, subtitle, trailing, chevron, onClick, href }: RowProps) {
  const inner = (
    <>
      {icon && <div className="list-row__icon">{icon}</div>}
      <div className="grow">
        <div className="list-row__title truncate">{title}</div>
        {subtitle && <div className="list-row__sub truncate">{subtitle}</div>}
      </div>
      {(trailing || chevron) && (
        <div className="list-row__trail">
          {trailing}
          {chevron && <ChevronRight size={18} />}
        </div>
      )}
    </>
  )
  if (href)
    return (
      <Link href={href} className="list-row">
        {inner}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" className="list-row" onClick={onClick}>
        {inner}
      </button>
    )
  return <div className="list-row">{inner}</div>
}
