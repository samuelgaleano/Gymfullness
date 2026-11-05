/** UI state of the assistant: sheet open/closed, prefilled text and the two user preferences (device-local). */
import { create } from 'zustand'

const KEY = 'gymfullness:assistant-prefs'

export interface AssistantPrefs {
  /** Read replies aloud when the question was spoken. */
  voiceReplies: boolean
  /** Allow calling the AI endpoint (off = local router only). */
  useAI: boolean
}

function readPrefs(): AssistantPrefs {
  const d: AssistantPrefs = { voiceReplies: true, useAI: true }
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AssistantPrefs> | null
    if (v && typeof v.voiceReplies === 'boolean') d.voiceReplies = v.voiceReplies
    if (v && typeof v.useAI === 'boolean') d.useAI = v.useAI
  } catch {
    /* storage unavailable */
  }
  return d
}

interface UiState extends AssistantPrefs {
  open: boolean
  /** Text to put in the input when the sheet opens (consumed once). */
  prefill: string
  /** Mounted once the sheet was opened (keeps the lazy chunk alive). */
  everOpened: boolean
}

export const useAssistantUi = create<UiState>(() => ({ ...readPrefs(), open: false, prefill: '', everOpened: false }))

export const openAssistant = (prefill = ''): void => useAssistantUi.setState({ open: true, prefill, everOpened: true })
export const closeAssistant = (): void => useAssistantUi.setState({ open: false })

export function setAssistantPref<K extends keyof AssistantPrefs>(k: K, v: AssistantPrefs[K]): void {
  useAssistantUi.setState({ [k]: v } as Pick<AssistantPrefs, K>)
  try {
    const { voiceReplies, useAI } = useAssistantUi.getState()
    localStorage.setItem(KEY, JSON.stringify({ voiceReplies, useAI }))
  } catch {
    /* ignore */
  }
}
