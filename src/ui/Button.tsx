import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type Variant = 'primary' | 'glass' | 'ghost' | 'danger' | 'rest'
type Size = 'sm' | 'md' | 'lg' | 'xl'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  block?: boolean
  icon?: ReactNode
  iconRight?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'glass', size = 'md', block, icon, iconRight, className = '', children, type = 'button', ...rest },
  ref,
) {
  const cls = ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button ref={ref} type={type} className={cls} {...rest}>
      {icon}
      {children}
      {iconRight}
    </button>
  )
})

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string // accessible name (required — icon-only)
  variant?: 'glass' | 'plain'
  size?: 'sm' | 'md' | 'lg'
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, variant = 'plain', size = 'md', className = '', children, type = 'button', ...rest },
  ref,
) {
  const cls = ['icon-btn', `icon-btn--${variant}`, size !== 'md' && `icon-btn--${size}`, className].filter(Boolean).join(' ')
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={cls} {...rest}>
      {children}
    </button>
  )
})
