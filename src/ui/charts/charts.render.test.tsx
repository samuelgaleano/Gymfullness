import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BarChart, HBarList, HeatmapCalendar, LineChart, Sparkline } from './index'

const DAY = 86_400_000
const series = (n: number) => Array.from({ length: n }, (_, i) => ({ x: Date.UTC(2026, 0, 1) + i * 7 * DAY, y: 70 + i * 0.5 }))

afterEach(cleanup)

describe('charts render', () => {
  it('LineChart: role img, label and a data table', () => {
    render(<LineChart data={series(8)} ariaLabel="Peso corporal" formatY={(y) => `${y} kg`} />)
    expect(screen.getByRole('img', { name: 'Peso corporal' })).toBeTruthy()
    expect(screen.getByText('Máximo')).toBeTruthy()
  })
  it('LineChart: one point shows the encouragement, zero shows empty', () => {
    const { unmount } = render(<LineChart data={series(1)} ariaLabel="Peso" />)
    expect(screen.getByText('Registra más entrenos para ver la tendencia')).toBeTruthy()
    unmount()
    render(<LineChart data={[]} ariaLabel="Peso" />)
    expect(screen.getByText('Sin datos todavía')).toBeTruthy()
  })
  it('LineChart ignores non-finite points', () => {
    render(<LineChart data={[...series(3), { x: NaN, y: 1 }]} ariaLabel="Peso" />)
    expect(screen.getByRole('img', { name: 'Peso' })).toBeTruthy()
  })
  it('BarChart renders every bar into the table', () => {
    render(<BarChart data={[{ label: 'a', value: 3 }, { label: 'b', value: 0 }, { label: 'c', value: 5, highlight: true }]} ariaLabel="Sesiones" />)
    expect(screen.getByRole('img', { name: 'Sesiones' })).toBeTruthy()
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
  it('BarChart all zero falls back to the empty message', () => {
    render(<BarChart data={[{ label: 'a', value: 0 }]} ariaLabel="Sesiones" />)
    expect(screen.getByText('Registra más entrenos para ver la tendencia')).toBeTruthy()
  })
  it('Sparkline handles 0, 1 and many values', () => {
    const { container, rerender } = render(<Sparkline values={[]} ariaLabel="x" />)
    expect(container.querySelector('svg')).toBeTruthy()
    rerender(<Sparkline values={[4]} />)
    expect(container.querySelector('circle')).toBeTruthy()
    rerender(<Sparkline values={[1, 2, 3, 2]} ariaLabel="x" />)
    expect(container.querySelectorAll('path').length).toBe(2)
  })
  it('HeatmapCalendar draws cells up to the end date', () => {
    const { container } = render(<HeatmapCalendar values={{ '2026-11-03': 1 }} endDate="2026-11-05" weeks={4} ariaLabel="Actividad" />)
    expect(screen.getByRole('img', { name: 'Actividad' })).toBeTruthy()
    expect(container.querySelectorAll('rect.ch-cell').length).toBe(3 * 7 + 4)
    expect(container.querySelectorAll('rect.ch-cell--on').length).toBe(1)
  })
  it('HBarList lists every row with value and target', () => {
    render(<HBarList items={[{ label: 'Pecho', value: 6, target: 10 }, { label: 'Espalda', value: 12, target: 10 }]} ariaLabel="Balance" />)
    expect(screen.getByRole('list', { name: 'Balance' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByText('Pecho')).toBeTruthy()
  })
})
