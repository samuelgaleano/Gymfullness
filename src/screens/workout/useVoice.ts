/**
 * Voice / text input for the live workout: hold-to-talk (or a text box when speech recognition is
 * unsupported) → parseUtterance → either a pending set confirmation (auto-commits after 1.2 s unless
 * cancelled / edited) or an immediate command.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Unit, VoiceContext } from '@/lib/types'
import {
  formatParsed,
  parseUtterance,
  pickBestTranscript,
  useHoldToTalk,
  type HoldToTalk,
  type ParsedCommand,
  type ParsedSet,
} from '@/lib/voice'

export const AUTO_CONFIRM_MS = 1200
/** Parses below this confidence wait for an explicit tap. */
export const MIN_AUTO_CONFIDENCE = 0.7

export interface PendingSet {
  id: number
  parsed: ParsedSet
  label: string
  raw: string
  auto: boolean
}

export interface VoiceOptions {
  lang: string
  haptics: boolean
  unit: Unit
  getContext: () => VoiceContext
  onSet: (p: ParsedSet) => void
  onEdit: (p: ParsedSet) => void
  onCommand: (p: ParsedCommand) => void
  onUnknown: (raw: string) => void
  onError: (message: string) => void
}

export interface Voice {
  hold: HoldToTalk
  pending: PendingSet | null
  confirm: () => void
  cancel: () => void
  edit: () => void
  textOpen: boolean
  setTextOpen: (v: boolean) => void
  submitText: (text: string) => void
}

export function useVoice(options: VoiceOptions): Voice {
  const optsRef = useRef(options)
  optsRef.current = options

  const [pending, setPending] = useState<PendingSet | null>(null)
  const pendingRef = useRef<PendingSet | null>(null)
  const seq = useRef(0)
  const [textOpen, setTextOpen] = useState(false)

  const setPend = useCallback((p: PendingSet | null) => {
    pendingRef.current = p
    setPending(p)
  }, [])

  const handleText = useCallback(
    (text: string, alts?: string[]) => {
      const o = optsRef.current
      const ctx = o.getContext()
      const best = pickBestTranscript(alts && alts.length ? alts : [text], ctx)
      const raw = best?.text ?? text
      const parsed = best?.parsed ?? parseUtterance(text, ctx)
      if (parsed.type === 'set') {
        // a new utterance replaces (and first commits) a pending one
        const prev = pendingRef.current
        if (prev) {
          setPend(null)
          o.onSet(prev.parsed)
        }
        setPend({
          id: ++seq.current,
          parsed,
          raw,
          label: formatParsed(parsed, o.unit),
          auto: parsed.confidence >= MIN_AUTO_CONFIDENCE,
        })
      } else if (parsed.type === 'command') {
        o.onCommand(parsed)
      } else {
        o.onUnknown(raw)
      }
    },
    [setPend],
  )

  const hold = useHoldToTalk({
    lang: options.lang,
    haptics: options.haptics,
    onResult: (text, alts) => handleText(text, alts),
    onError: (message) => optsRef.current.onError(message),
  })

  const confirm = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    setPend(null)
    optsRef.current.onSet(p.parsed)
  }, [setPend])

  const cancel = useCallback(() => setPend(null), [setPend])

  const edit = useCallback(() => {
    const p = pendingRef.current
    if (!p) return
    setPend(null)
    optsRef.current.onEdit(p.parsed)
  }, [setPend])

  const submitText = useCallback(
    (text: string) => {
      const t = text.trim()
      if (!t) return
      setTextOpen(false)
      handleText(t)
    },
    [handleText],
  )

  // auto-commit after a short window to cancel or edit
  const pendingId = pending?.id
  const pendingAuto = pending?.auto
  useEffect(() => {
    if (pendingId === undefined || !pendingAuto) return
    const t = setTimeout(confirm, AUTO_CONFIRM_MS)
    return () => clearTimeout(t)
  }, [pendingId, pendingAuto, confirm])

  // pressing the mic again commits whatever was pending
  const listening = hold.listening
  useEffect(() => {
    if (listening) confirm()
  }, [listening, confirm])

  return { hold, pending, confirm, cancel, edit, textOpen, setTextOpen, submitText }
}
