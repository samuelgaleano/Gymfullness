import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { AUTO_CONFIRM_MS, useVoice, type VoiceOptions } from './useVoice'

function setup(over: Partial<VoiceOptions> = {}) {
  const opts: VoiceOptions = {
    lang: 'es-ES',
    haptics: false,
    unit: 'kg',
    getContext: () => ({ lastWeight: 80, lastReps: 10, unit: 'kg', kind: 'weight_reps' }),
    onSet: vi.fn(),
    onEdit: vi.fn(),
    onCommand: vi.fn(),
    onUnknown: vi.fn(),
    onError: vi.fn(),
    ...over,
  }
  const hook = renderHook(() => useVoice(opts))
  return { opts, ...hook }
}

describe('useVoice (text entry)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a pending set and auto-confirms after 1.2 s', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('80 x 10'))
    expect(result.current.pending?.label).toBe('80 kg × 10')
    expect(opts.onSet).not.toHaveBeenCalled()
    act(() => void vi.advanceTimersByTime(AUTO_CONFIRM_MS + 10))
    expect(opts.onSet).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBeNull()
  })

  it('cancel stops the auto-commit', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('85 por 8'))
    act(() => result.current.cancel())
    act(() => void vi.advanceTimersByTime(3000))
    expect(opts.onSet).not.toHaveBeenCalled()
    expect(result.current.pending).toBeNull()
  })

  it('edit hands the values back without logging', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('85 por 8'))
    act(() => result.current.edit())
    act(() => void vi.advanceTimersByTime(3000))
    expect(opts.onEdit).toHaveBeenCalledTimes(1)
    expect(opts.onSet).not.toHaveBeenCalled()
  })

  it('a new utterance commits the previous pending set first', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('80 x 10'))
    act(() => result.current.submitText('82.5 x 8'))
    expect(opts.onSet).toHaveBeenCalledTimes(1)
    expect(result.current.pending?.label).toBe('82.5 kg × 8')
  })

  it('runs commands immediately and reports unknown input', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('siguiente'))
    expect(opts.onCommand).toHaveBeenCalledTimes(1)
    expect(result.current.pending).toBeNull()
    act(() => result.current.submitText('blablabla xyz'))
    expect(opts.onUnknown).toHaveBeenCalledTimes(1)
  })

  it('ignores blank text', () => {
    const { result, opts } = setup()
    act(() => result.current.submitText('   '))
    expect(result.current.pending).toBeNull()
    expect(opts.onUnknown).not.toHaveBeenCalled()
  })
})
