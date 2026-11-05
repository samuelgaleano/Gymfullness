import { cue } from '@/lib/audio'
import { speak } from '@/lib/voice'
import { notify } from '@/lib/workout/notify'
import { useRestTimer, type RestTimerState } from '@/lib/workout/useRestTimer'
import { getExercise, useApp } from '@/store/app'
import type { RestState } from '@/lib/types'
import { restEndAnnouncement } from './helpers'

/** A rest that ended this long ago (e.g. reopening the app) is closed silently. */
const STALE_END_MS = 4000

/**
 * Rest countdown + its side effects: 3-2-1 beeps, end beep/vibration, optional voice announcement and a
 * system notification when the page is hidden. At 0 the rest is closed so the next set is ready.
 * Mounted by the workout screen and by the floating pill (never both at once).
 */
export function useRestWithCues(rest: RestState | null | undefined): RestTimerState {
  const settings = useApp((s) => s.settings)
  return useRestTimer(rest, {
    onTick: (sec) => {
      if (sec <= 3 && settings.countdownBeeps) cue('tick', { sound: settings.sounds, vibration: false })
    },
    onEnd: ({ lateMs }) => {
      const st = useApp.getState()
      const s = st.activeSession
      if (!s?.rest) return
      if (lateMs <= STALE_END_MS) {
        cue('end', { sound: settings.sounds, vibration: settings.vibration })
        const say = restEndAnnouncement(s, (id) => getExercise(id)?.name ?? 'siguiente ejercicio')
        if (settings.voiceAnnouncements) void speak(say, { lang: settings.speechLang })
        void notify('Descanso terminado', say.replace('Descanso terminado. ', ''))
      }
      st.endRest()
    },
  })
}
