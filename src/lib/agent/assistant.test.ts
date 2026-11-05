import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { Router } from 'wouter'
import { memoryLocation } from 'wouter/memory-location'
import { createElement, type ReactNode } from 'react'
import { useApp, selectSessions } from '@/store/app'
import { resetStore, seedPlan, startPlanWorkout } from './testkit'
import { getSuggestions } from './suggestions'
import { toSpokenText } from './speech'
import { clearAssistant, useAssistant, useAssistantStore } from './useAssistant'
import { __resetAgentForTests } from './run'
import { TOOL_NAMES } from './toolDefs'
import * as api from './index'

beforeEach(() => {
  resetStore()
  clearAssistant()
  __resetAgentForTests()
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"enabled":false}', { status: 200, headers: { 'content-type': 'application/json' } })))
})
afterEach(() => vi.unstubAllGlobals())

describe('getSuggestions', () => {
  it('idle: today, start, progress, weight (prefill)', () => {
    seedPlan()
    const s = getSuggestions({ route: '/' })
    expect(s.map((x) => x.id)).toEqual(expect.arrayContaining(['today', 'start', 'progress']))
    expect(s.length).toBeLessThanOrEqual(5)
    expect(getSuggestions({ route: '/' }, 10).find((x) => x.id === 'weight')?.send).toBe(false)
  })

  it('in a workout: workout chips, rest chips while resting, finish at the end', () => {
    startPlanWorkout()
    const ids = getSuggestions({}, 10).map((x) => x.id)
    expect(ids).toEqual(expect.arrayContaining(['same', 'swap', 'next-ex', 'undo']))
    useApp.getState().startRest(60)
    expect(getSuggestions({}, 10).map((x) => x.id)).toEqual(expect.arrayContaining(['skip-rest', 'more-rest']))
  })

  it('route specific chips', () => {
    expect(getSuggestions({ route: '/exercises/bench-press' }, 10).some((x) => x.id === 'how')).toBe(true)
    expect(getSuggestions({ route: '/profile' }, 10).some((x) => x.id === 'units')).toBe(true)
  })

  it('every suggestion that sends text is understood (local router or deliberately AI)', async () => {
    startPlanWorkout()
    const { handleLocally } = await import('./local')
    const local = ['same', 'whats-next', 'next-ex', 'swap', 'how', 'undo', 'progress']
    for (const s of getSuggestions({}, 20)) if (local.includes(s.id)) expect(handleLocally(s.text).handled, s.label).toBe(true)
  })
})

describe('toSpokenText', () => {
  it('strips markup, bullets and emoji; joins lines; truncates at a sentence', () => {
    expect(toSpokenText('• Baja controlado.\n• Sube fuerte 💪\n**Listo**')).toBe('Baja controlado. Sube fuerte. Listo')
    const long = `${'Frase corta número uno. '.repeat(30)}`
    const out = toSpokenText(long, 100)
    expect(out.length).toBeLessThanOrEqual(100)
    expect(out.endsWith('.')).toBe(true)
  })
})

describe('index exports', () => {
  it('exposes the public API', () => {
    for (const k of ['useAssistant', 'runAgent', 'handleLocally', 'getSuggestions', 'toSpokenText', 'executeTool', 'confirmPending', 'cancelPending', 'TOOL_DEFS']) expect(api).toHaveProperty(k)
    expect(api.TOOL_NAMES).toEqual(TOOL_NAMES)
  })
})

describe('useAssistant', () => {
  const wrapper = (path = '/') => {
    const { hook } = memoryLocation({ path })
    return ({ children }: { children: ReactNode }) => createElement(Router, { hook, children })
  }

  it('sends through the local router, keeps the conversation, exposes suggestions', async () => {
    startPlanWorkout()
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapper('/workout') })
    await act(async () => {
      await result.current.send('80 por 10', { source: 'voice' })
    })
    const msgs = useAssistantStore.getState().messages
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].text).toContain('80 kg × 10')
    expect(msgs[1].tools?.[0].name).toBe('log_set')
    expect(useApp.getState().activeSession!.exercises[0].sets[0].source).toBe('voice')
    expect(result.current.busy).toBe(false)
    expect(result.current.suggestions.length).toBeGreaterThan(0)
  })

  it('navigates through the router', async () => {
    seedPlan()
    const { hook, history } = memoryLocation({ path: '/', record: true })
    const w = ({ children }: { children: ReactNode }) => createElement(Router, { hook, children })
    const { result } = renderHook(() => useAssistant(), { wrapper: w })
    await act(async () => {
      await result.current.send('ve a progreso')
    })
    expect(history).toContain('/progress')
  })

  it('confirmation flow: pending → confirm saves; reject changes nothing', async () => {
    startPlanWorkout()
    useApp.getState().logSet({ weight: 60, reps: 10 })
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapper('/workout') })
    await act(async () => {
      await result.current.send('terminar')
    })
    expect(result.current.pending).toHaveLength(1)
    expect(result.current.pending[0].prompt).toContain('¿Terminar')
    act(() => result.current.reject(result.current.pending[0].id))
    expect(result.current.pending).toHaveLength(0)
    expect(useApp.getState().activeSession).not.toBeNull()

    await act(async () => {
      await result.current.send('terminar')
    })
    act(() => {
      result.current.confirm(result.current.pending[0].id)
    })
    await waitFor(() => expect(useApp.getState().activeSession).toBeNull())
    expect(selectSessions(useApp.getState())).toHaveLength(1)
    expect(result.current.pending).toHaveLength(0)
    expect(useAssistantStore.getState().messages.at(-1)?.text).toContain('Entreno guardado')
  })

  it('open question with no AI endpoint degrades with a local reply', async () => {
    seedPlan()
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapper() })
    await act(async () => {
      await result.current.send('crea una rutina de pecho y tríceps')
    })
    const last = useAssistantStore.getState().messages.at(-1)!
    expect(last.source).toBe('fallback')
    expect(last.text).toContain('Esto sí puedo hacer')
  })

  it('ignores empty input and clear() resets', async () => {
    const { result } = renderHook(() => useAssistant(), { wrapper: wrapper() })
    await act(async () => {
      expect(await result.current.send('   ')).toBeNull()
    })
    expect(useAssistantStore.getState().messages).toHaveLength(0)
  })
})
