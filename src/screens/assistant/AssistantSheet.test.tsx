import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { useApp } from '@/store/app'
import { clearAssistant, useAssistantStore } from '@/lib/agent'
import { __resetAgentForTests } from '@/lib/agent/run'
import { resetStore, startPlanWorkout } from '@/lib/agent/testkit'
import { selectSessions } from '@/store/app'
import AssistantSheet from './AssistantSheet'
import { AssistantHost, AssistantPill } from './AssistantHost'
import { closeAssistant, openAssistant, setAssistantPref, useAssistantUi } from './assistantStore'

const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function mount(path = '/') {
  const { hook } = memoryLocation({ path })
  return render(
    <Router hook={hook}>
      <AssistantSheet />
    </Router>,
  )
}

const input = () => screen.getByLabelText('Mensaje para el asistente') as HTMLInputElement
async function say(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  await act(async () => {
    fireEvent.submit(input().closest('form')!)
  })
}

beforeEach(() => {
  resetStore()
  clearAssistant()
  __resetAgentForTests()
  localStorage.clear()
  useAssistantUi.setState({ open: false, prefill: '', everOpened: false, voiceReplies: true, useAI: true })
  vi.stubGlobal('fetch', vi.fn(async () => jsonRes({ enabled: false })))
  Element.prototype.scrollTo ??= () => {}
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AssistantSheet', () => {
  it('renders nothing while closed and a labelled dialog when open', () => {
    mount()
    expect(screen.queryByRole('dialog')).toBeNull()
    act(() => openAssistant())
    expect(screen.getByRole('dialog', { name: 'Asistente de entrenamiento' })).toBeTruthy()
    expect(screen.getByRole('log', { name: 'Conversación' }).getAttribute('aria-live')).toBe('polite')
    expect(screen.getByLabelText('Cerrar asistente')).toBeTruthy()
  })

  it('shows the basic-mode badge when the AI endpoint is missing', async () => {
    mount()
    act(() => openAssistant())
    await waitFor(() => expect(screen.getByText('IA no disponible: modo básico')).toBeTruthy())
  })

  it('local router logs a set, shows a chip with Deshacer, and undo reverts it', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('80 kilos 10 repeticiones')
    await waitFor(() => expect(screen.getByText(/Serie 1 · 80 kg × 10/)).toBeTruthy())
    const s = () => useApp.getState().activeSession!
    expect(s().exercises[0].sets.filter((x) => x.done)).toHaveLength(1)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Deshacer/ }))
    })
    expect(s().exercises[0].sets.filter((x) => x.done)).toHaveLength(0)
    expect(screen.getByText('Deshecho')).toBeTruthy()
  })

  it('destructive action: card, "no" cancels by text, "sí" confirms', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('terminar')
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    expect(useApp.getState().activeSession).not.toBeNull()
    await say('no')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(useApp.getState().activeSession).not.toBeNull()
    expect(screen.getByText('Listo, no hice ningún cambio.')).toBeTruthy()

    await say('terminar')
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    await say('sí')
    await waitFor(() => expect(useApp.getState().activeSession).toBeNull())
  })

  it('confirm / cancel buttons resolve the card', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('terminar')
    await waitFor(() => screen.getByRole('alertdialog'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    })
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(useApp.getState().activeSession).not.toBeNull()
  })

  it('AI tool-calling turn through a mocked /api/agent', async () => {
    startPlanWorkout()
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => {
        if (!init || init.method === 'GET') return jsonRes({ enabled: true })
        n++
        return jsonRes({ message: n === 1 ? { text: '', tool_calls: [{ id: 'c1', name: 'log_set', args: { weight: 60, reps: 8 } }] } : { text: 'Listo, anoté tu serie.', tool_calls: [] } })
      }),
    )
    mount('/workout')
    act(() => openAssistant())
    await say('anota algo ligero')
    await waitFor(() => expect(screen.getByText('Listo, anoté tu serie.')).toBeTruthy())
    expect(screen.getByText(/60 kg × 8/)).toBeTruthy()
    expect(screen.getByText(/consultas con IA hoy/)).toBeTruthy()
  })

  it('"usar IA" off never calls the endpoint for open questions', async () => {
    const f = vi.fn(async (_u?: string, _i?: RequestInit) => jsonRes({ enabled: true }))
    vi.stubGlobal('fetch', f)
    setAssistantPref('useAI', false)
    mount()
    act(() => openAssistant())
    await say('dame un consejo raro de dieta')
    await waitFor(() => expect(screen.getByText(/IA apagada/)).toBeTruthy())
    expect(f.mock.calls.some((c) => c[1]?.method === 'POST')).toBe(false)
  })

  it('server failure degrades to a useful local answer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init?: RequestInit) => (!init || init.method === 'GET' ? jsonRes({ enabled: true }) : jsonRes({}, 500))),
    )
    mount()
    act(() => openAssistant())
    await say('cuéntame un chiste de gimnasio')
    await waitFor(() => expect(screen.getByText(/No pude conectar con la IA/)).toBeTruthy())
    expect(screen.getByText('Respuesta en modo básico')).toBeTruthy()
  })

  it('a stale (yesterday) conversation is cleared on open; "Nueva conversación" clears', async () => {
    useAssistantStore.setState({ messages: [{ id: 1, role: 'user', text: 'ayer', at: Date.now() - 2 * 86_400_000 }] })
    mount()
    act(() => openAssistant())
    expect(screen.queryByText('ayer')).toBeNull()
    await say('qué entreno hoy')
    await waitFor(() => expect(useAssistantStore.getState().messages.length).toBeGreaterThan(1))
    await act(async () => {
      fireEvent.click(screen.getByLabelText('Nueva conversación'))
    })
    expect(useAssistantStore.getState().messages).toHaveLength(0)
  })

  it('suggestion chips follow the context and prefill-only chips fill the input', async () => {
    mount('/')
    act(() => openAssistant())
    expect(screen.getByRole('button', { name: '¿Qué entreno hoy?' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Registrar mi peso' }))
    expect(input().value).toBe('registra mi peso ')
  })

  it('shows the rest chip while resting and lets you skip it', async () => {
    startPlanWorkout()
    useApp.getState().startRest(60)
    mount('/workout')
    act(() => openAssistant())
    expect(screen.getByRole('timer')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Saltar' }))
    })
    expect(useApp.getState().activeSession?.rest).toBeFalsy()
  })

  it('Escape closes and focus returns to the opener', async () => {
    const { hook } = memoryLocation({ path: '/' })
    render(
      <Router hook={hook}>
        <AssistantPill />
        <AssistantHost />
      </Router>,
    )
    const pill = screen.getByRole('button', { name: /Pregúntale a tu entrenador/ })
    pill.focus()
    await act(async () => {
      fireEvent.click(pill)
    })
    await waitFor(() => screen.getByRole('dialog'))
    await act(async () => {
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    })
    expect(useAssistantUi.getState().open).toBe(false)
    expect(document.activeElement).toBe(pill)
  })

  it('finishing a workout by chat closes the sheet and saves the session', async () => {
    startPlanWorkout()
    useApp.getState().logSet({})
    mount('/workout')
    act(() => openAssistant())
    await say('terminar entreno')
    await waitFor(() => expect(selectSessions(useApp.getState())).toHaveLength(1))
    await waitFor(() => expect(useAssistantUi.getState().open).toBe(false), { timeout: 3000 })
    closeAssistant()
  })

  it('ignoring a confirmation card and saying "listo" logs the set and never finishes the workout', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('terminar')
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    await say('listo')
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
    expect(useApp.getState().activeSession).not.toBeNull()
    expect(useApp.getState().activeSession!.exercises[0].sets.filter((x) => x.done)).toHaveLength(1)
  })

  it('an old card cannot be confirmed by voice/text any more (only by tapping)', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('terminar')
    await waitFor(() => expect(screen.getByRole('alertdialog')).toBeTruthy())
    const t0 = Date.now()
    const spy = vi.spyOn(Date, 'now').mockReturnValue(t0 + 5 * 60_000)
    await say('sí')
    spy.mockRestore()
    expect(useApp.getState().activeSession).not.toBeNull()
  })

  it('only the newest logged set offers Deshacer', async () => {
    startPlanWorkout()
    mount('/workout')
    act(() => openAssistant())
    await say('80 por 10')
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Deshacer/ })).toHaveLength(1))
    await say('82 por 8')
    await waitFor(() => expect(screen.getByText(/82 kg × 8/)).toBeTruthy())
    expect(screen.getAllByRole('button', { name: /Deshacer/ })).toHaveLength(1)
  })
})
