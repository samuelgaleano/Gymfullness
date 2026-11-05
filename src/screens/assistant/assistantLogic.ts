/** Pure helpers of the assistant UI (no React). */
import type { ChatMessage } from '@/lib/agent'

const strip = (t: string) =>
  t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

const YES = new Set(['si', 'sip', 'claro', 'dale', 'ok', 'okey', 'vale', 'confirmo', 'confirmar', 'confirma', 'adelante', 'hazlo', 'de acuerdo', 'si hazlo', 'si dale', 'si claro', 'si confirmo', 'si por favor', 'por favor', 'correcto', 'afirmativo'])
const NO = new Set(['no', 'nop', 'nel', 'cancela', 'cancelar', 'cancelalo', 'mejor no', 'no gracias', 'no lo hagas', 'negativo', 'olvidalo', 'para', 'detente', 'no no'])

/** A spoken/typed yes or no only answers a question asked this recently; older cards need a tap. */
export const ANSWER_WINDOW_MS = 90_000

/** "sí" / "dale" / "confirmo" answers to a pending confirmation. */
export const isYes = (text: string): boolean => YES.has(strip(text))
/** "no" / "cancela" answers to a pending confirmation. */
export const isNo = (text: string): boolean => NO.has(strip(text))

/** Conversation is per day: a conversation whose last message is from another day is stale. */
export function isStaleConversation(messages: Pick<ChatMessage, 'at'>[], now = Date.now()): boolean {
  if (!messages.length) return false
  const a = new Date(messages[messages.length - 1].at)
  const b = new Date(now)
  return a.getFullYear() !== b.getFullYear() || a.getMonth() !== b.getMonth() || a.getDate() !== b.getDate()
}

export type AiMode = 'ai' | 'basic'

/** Badge state: "basic" when only the local router can answer. */
export function aiMode(p: { useAI: boolean; available: boolean | null; online: boolean; remaining: number }): { mode: AiMode; reason: string } {
  if (!p.useAI) return { mode: 'basic', reason: 'IA apagada en Ajustes' }
  if (!p.online) return { mode: 'basic', reason: 'Sin conexión' }
  if (p.available === false) return { mode: 'basic', reason: 'IA no disponible' }
  if (p.remaining <= 0) return { mode: 'basic', reason: 'Límite diario de IA' }
  return { mode: 'ai', reason: '' }
}

export const capLabel = (u: { used: number; cap: number; remaining: number }): string =>
  u.remaining <= 0 ? `Llegaste al límite de hoy (${u.cap} consultas con IA). Mañana vuelven.` : `${u.used}/${u.cap} consultas con IA hoy`

/** Tool chips worth showing under a message (drops ones that only repeat the message text). */
export function visibleTools(m: Pick<ChatMessage, 'text' | 'tools'>): NonNullable<ChatMessage['tools']> {
  const text = m.text.trim()
  return (m.tools ?? []).filter((t) => t.summary && t.summary.trim() !== text && !t.summary.trim().startsWith('¿'))
}

export const formatRest = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`

export const FIRST_HINTS = ['«80 kilos 10 repeticiones»', '«siguiente»', '«cómo voy en press de banca»'] as const

/** The message is just the outcome of its actions: show it as chips only (no duplicate bubble). */
export function isChipOnly(m: Pick<ChatMessage, 'text' | 'tools'>): boolean {
  const t = m.text.trim()
  // a question ("¿Terminar el entreno?") is a pending confirmation, not a done action
  return !!m.tools?.length && !t.startsWith('¿') && m.tools.every((x) => x.summary.trim() === t)
}
