import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { AlertCircle, Check, Keyboard, Mic, Pause, RotateCcw, Send, Sparkles, Undo2, VolumeX, WifiOff, X } from 'lucide-react'
import { executeTool, getAiUsage, agentAvailable, toSpokenText, useAssistant, useAssistantStore, type ChatMessage } from '@/lib/agent'
import { cancelSpeech, isTTSSupported, speak, useHoldToTalk } from '@/lib/voice'
import { useRestTimer } from '@/lib/workout/useRestTimer'
import { useApp } from '@/store/app'
import { ANSWER_WINDOW_MS, aiMode, capLabel, FIRST_HINTS, formatRest, isNo, isStaleConversation, isYes, isChipOnly, visibleTools } from './assistantLogic'
import { closeAssistant, useAssistantUi } from './assistantStore'
import './assistant.css'

/** Tools whose success changes the screen: the sheet gets out of the way. */
const NAV_TOOLS = new Set(['navigate', 'start_workout', 'finish_workout'])
let localSeq = 0
const pushLocal = (role: ChatMessage['role'], text: string, extra: Partial<ChatMessage> = {}) =>
  useAssistantStore.setState((s) => ({
    messages: [...s.messages, { id: 1_000_000 + ++localSeq, role, text, at: Date.now(), ...extra }].slice(-60),
  }))

/** Keeps the panel above the on-screen keyboard (visualViewport). */
function useViewportBox(active: boolean) {
  const [box, setBox] = useState<{ h: number; kb: number } | null>(null)
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) return
    const upd = () => setBox({ h: vv.height, kb: Math.max(0, window.innerHeight - vv.height - vv.offsetTop) })
    upd()
    vv.addEventListener('resize', upd)
    vv.addEventListener('scroll', upd)
    return () => {
      vv.removeEventListener('resize', upd)
      vv.removeEventListener('scroll', upd)
    }
  }, [active])
  return box
}

function RestChip() {
  const rest = useApp((s) => s.activeSession?.rest ?? null)
  const t = useRestTimer(rest)
  if (!rest || !t.active) return null
  const st = useApp.getState()
  return (
    <div className="as-rest" role="timer" aria-label={`Descanso, quedan ${formatRest(t.remainingSec)}`}>
      <span className="as-rest__time num">{formatRest(t.remainingSec)}</span>
      <span className="as-rest__label">Descanso</span>
      <button type="button" className="as-rest__btn" onClick={() => st.adjustRest(30)} aria-label="Sumar 30 segundos al descanso">
        +30 s
      </button>
      <button type="button" className="as-rest__btn as-rest__btn--main" onClick={() => st.endRest()}>
        Saltar
      </button>
      <span className="as-rest__bar" style={{ width: `${Math.round(t.fraction * 100)}%` }} aria-hidden="true" />
    </div>
  )
}

export default function AssistantSheet() {
  const open = useAssistantUi((s) => s.open)
  const prefill = useAssistantUi((s) => s.prefill)
  const voiceReplies = useAssistantUi((s) => s.voiceReplies)
  const useAI = useAssistantUi((s) => s.useAI)
  const lang = useApp((s) => s.settings.speechLang)
  const haptics = useApp((s) => s.settings.vibration)
  const a = useAssistant()
  const { messages, busy, status, pending } = a

  const [text, setText] = useState('')
  const [partial, setPartial] = useState('')
  const [speaking, setSpeaking] = useState(false)
  const [undone, setUndone] = useState<Set<string>>(() => new Set())
  const [available, setAvailable] = useState<boolean | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false))
  const [usage, setUsage] = useState(() => getAiUsage())
  const panelRef = useRef<HTMLDivElement>(null)
  const logRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const openerRef = useRef<Element | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const box = useViewportBox(open)

  /* ---------------- open / close lifecycle ---------------- */
  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    if (isStaleConversation(useAssistantStore.getState().messages)) a.clear()
    setText(prefill)
    setUsage(getAiUsage())
    void agentAvailable().then(setAvailable)
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    requestAnimationFrame(() => (prefill ? inputRef.current : panelRef.current)?.focus({ preventScroll: true }))
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
      clearTimeout(closeTimer.current)
      cancelSpeech()
      setSpeaking(false)
      const el = openerRef.current as HTMLElement | null
      if (el && document.contains(el)) el.focus?.({ preventScroll: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // stay at the newest message
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, busy, pending.length, partial, open])

  /* ---------------- sending ---------------- */
  const maybeClose = (names: string[], delay = 900) => {
    if (names.some((n) => NAV_TOOLS.has(n))) closeTimer.current = setTimeout(closeAssistant, delay)
  }

  const say = useCallback(
    (reply: string) => {
      if (!voiceReplies || !isTTSSupported()) return
      const spoken = toSpokenText(reply)
      if (!spoken) return
      setSpeaking(true)
      void speak(spoken, { lang }).then(() => setSpeaking(false))
    },
    [voiceReplies, lang],
  )

  const submit = useCallback(
    async (raw: string, source: 'voice' | 'text' = 'text') => {
      const t = raw.trim()
      if (!t || useAssistantStore.getState().busy) return
      cancelSpeech()
      setSpeaking(false)
      const waiting = useAssistantStore.getState().pending
      // a card nobody answered for a while, or ignored by sending something else, must never be confirmed by a later "listo"/"sí"
      const fresh = waiting.filter((p) => Date.now() - p.createdAt <= ANSWER_WINDOW_MS)
      const answering = fresh.length > 0 && (isYes(t) || isNo(t))
      if (waiting.length && !answering) for (const p of waiting) a.reject(p.id, true)
      if (answering) {
        pushLocal('user', t)
        const yes = isYes(t)
        const names: string[] = []
        for (const p of fresh) {
          if (yes) {
            a.confirm(p.id)
            names.push(p.tool)
          } else a.reject(p.id)
        }
        if (yes) maybeClose(names)
        if (source === 'voice') say(useAssistantStore.getState().messages.at(-1)?.text ?? '')
        return
      }
      const r = await a.send(t, { source: source === 'voice' ? 'voice' : 'text', noAI: !useAI })
      setUsage(getAiUsage())
      if (!r || r.source === 'aborted') return
      if (source === 'voice') say(r.text)
      if (!r.pending.length) maybeClose(r.tools.filter((x) => x.ok).map((x) => x.name))
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [a.send, a.confirm, a.reject, useAI, say],
  )

  const hold = useHoldToTalk({
    lang,
    haptics,
    onPartial: setPartial,
    onResult: (t) => {
      setPartial('')
      void submit(t, 'voice')
    },
  })
  useEffect(() => {
    if (!hold.listening && !hold.processing) setPartial('')
  }, [hold.listening, hold.processing])

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    const t = text
    setText('')
    void submit(t, 'text')
  }

  const runSuggestion = (s: { text: string; send: boolean }) => {
    if (s.send) void submit(s.text, 'text')
    else {
      setText(s.text)
      inputRef.current?.focus()
    }
  }

  // "Deshacer" only on the newest logged set: an older chip would undo a different set
  const lastUndoId = [...messages].reverse().find((m) => m.tools?.some((t) => t.ok && t.undo))?.id
  const undo = (m: ChatMessage, i: number) => {
    const u = m.tools?.[i]?.undo
    if (!u || m.id !== lastUndoId) return
    setUndone((p) => new Set(p).add(`${m.id}:${i}`))
    const out = executeTool({ id: `ui-undo-${m.id}-${i}`, name: u.name, args: u.args }, { origin: 'local', confirmed: true })
    pushLocal('assistant', out.ok ? out.summary || 'Deshecho.' : out.summary || 'No pude deshacerlo.', { source: 'local' })
  }

  /* ---------------- keyboard: Escape + focus trap ---------------- */
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeAssistant()
      return
    }
    if (e.key !== 'Tab' || !panelRef.current) return
    const f = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')].filter((el) => el.offsetParent !== null)
    if (!f.length) return
    const first = f[0]
    const last = f[f.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const mode = aiMode({ useAI, available, online, remaining: usage.remaining })
  const suggestions = a.suggestions
  const lastMsg = messages[messages.length - 1]
  const listening = hold.listening || hold.processing
  const placeholder = useMemo(() => (hold.supported ? 'Escribe o mantén el micrófono' : 'Escribe aquí, por ejemplo «80 por 10»'), [hold.supported])

  if (!open) return null

  const style = box ? ({ '--as-kb': `${box.kb}px`, '--as-vh': `${box.h}px` } as React.CSSProperties) : undefined

  return createPortal(
    <div className="as-root" role="presentation" style={style}>
      <div className="as-scrim" onClick={closeAssistant} aria-hidden="true" />
      <div ref={panelRef} className="as-panel" role="dialog" aria-modal="true" aria-label="Asistente de entrenamiento" tabIndex={-1} onKeyDown={onKeyDown}>
        <div className="as-grab" aria-hidden="true" />
        <header className="as-head">
          <span className="as-head__icon" aria-hidden="true">
            <Sparkles size={18} />
          </span>
          <div className="as-head__mid">
            <h2 className="as-head__title">Tu entrenador</h2>
            {mode.mode === 'basic' ? (
              <span className="as-badge as-badge--basic" title={mode.reason}>
                {!online && <WifiOff size={12} aria-hidden="true" />}
                {mode.reason === 'Límite diario de IA' ? 'Límite de IA: modo básico' : 'IA no disponible: modo básico'}
              </span>
            ) : (
              <span className="as-badge">
                <Sparkles size={12} aria-hidden="true" />
                {capLabel(usage)}
              </span>
            )}
          </div>
          {speaking && (
            <button type="button" className="as-iconbtn as-iconbtn--accent" onClick={() => (cancelSpeech(), setSpeaking(false))} aria-label="Silenciar">
              <VolumeX size={18} />
            </button>
          )}
          {messages.length > 0 && (
            <button type="button" className="as-iconbtn" onClick={() => (a.clear(), setUndone(new Set()), setText(''))} aria-label="Nueva conversación" title="Nueva conversación">
              <RotateCcw size={18} />
            </button>
          )}
          <button type="button" className="as-iconbtn" onClick={closeAssistant} aria-label="Cerrar asistente">
            <X size={20} />
          </button>
        </header>

        <RestChip />

        <div className="as-log" ref={logRef} role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversación">
          {messages.length === 0 && (
            <div className="as-empty">
              <p className="as-empty__title">¿En qué te ayudo?</p>
              <p className="as-empty__text">Háblame como le hablarías a tu entrenador. Por ejemplo:</p>
              <ul className="as-empty__hints">
                {FIRST_HINTS.map((h) => (
                  <li key={h}>
                    <button type="button" className="as-hintbtn" onClick={() => void submit(h.replace(/[«»]/g, ''), 'text')}>
                      {h}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {messages.map((m) => {
            const tools = m.role === 'assistant' ? visibleTools(m) : []
            const chipOnly = m.role === 'assistant' && isChipOnly(m)
            // the confirmation card below already asks this question
            if (m.role === 'assistant' && pending.some((p) => p.prompt === m.text.trim())) return null
            return (
              <div key={m.id} className={`as-msg as-msg--${m.role}`}>
                {!chipOnly && <div className="as-bubble">{m.text}</div>}
                {m.role === 'assistant' && (m.source === 'fallback' || m.source === 'limit') && <span className="as-note">Respuesta en modo básico</span>}
                {(chipOnly ? m.tools ?? [] : tools).length > 0 && (
                  <ul className="as-tools" aria-label="Acciones realizadas">
                    {(chipOnly ? m.tools ?? [] : tools).map((t) => {
                      const oi = (m.tools ?? []).indexOf(t)
                      const key = `${m.id}:${oi}`
                      const done = undone.has(key)
                      return (
                        <li key={key} className={`as-tool ${t.ok ? '' : 'as-tool--err'} ${done ? 'as-tool--undone' : ''}`}>
                          {t.ok ? <Check size={14} strokeWidth={3} aria-hidden="true" /> : <AlertCircle size={14} aria-hidden="true" />}
                          <span className="as-tool__text">{t.summary}</span>
                          {t.ok && t.undo && !done && m.id === lastUndoId && (
                            <button type="button" className="as-tool__undo" onClick={() => undo(m, oi)}>
                              <Undo2 size={13} aria-hidden="true" />
                              Deshacer
                            </button>
                          )}
                          {done && <span className="as-tool__done">Deshecho</span>}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}

          {pending.map((p) => (
            <div key={p.id} className="as-confirm" role="alertdialog" aria-label={p.prompt}>
              <p className="as-confirm__q">{p.prompt}</p>
              <div className="as-confirm__row">
                <button type="button" className="as-btn as-btn--ghost" onClick={() => a.reject(p.id)}>
                  Cancelar
                </button>
                <button
                  type="button"
                  className="as-btn as-btn--primary"
                  onClick={() => {
                    a.confirm(p.id)
                    maybeClose([p.tool])
                  }}
                >
                  Confirmar
                </button>
              </div>
              <p className="as-confirm__hint">También puedes decir «sí» o «no».</p>
            </div>
          ))}

          {listening && (
            <div className="as-msg as-msg--user as-msg--live" aria-hidden="true">
              <div className="as-bubble as-bubble--live">{partial || (hold.processing ? 'Procesando…' : 'Escuchando…')}</div>
            </div>
          )}
          {busy && (
            <div className="as-msg as-msg--assistant" role="status">
              <div className="as-bubble as-bubble--think">
                <span className="as-dots" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span>{status ?? 'Pensando…'}</span>
              </div>
            </div>
          )}
          {hold.error && !listening && (
            <p className="as-error" role="alert">
              <AlertCircle size={14} aria-hidden="true" /> {hold.error}
            </p>
          )}
          {lastMsg?.source === 'limit' && <p className="as-cap">{capLabel(usage)}</p>}
        </div>

        <div className="as-dock">
          {suggestions.length > 0 && !listening && (
            <div className="as-chips" role="group" aria-label="Sugerencias">
              {suggestions.map((s) => (
                <button key={s.id} type="button" className="as-chip" disabled={busy} onClick={() => runSuggestion(s)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {listening && hold.mode === 'hold' && <p className="as-hint">Suelta para enviar · desliza para cancelar</p>}
          {listening && hold.mode === 'toggle' && <p className="as-hint">Te escucho… toca el micrófono para enviar</p>}
          <form className="as-input" onSubmit={onSubmit}>
            <div className="as-field">
              <input
                ref={inputRef}
                className="as-field__input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={placeholder}
                aria-label="Mensaje para el asistente"
                enterKeyHint="send"
                autoComplete="off"
                autoCapitalize="sentences"
              />
              <button type="submit" className="as-field__send" aria-label="Enviar" disabled={!text.trim() || busy}>
                <Send size={18} />
              </button>
            </div>
            {hold.supported ? (
              <button
                type="button"
                className={`as-mic ${hold.listening ? 'as-mic--on' : ''} ${hold.processing ? 'as-mic--busy' : ''}`}
                aria-label="Mantén pulsado para hablar con el asistente"
                disabled={busy}
                {...hold.bind}
                style={{ ...hold.bind.style, ...(hold.cancelProgress > 0 ? { opacity: 1 - hold.cancelProgress * 0.45 } : null) }}
              >
                {listening && <span className="as-mic__pulse" aria-hidden="true" />}
                {hold.listening && hold.mode === 'toggle' ? <Pause size={26} /> : <Mic size={28} />}
              </button>
            ) : (
              <span className="as-nomic" title="Tu navegador no permite dictar">
                <Keyboard size={20} aria-hidden="true" />
                <span className="sr-only">Dictado no disponible en este navegador</span>
              </span>
            )}
          </form>
        </div>

      </div>
    </div>,
    document.body,
  )
}
