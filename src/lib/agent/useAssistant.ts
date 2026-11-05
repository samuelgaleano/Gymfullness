/**
 * React binding of the assistant: a small global zustand store (the conversation survives screen changes)
 * plus the `useAssistant()` hook the UI uses.
 *
 *   const a = useAssistant()
 *   a.send('80 por 10')                       // typed text
 *   a.send(transcript, { source: 'voice' })   // from useHoldToTalk
 *   a.pending                                  // destructive actions waiting: a.confirm(id) / a.reject(id)
 *   speak(toSpokenText(reply.text), …)         // read the reply aloud with tts.speak
 */
import { useCallback } from 'react'
import { create } from 'zustand'
import { useLocation } from 'wouter'
import type { SetSource } from '../types'
import { runAgent } from './run'
import { cancelPending, confirmPending, clearPending } from './tools'
import { getSuggestions, type Suggestion } from './suggestions'
import type { AgentContext, AgentEvent, AgentResult, PendingAction } from './types'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant'
  text: string
  at: number
  source?: AgentResult['source']
  tools?: AgentResult['tools']
}

interface AssistantState {
  messages: ChatMessage[]
  busy: boolean
  /** Short live status while busy ("Pensando…", "Registrando serie…"). */
  status: string | null
  pending: PendingAction[]
}

export const useAssistantStore = create<AssistantState>(() => ({ messages: [], busy: false, status: null, pending: [] }))

let seq = 0
let controller: AbortController | null = null
const set = useAssistantStore.setState
const push = (m: Omit<ChatMessage, 'id' | 'at'>) => set((s) => ({ messages: [...s.messages, { ...m, id: ++seq, at: Date.now() }].slice(-60) }))

const STATUS: Record<string, string> = {
  log_set: 'Registrando serie…',
  get_progress: 'Revisando tu progreso…',
  search_exercises: 'Buscando ejercicios…',
  create_routine: 'Preparando la rutina…',
}

export interface SendOptions {
  source?: SetSource
  ctx?: AgentContext
  navigate?: (route: string) => void
  /** Only the local router (no AI call). */
  noAI?: boolean
}

/** Send a message through the agent. Resolves with the result (also stored in the conversation). */
export async function sendToAssistant(text: string, opts: SendOptions = {}): Promise<AgentResult | null> {
  const t = text.trim()
  if (!t || useAssistantStore.getState().busy) return null
  const history = useAssistantStore.getState().messages.map((m) => ({ role: m.role, text: m.text }))
  push({ role: 'user', text: t })
  controller = new AbortController()
  set({ busy: true, status: null })
  const onEvent = (e: AgentEvent) => {
    if (e.type === 'thinking') set({ status: 'Pensando…' })
    else if (e.type === 'tool_start') set({ status: STATUS[e.name] ?? 'Trabajando en eso…' })
  }
  try {
    const result = await runAgent({ text: t, history, ctx: opts.ctx, signal: controller.signal, onEvent, navigate: opts.navigate, source: opts.source, noAI: opts.noAI })
    if (result.source !== 'aborted') {
      push({ role: 'assistant', text: result.text, source: result.source, tools: result.tools })
      if (result.pending.length) set((s) => ({ pending: [...s.pending, ...result.pending] }))
    }
    return result
  } finally {
    controller = null
    set({ busy: false, status: null })
  }
}

export function cancelAssistant(): void {
  controller?.abort()
}

export function confirmAssistantAction(id: string, navigate?: (route: string) => void): string {
  const out = confirmPending(id, { navigate, origin: 'model', confirmed: true })
  set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
  push({ role: 'assistant', text: out.summary, source: 'local', tools: [{ name: 'confirm', ok: out.ok, summary: out.summary }] })
  return out.summary
}

export function rejectAssistantAction(id: string, silent = false): void {
  cancelPending(id)
  set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }))
  if (silent) return
  push({ role: 'assistant', text: 'Listo, no hice ningún cambio.', source: 'local' })
}

export function clearAssistant(): void {
  controller?.abort()
  clearPending()
  set({ messages: [], busy: false, status: null, pending: [] })
}

export interface Assistant extends AssistantState {
  send: (text: string, opts?: Omit<SendOptions, 'navigate'>) => Promise<AgentResult | null>
  cancel: () => void
  confirm: (id: string) => string
  reject: (id: string, silent?: boolean) => void
  clear: () => void
  suggestions: Suggestion[]
}

export function useAssistant(): Assistant {
  const [route, navigate] = useLocation()
  const state = useAssistantStore()
  const nav = useCallback((r: string) => navigate(r), [navigate])
  const send = useCallback(
    (text: string, opts: Omit<SendOptions, 'navigate'> = {}) => sendToAssistant(text, { ...opts, navigate: nav, ctx: { route, ...opts.ctx } }),
    [nav, route],
  )
  const confirm = useCallback((id: string) => confirmAssistantAction(id, nav), [nav])
  return {
    ...state,
    send,
    cancel: cancelAssistant,
    confirm,
    reject: rejectAssistantAction,
    clear: clearAssistant,
    suggestions: getSuggestions({ route }),
  }
}
