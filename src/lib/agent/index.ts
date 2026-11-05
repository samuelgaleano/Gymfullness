/**
 * Assistant entry point for the UI:
 *   import { useAssistant, getSuggestions, toSpokenText, runAgent } from '@/lib/agent'
 */
export { useAssistant, useAssistantStore, sendToAssistant, cancelAssistant, confirmAssistantAction, rejectAssistantAction, clearAssistant } from './useAssistant'
export type { Assistant, ChatMessage, SendOptions } from './useAssistant'
export { runAgent, getAiUsage, agentAvailable, AI_DAILY_CAP } from './run'
export type { RunAgentOptions } from './run'
export { handleLocally } from './local'
export { executeTool, confirmPending, cancelPending, listPending, TOOLS, getTool, contextSnapshot } from './tools'
export { getSuggestions } from './suggestions'
export type { Suggestion } from './suggestions'
export { toSpokenText } from './speech'
export { TOOL_DEFS, TOOL_NAMES } from './toolDefs'
export type { ToolName, ToolRisk } from './toolDefs'
export type { AgentContext, AgentEvent, AgentMessage, AgentResult, AgentSource, PendingAction, ToolCall, ToolOutcome, ToolRuntime } from './types'
