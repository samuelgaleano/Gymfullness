import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Keyboard, Mic, Pencil, Send, X } from 'lucide-react'
import { IconButton } from '@/ui'
import { AUTO_CONFIRM_MS, type Voice } from './useVoice'

/** Bottom bar: the one primary action + the hold-to-talk mic, with the voice bubble floating above. */
export function WorkoutBottom({ voice, children }: { voice: Voice; children: ReactNode }) {
  return (
    <div className="wk-bottom">
      <VoiceLayer voice={voice} />
      <div className="wk-bottom__row">
        <div className="wk-bottom__main">{children}</div>
        <MicButton voice={voice} />
      </div>
    </div>
  )
}

function MicButton({ voice }: { voice: Voice }) {
  const { hold, textOpen, setTextOpen } = voice
  if (!hold.supported) {
    return (
      <button
        type="button"
        className={`wk-mic ${textOpen ? 'wk-mic--on' : ''}`}
        aria-label="Escribir serie"
        aria-expanded={textOpen}
        onClick={() => setTextOpen(!textOpen)}
      >
        <Keyboard size={28} />
      </button>
    )
  }
  const busy = hold.listening || hold.processing
  return (
    <button
      type="button"
      className={`wk-mic ${hold.listening ? 'wk-mic--on' : ''} ${hold.processing ? 'wk-mic--busy' : ''}`}
      aria-label="Mantén pulsado para dictar la serie"
      {...hold.bind}
      style={{ ...hold.bind.style, ...(hold.cancelProgress > 0 ? { opacity: 1 - hold.cancelProgress * 0.4 } : null) }}
    >
      {busy && <span className="wk-mic__pulse" aria-hidden="true" />}
      <Mic size={28} />
    </button>
  )
}

function VoiceLayer({ voice }: { voice: Voice }) {
  const { hold, pending, textOpen } = voice
  const live = hold.listening || hold.processing

  if (textOpen && !hold.supported) return <TextEntry voice={voice} />

  if (live) {
    return (
      <div className="wk-bubble glass" role="status" aria-live="polite">
        <span className="wk-bubble__dot" aria-hidden="true" />
        <div className="wk-bubble__body">
          <div className="wk-bubble__label">{hold.processing ? 'Procesando…' : 'Escuchando…'}</div>
          <div className="wk-bubble__text">
            {hold.transcript || (hold.listening ? 'Di «ochenta por diez»' : '')}
          </div>
          {hold.listening && hold.mode === 'hold' && (
            <div className="wk-bubble__hint">Suelta para enviar · desliza para cancelar</div>
          )}
        </div>
      </div>
    )
  }

  if (pending) {
    return (
      <div className="wk-confirm glass" role="status" aria-live="assertive">
        <div className="wk-confirm__row">
          <Check size={22} className="wk-confirm__check" aria-hidden="true" />
          <div className="wk-confirm__label num">{pending.label}</div>
          <IconButton label="Editar valores" variant="glass" size="sm" onClick={voice.edit}>
            <Pencil size={16} />
          </IconButton>
          <IconButton label="Cancelar" variant="glass" size="sm" onClick={voice.cancel}>
            <X size={18} />
          </IconButton>
          {!pending.auto && (
            <button type="button" className="wk-confirm__ok" onClick={voice.confirm}>
              Confirmar
            </button>
          )}
        </div>
        {pending.auto ? (
          <span key={pending.id} className="wk-confirm__bar" style={{ animationDuration: `${AUTO_CONFIRM_MS}ms` }} aria-hidden="true" />
        ) : (
          <div className="wk-confirm__hint">No estoy seguro de haber entendido bien.</div>
        )}
      </div>
    )
  }

  return null
}

function TextEntry({ voice }: { voice: Voice }) {
  const [text, setText] = useState('')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus({ preventScroll: true })
  }, [])
  return (
    <form
      className="wk-text glass"
      onSubmit={(e) => {
        e.preventDefault()
        voice.submitText(text)
        setText('')
      }}
    >
      <input
        ref={ref}
        className="wk-text__input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="80 x 10 · igual · saltar"
        aria-label="Serie o comando"
        enterKeyHint="send"
        autoComplete="off"
        autoCapitalize="off"
      />
      <IconButton label="Enviar" variant="glass" size="sm" type="submit" disabled={!text.trim()}>
        <Send size={18} />
      </IconButton>
      <IconButton label="Cerrar" variant="plain" size="sm" onClick={() => voice.setTextOpen(false)}>
        <X size={18} />
      </IconButton>
    </form>
  )
}
