/**
 * Voice feature entry point.
 *
 *   import { parseUtterance, formatParsed, useHoldToTalk, speak } from '@/lib/voice'
 */
import { autoUnlockAudio, unlockAudio } from '../audio'
import { primeSpeech } from './tts'

export {
  parseUtterance,
  normalizeText,
  wordsToNumber,
  formatParsed,
  formatSeconds,
  pickBestTranscript,
  parsedToLogInput,
  VOICE_LIMITS,
  type ParsedSet,
  type ParsedCommand,
} from './parse'
export {
  createRecognizer,
  isSpeechRecognitionSupported,
  getSpeechRecognitionCtor,
  speechErrorMessage,
  toSpeechError,
  toSpeechErrorCode,
  isFatalSpeechError,
  type Recognizer,
  type RecognizerOptions,
  type SpeechError,
  type SpeechErrorCode,
} from './speech'
export {
  useHoldToTalk,
  type HoldToTalk,
  type HoldToTalkBind,
  type HoldToTalkMode,
  type UseHoldToTalkOptions,
} from './useHoldToTalk'
export { speak, cancelSpeech, isSpeaking, isTTSSupported, primeSpeech, pickVoice, loadVoices, type SpeakOptions } from './tts'

/**
 * Unlock Web Audio + speech synthesis inside a user gesture (call it from the
 * "Empezar entreno" tap). Idempotent.
 */
export function unlockMedia(): void {
  void unlockAudio()
  primeSpeech()
}

/** Unlock audio + speech on the first tap anywhere. Returns a cleanup. */
export function unlockMediaOnFirstGesture(target: EventTarget | null = typeof window !== 'undefined' ? window : null): () => void {
  if (!target) return () => {}
  const once = () => {
    primeSpeech()
    target.removeEventListener('pointerdown', once, true)
  }
  target.addEventListener('pointerdown', once, { capture: true, passive: true })
  const stopAudio = autoUnlockAudio(target)
  return () => {
    target.removeEventListener('pointerdown', once, true)
    stopAudio()
  }
}
