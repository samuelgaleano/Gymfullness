import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter/wght.css'
import './styles/base.css'
import './ui/ui.css'
import { App } from './App'
import { registerPWA } from './pwa'
import { initAuth } from './store/auth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

registerPWA()
// Optional cloud: restores a previous Google session (lazy SDK). No-op for guests.
void initAuth()
