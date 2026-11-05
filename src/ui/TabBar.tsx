import { Link, useLocation } from 'wouter'
import { canNavigate } from './navGuard'
import { Home, ListChecks, TrendingUp, User } from 'lucide-react'

const TABS = [
  { href: '/', label: 'Hoy', Icon: Home, match: (p: string) => p === '/' },
  { href: '/routines', label: 'Rutinas', Icon: ListChecks, match: (p: string) => p.startsWith('/routines') || p.startsWith('/exercises') },
  { href: '/progress', label: 'Progreso', Icon: TrendingUp, match: (p: string) => p.startsWith('/progress') || p.startsWith('/history') },
  { href: '/profile', label: 'Perfil', Icon: User, match: (p: string) => p.startsWith('/profile') },
]

export function TabBar() {
  const [path] = useLocation()
  return (
    <nav className="tabbar glass" aria-label="Navegación principal">
      {TABS.map(({ href, label, Icon, match }) => (
        <Link
          key={href}
          href={href}
          className="tabbar__item"
          aria-current={match(path) ? 'page' : undefined}
          onClick={(e) => {
            if (!canNavigate(href)) e.preventDefault()
          }}
        >
          <Icon size={22} strokeWidth={2.2} />
          <span>{label}</span>
        </Link>
      ))}
    </nav>
  )
}
