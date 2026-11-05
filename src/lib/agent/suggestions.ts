/** Quick-prompt chips for the assistant, by screen and workout state. Pure over the store snapshot. */
import { useApp } from '@/store/app'
import { getCursorInfo } from '../workout/engine'
import type { AgentContext } from './types'

export interface Suggestion {
  id: string
  /** Chip text. */
  label: string
  /** Text to send (or to put in the input when `send` is false). */
  text: string
  /** false → prefill the input so the user completes it. */
  send: boolean
}

const chip = (id: string, label: string, text = label, send = true): Suggestion => ({ id, label, text, send })

export function getSuggestions(ctx: AgentContext = {}, max = 5): Suggestion[] {
  const s = useApp.getState()
  const route = ctx.route ?? '/'
  const out: Suggestion[] = []
  const session = s.activeSession

  if (session) {
    const info = getCursorInfo(session)
    if (session.rest) {
      out.push(chip('skip-rest', 'Saltar descanso', 'saltar descanso'), chip('more-rest', '+30 s', 'más 30 segundos'))
    } else if (!info.isFinished) {
      out.push(chip('same', 'Igual que la anterior', 'igual'))
    }
    if (info.isFinished) out.push(chip('finish', 'Terminar entreno', 'terminar entreno'))
    out.push(
      chip('whats-next', '¿Qué sigue?', '¿qué sigue?'),
      chip('next-ex', 'Siguiente ejercicio', 'siguiente ejercicio'),
      chip('swap', 'Cambia este ejercicio', 'cambia este ejercicio'),
      chip('how', '¿Cómo se hace?', '¿cómo se hace este ejercicio?'),
      chip('undo', 'Deshacer', 'deshacer'),
      chip('progress', '¿Cómo voy?', '¿cómo voy?'),
    )
  } else {
    out.push(chip('today', '¿Qué entreno hoy?', '¿qué entreno hoy?'), chip('start', 'Empezar entreno', 'empieza el entreno'))
    if (route.startsWith('/exercises/')) out.push(chip('how', '¿Cómo se hace?', '¿cómo se hace este ejercicio?'))
    if (route.startsWith('/routines')) out.push(chip('make', 'Crea una rutina', 'Crea una rutina de pecho y tríceps'))
    if (route.startsWith('/profile')) out.push(chip('units', 'Cambiar a libras', 'cambia a libras'))
    out.push(chip('progress', '¿Cómo voy?', '¿cómo voy?'), chip('weight', 'Registrar mi peso', 'registra mi peso ', false))
    if (!route.startsWith('/progress')) out.push(chip('open-progress', 'Ver progreso', 've a progreso'))
  }
  const seen = new Set<string>()
  return out.filter((x) => !seen.has(x.id) && seen.add(x.id)).slice(0, max)
}
