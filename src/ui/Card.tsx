import type { HTMLAttributes, ButtonHTMLAttributes } from 'react'

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  pad?: 'md' | 'lg' | 'none'
  accent?: boolean
}

export function Card({ pad = 'md', accent, className = '', ...rest }: CardProps) {
  const cls = ['card', 'glass', pad === 'lg' && 'card--pad-lg', pad === 'none' && 'card--flush', accent && 'card--accent', className]
    .filter(Boolean)
    .join(' ')
  return <div className={cls} {...rest} />
}

interface CardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  pad?: 'md' | 'lg'
  accent?: boolean
}

/** A whole card that is tappable. */
export function CardButton({ pad = 'md', accent, className = '', type = 'button', ...rest }: CardButtonProps) {
  const cls = ['card', 'glass', 'card--interactive', pad === 'lg' && 'card--pad-lg', accent && 'card--accent', className]
    .filter(Boolean)
    .join(' ')
  return <button type={type} className={cls} {...rest} />
}
