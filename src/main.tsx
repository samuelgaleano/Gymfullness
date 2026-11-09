import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/font.css'
import './styles/base.css'
import './ui/ui.css'
import { App } from './App'
import { ErrorBoundary } from './ui/ErrorBoundary'
import { recoverFromStaleChunks, registerPWA } from './pwa'
import { initAuth } from './store/auth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)

registerPWA()
recoverFromStaleChunks()
// Optional cloud: restores a previous Google session (lazy SDK). No-op for guests.
void initAuth()
