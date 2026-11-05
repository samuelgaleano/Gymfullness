/**
 * Agent loop. `runAgent` tries the free local router first; otherwise (when /api/agent is enabled and the
 * soft daily cap allows) it loops up to MAX_MODEL_TURNS model turns: POST /api/agent → execute the tool calls
 * IN THE BROWSER → send the results back → until the model answers with plain text.
 * It never dead-ends: any network/AI failure degrades to a useful local reply.
 */
import type { SetSource } from '../types'
import { detectIntent, localAnswer } from '../coach'
import { useApp, getExercise } from '@/store/app'
import { getCursorInfo } from '../workout/engine'
import { handleLocally, LOCAL_HELP } from './local'
import { clean, contextSnapshot, executeTool, getTool } from './tools'
import { toolsDigest } from './toolDefs'
import type { AgentContext, AgentEvent, AgentMessage, AgentResult, PendingAction, ToolCall, ToolOutcome, ToolRuntime } from './types'

export const AGENT_ENDPOINT = '/api/agent'
export const MAX_MODEL_TURNS = 4
export const AI_DAILY_CAP = 40
export const MAX_HISTORY = 8
export const MAX_WIRE_MESSAGES = 12
export const MAX_TOOL_RESULT_CHARS = 1500
const REQUEST_TIMEOUT_MS = 20_000
const AVAILABILITY_TIMEOUT_MS = 5_000
const AVAILABILITY_RETRY_MS = 2 * 60_000
const USAGE_KEY = 'gymfullness:agent-usage'

/* ================================================================ wire format (shared with functions/api/agent.ts) */

export type WireToolCall = { id: string; name: string; args: Record<string, unknown> }
export type WireMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text?: string; tool_calls?: WireToolCall[] }
  | { role: 'tool'; results: { id: string; name: string; content: string }[] }

interface ServerReply {
  message: { text: string; tool_calls: WireToolCall[] }
  usage?: Record<string, number>
}

/* ================================================================ soft daily cap (per install) */

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

export function getAiUsage(cap = AI_DAILY_CAP, now: Date = new Date()): { used: number; cap: number; remaining: number } {
  let used = 0
  try {
    const raw = localStorage.getItem(USAGE_KEY)
    const v = raw ? (JSON.parse(raw) as { day?: string; n?: number }) : null
    if (v && v.day === dayKey(now) && typeof v.n === 'number') used = v.n
  } catch {
    /* storage unavailable: no cap */
  }
  return { used, cap, remaining: Math.max(0, cap - used) }
}

function bumpUsage(now: Date = new Date()): void {
  try {
    const { used } = getAiUsage(AI_DAILY_CAP, now)
    localStorage.setItem(USAGE_KEY, JSON.stringify({ day: dayKey(now), n: used + 1 }))
  } catch {
    /* ignore */
  }
}

/* ================================================================ availability (GET once, cached) */

let availability: Promise<boolean> | null = null
let availabilityExpiresAt = 0
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false

async function checkAvailability(): Promise<{ enabled: boolean; definitive: boolean }> {
  if (isOffline()) return { enabled: false, definitive: false }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), AVAILABILITY_TIMEOUT_MS)
  try {
    const res = await fetch(AGENT_ENDPOINT, { method: 'GET', headers: { Accept: 'application/json' }, cache: 'no-store', signal: ctrl.signal })
    if (res.status === 404 || res.status === 405) return { enabled: false, definitive: true }
    if (!res.ok) return { enabled: false, definitive: false }
    if (!(res.headers.get('content-type') ?? '').includes('application/json')) return { enabled: false, definitive: true }
    const body = (await res.json()) as unknown
    return { enabled: !!body && typeof body === 'object' && (body as { enabled?: unknown }).enabled === true, definitive: true }
  } catch {
    return { enabled: false, definitive: false }
  } finally {
    clearTimeout(timer)
  }
}

/** Whether the AI endpoint exists on this deploy. Checked once and cached (transient failures retry after 2 min). */
export function agentAvailable(): Promise<boolean> {
  if (availability && Date.now() < availabilityExpiresAt) return availability
  availabilityExpiresAt = Number.POSITIVE_INFINITY
  const p = checkAvailability().then(({ enabled, definitive }) => {
    if (availability === p) availabilityExpiresAt = definitive ? Number.POSITIVE_INFINITY : Date.now() + AVAILABILITY_RETRY_MS
    return enabled
  })
  availability = p
  return p
}

function markUnavailable(): void {
  availability = Promise.resolve(false)
  availabilityExpiresAt = Date.now() + AVAILABILITY_RETRY_MS
}

export function __resetAgentForTests(): void {
  availability = null
  availabilityExpiresAt = 0
}

/* ================================================================ model call */

type CallResult =
  | { ok: true; reply: ServerReply }
  | { ok: false; reason: 'aborted' | 'limit' | 'disabled' | 'error' }

async function callAgent(messages: WireMessage[], signal?: AbortSignal): Promise<CallResult> {
  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort, { once: true })
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(AGENT_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ messages, toolsDigest: toolsDigest() }),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      if (res.status === 429) return { ok: false, reason: 'limit' }
      if (res.status === 404 || res.status === 503) {
        markUnavailable()
        return { ok: false, reason: 'disabled' }
      }
      return { ok: false, reason: 'error' }
    }
    const body = (await res.json()) as unknown
    const m = body && typeof body === 'object' ? (body as { message?: unknown }).message : null
    if (!m || typeof m !== 'object') return { ok: false, reason: 'error' }
    const rawText = (m as { text?: unknown }).text
    const rawCalls = (m as { tool_calls?: unknown }).tool_calls
    const calls: WireToolCall[] = []
    if (Array.isArray(rawCalls)) {
      for (const c of rawCalls.slice(0, 4)) {
        if (!c || typeof c !== 'object') continue
        const { id, name, args } = c as { id?: unknown; name?: unknown; args?: unknown }
        if (typeof name !== 'string') continue
        calls.push({
          id: typeof id === 'string' && /^[\w-]{1,64}$/.test(id) ? id : `c${calls.length}_${Math.random().toString(36).slice(2, 8)}`,
          name,
          args: args && typeof args === 'object' && !Array.isArray(args) ? (args as Record<string, unknown>) : {},
        })
      }
    }
    const usage = (body as { usage?: unknown }).usage
    return {
      ok: true,
      reply: { message: { text: typeof rawText === 'string' ? rawText.trim() : '', tool_calls: calls }, usage: usage && typeof usage === 'object' ? (usage as Record<string, number>) : undefined },
    }
  } catch {
    return { ok: false, reason: signal?.aborted ? 'aborted' : 'error' }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

/* ================================================================ conversation building */

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** Tool result as the model sees it: small JSON, capped. */
export function toolResultContent(o: ToolOutcome): string {
  const s = JSON.stringify({ ok: o.ok, result: o.result, summary: o.summary })
  return s.length > MAX_TOOL_RESULT_CHARS ? `${s.slice(0, MAX_TOOL_RESULT_CHARS)}…[recortado]` : s
}

function buildUserMessage(text: string, ctx: AgentContext): string {
  let block = ''
  try {
    block = JSON.stringify(contextSnapshot({ route: ctx.route, full: false }))
  } catch {
    block = ''
  }
  return `${block ? `<contexto>${clip(block, 1400)}</contexto>\n\n` : ''}Mensaje del usuario: ${text}`
}

/** Last history messages as plain text turns; always starts with a user turn and alternates cleanly. */
export function buildWire(history: AgentMessage[], userText: string, ctx: AgentContext): WireMessage[] {
  const items: WireMessage[] = []
  for (const h of history.slice(-MAX_HISTORY)) {
    const t = clip(clean(h.text, 700) || '', 600)
    if (!t) continue
    const last = items[items.length - 1]
    if (last && last.role === h.role) continue // keep strict alternation
    items.push(h.role === 'user' ? { role: 'user', text: t } : { role: 'assistant', text: t })
  }
  while (items.length && items[0].role !== 'user') items.shift()
  if (items.length && items[items.length - 1].role === 'user') items.pop()
  items.push({ role: 'user', text: buildUserMessage(clip(userText, 500), ctx) })
  return items
}

/** Keep the request within the server limit by dropping the oldest history turns. */
function fit(messages: WireMessage[]): WireMessage[] {
  let out = messages.slice()
  // older tool rounds only need a gist: keep the newest round whole, shrink the rest (the server body limit is small)
  let lastTool = -1
  out.forEach((m, i) => {
    if (m.role === 'tool') lastTool = i
  })
  out = out.map((m, i) =>
    m.role === 'tool' && i < lastTool ? { ...m, results: m.results.map((r) => ({ ...r, content: r.content.length > 300 ? `${r.content.slice(0, 300)}…[recortado]` : r.content })) } : m,
  )
  while (out.length > MAX_WIRE_MESSAGES && out.length > 1) {
    out.shift()
    while (out.length > 1 && out[0].role !== 'user') out.shift()
  }
  return out
}

/* ================================================================ execution */

export interface RunAgentOptions {
  text: string
  history?: AgentMessage[]
  ctx?: AgentContext
  signal?: AbortSignal
  onEvent?: (e: AgentEvent) => void
  /** Opens a route in the UI (wouter navigate). */
  navigate?: (route: string) => void
  /** How logged sets are labelled ('voice' when the text came from the microphone). */
  source?: SetSource
  /** User turned "usar IA" off: only the local router answers. */
  noAI?: boolean
}

function execAll(calls: ToolCall[], rt: ToolRuntime, emit: (e: AgentEvent) => void, acc: AgentResult['tools'], pending: PendingAction[]): ToolOutcome[] {
  for (const c of calls) emit({ type: 'tool_start', id: c.id, name: c.name, args: c.args })
  return calls.map((c) => {
    const out = executeTool(c, rt)
    acc.push({ name: c.name, ok: out.ok, summary: out.summary, ...(out.undo ? { undo: out.undo } : {}) })
    emit({ type: 'tool_end', id: c.id, name: c.name, ok: out.ok, summary: out.summary })
    if (out.pending) {
      pending.push(out.pending)
      emit({ type: 'confirm_needed', pending: out.pending })
    }
    return out
  })
}

const summariesOf = (tools: AgentResult['tools']) => [...new Set(tools.map((t) => t.summary).filter(Boolean))].join(' ')

/** What we can still say when the AI is unavailable: a technique answer, or a short help. */
export function fallbackText(text: string, ctx: AgentContext, reason: 'unavailable' | 'error' | 'limit'): string {
  const s = useApp.getState()
  const cur = s.activeSession ? getCursorInfo(s.activeSession).exercise : null
  const ex = ctx.exerciseId ? getExercise(ctx.exerciseId) : cur ? getExercise(cur.exerciseId) : undefined
  if (detectIntent(text) !== 'general') return localAnswer(text, { exercise: ex, profile: s.profile })
  if (reason === 'limit') return `La IA llegó a su límite por ahora. Esto sí puedo hacer sin ella: ${LOCAL_HELP}`
  if (reason === 'unavailable') return `La IA no está activada en esta versión de la app. Esto sí puedo hacer: ${LOCAL_HELP}`
  return `No pude conectar con la IA; esto sí puedo hacer: ${LOCAL_HELP}`
}

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const ctx = opts.ctx ?? {}
  const text = opts.text.trim()
  const tools: AgentResult['tools'] = []
  const pending: PendingAction[] = []
  const rt: ToolRuntime = { navigate: opts.navigate, source: opts.source }
  const emit = (e: AgentEvent) => {
    try {
      opts.onEvent?.(e)
    } catch {
      /* a UI listener must never break the loop */
    }
  }
  const finish = (r: Omit<AgentResult, 'tools' | 'pending'>): AgentResult => {
    const result: AgentResult = { ...r, tools, pending }
    emit({ type: 'final', result })
    return result
  }

  if (!text) return finish({ text: 'No escuché nada. Prueba de nuevo.', source: 'local', usedAI: false })

  /* 1. free local router */
  const local = handleLocally(text, ctx)
  if (local.handled) {
    const outs = execAll(local.actions, { ...rt, origin: 'local' }, emit, tools, pending)
    const failed = outs.find((o) => !o.ok)
    const answer = pending.length ? pending[0].prompt : failed ? failed.summary : local.reply || summariesOf(tools) || 'Listo.'
    return finish({ text: answer, source: 'local', usedAI: false })
  }

  /* 2. AI (guarded) */
  if (opts.signal?.aborted) return finish({ text: '', source: 'aborted', usedAI: false })
  if (opts.noAI) {
    const t = detectIntent(text) !== 'general' ? fallbackText(text, ctx, 'error') : `Tienes la IA apagada en Ajustes. Esto sí puedo hacer: ${LOCAL_HELP}`
    return finish({ text: t, source: 'fallback', usedAI: false })
  }
  const usage = getAiUsage()
  if (usage.remaining <= 0) {
    return finish({
      text: `Hoy ya usaste tus ${usage.cap} consultas con IA. Mañana vuelven. Mientras tanto: ${LOCAL_HELP}`,
      source: 'limit',
      usedAI: false,
    })
  }
  if (!(await agentAvailable())) return finish({ text: fallbackText(text, ctx, isOffline() ? 'error' : 'unavailable'), source: 'fallback', usedAI: false })

  const messages: WireMessage[] = buildWire(opts.history ?? [], text, ctx)
  let usedAI = false
  const seenIds = new Set<string>()

  for (let turn = 0; turn < MAX_MODEL_TURNS; turn++) {
    emit({ type: 'thinking' })
    const res = await callAgent(fit(messages), opts.signal)
    if (!res.ok) {
      if (res.reason === 'aborted') return finish({ text: '', source: 'aborted', usedAI })
      const prefix = tools.length ? `${summariesOf(tools)} ` : ''
      if (res.reason === 'limit') return finish({ text: `${prefix}${fallbackText(text, ctx, 'limit')}`, source: 'limit', usedAI })
      return finish({ text: `${prefix}${tools.length ? '' : fallbackText(text, ctx, res.reason === 'disabled' ? 'unavailable' : 'error')}`.trim(), source: 'fallback', usedAI })
    }
    if (!usedAI) {
      usedAI = true
      bumpUsage()
    }
    const msg = res.reply.message
    // calls whose id repeats an earlier one would break the pairing on the server
    const calls = msg.tool_calls
      .map((c) => {
        let id = c.id
        while (seenIds.has(id)) id = `${id}_${turn}`
        seenIds.add(id)
        return { ...c, id }
      })

    if (!calls.length) {
      const answer = msg.text || summariesOf(tools) || fallbackText(text, ctx, 'error')
      return finish({ text: answer, source: 'ai', usedAI })
    }

    messages.push({ role: 'assistant', ...(msg.text ? { text: msg.text } : {}), tool_calls: calls })
    const outs = execAll(calls, { ...rt, origin: 'model' }, emit, tools, pending)
    messages.push({ role: 'tool', results: calls.map((c, i) => ({ id: c.id, name: c.name, content: toolResultContent(outs[i]) })) })

    if (pending.length) {
      // the user must decide: no more model turns (saves an AI call)
      return finish({ text: msg.text || pending.map((p) => p.prompt).join(' '), source: 'ai', usedAI })
    }
  }

  const changed = tools.filter((t) => t.ok && getTool(t.name)?.risk !== 'read')
  return finish({ text: changed.length ? `Hecho. ${summariesOf(changed)}` : 'No logré terminar eso. ¿Me lo dices de otra forma?', source: 'ai', usedAI })
}
