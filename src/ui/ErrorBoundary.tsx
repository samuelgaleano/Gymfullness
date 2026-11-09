import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button } from './Button'

interface State {
  error: Error | null
}

/**
 * Last line of defense: shows a calm recovery screen instead of a white page.
 * "Reintentar" reloads; "Restablecer datos locales" wipes the persisted store (after confirm) for the
 * worst case where corrupted data keeps crashing the app; "Descargar copia" saves what is recoverable first.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  private async backup() {
    try {
      const { get } = await import('idb-keyval')
      const raw = await get<string>('gymfullness:v1')
      if (!raw) return
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `gymfullness-copia-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 2000)
    } catch {
      /* nothing recoverable */
    }
  }

  private async reset() {
    if (!window.confirm('Se borrarán los datos guardados en este teléfono. ¿Continuar?')) return
    try {
      const { del } = await import('idb-keyval')
      await del('gymfullness:v1')
    } catch {
      /* ignore */
    }
    window.location.replace('/')
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div role="alert" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)', color: 'var(--text)' }}>
        <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 12, textAlign: 'center' }}>
          <h1 style={{ fontSize: 22, margin: 0 }}>Algo salió mal</h1>
          <p style={{ color: 'var(--text-2)', margin: 0 }}>
            Tus entrenos siguen guardados en este teléfono. Prueba a reintentar; si se repite, descarga una copia y restablece.
          </p>
          <Button variant="primary" size="lg" block onClick={() => window.location.reload()}>
            Reintentar
          </Button>
          <Button variant="glass" block onClick={() => void this.backup()}>
            Descargar copia de mis datos
          </Button>
          <Button variant="ghost" block onClick={() => void this.reset()}>
            Restablecer datos locales
          </Button>
        </div>
      </div>
    )
  }
}
