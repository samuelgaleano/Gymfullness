/** Shared types of the assistant (client side). */
import type { SetSource } from '../types'
import type { ToolName } from './toolDefs'

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  /** Set by the local router for an explicit imperative ("terminar entreno"): skips the confirmation. */
  explicit?: boolean
}

export interface PendingAction {
  id: string
  tool: ToolName
  args: Record<string, unknown>
  /** Spanish question for the UI ("¿Terminar el entreno?"). */
  prompt: string
  createdAt: number
  /** Active workout when the question was asked: a confirmation never applies to a different workout. */
  sessionId?: string
}

export interface ToolOutcome {
  ok: boolean
  /** Small JSON the model can read. */
  result: unknown
  /** Spanish one-liner for the UI. */
  summary: string
  /** Present when a destructive tool is waiting for the user's confirmation (nothing was changed). */
  pending?: PendingAction
  /** Replayable call that reverts the change (UI "Deshacer"). */
  undo?: { name: ToolName; args: Record<string, unknown> }
}

export interface ToolRuntime {
  origin?: 'model' | 'local'
  /** True once the user confirmed a pending action (or the call is an explicit local imperative). */
  confirmed?: boolean
  /** Opens a route in the UI (wouter navigate). */
  navigate?: (route: string) => void
  /** How a logged set is labelled in history. */
  source?: SetSource
}

/** Where the user is in the app; everything else is read from the store at execution time. */
export interface AgentContext {
  route?: string
  /** Exercise the screen is focused on (e.g. /exercises/:id). Falls back to the active workout exercise. */
  exerciseId?: string
}

export type LocalResult = { handled: true; actions: ToolCall[]; reply: string } | { handled: false }

export interface AgentMessage {
  role: 'user' | 'assistant'
  text: string
}

export type AgentEvent =
  | { type: 'thinking' }
  | { type: 'tool_start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_end'; id: string; name: string; ok: boolean; summary: string }
  | { type: 'confirm_needed'; pending: PendingAction }
  | { type: 'final'; result: AgentResult }

export type AgentSource = 'local' | 'ai' | 'fallback' | 'limit' | 'aborted'

export interface AgentResult {
  text: string
  source: AgentSource
  /** Tool calls executed during this turn. */
  tools: { name: string; ok: boolean; summary: string; undo?: ToolOutcome['undo'] }[]
  pending: PendingAction[]
  /** True when a model call was made. */
  usedAI: boolean
}
