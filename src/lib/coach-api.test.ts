// @vitest-environment node
/**
 * Tests for the Vercel function api/coach.ts (Web-standard handler), with the upstream
 * Anthropic API mocked. Lives in src/ so `npm test` runs it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler from '../../api/coach'

const HOST = 'gym.example.app'
let ipCounter = 0
const nextIp = () => `10.0.0.${++ipCounter}`

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}/api/coach`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      host: HOST,
      origin: `https://${HOST}`,
      'x-real-ip': headers['x-real-ip'] ?? nextIp(),
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const upstreamOk = (text: string, stop_reason = 'end_turn') =>
  new Response(
    JSON.stringify({
      type: 'message',
      content: [
        { type: 'thinking', thinking: '', signature: 'x' },
        { type: 'text', text },
      ],
      stop_reason,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('api/coach', () => {
  const fetchMock = vi.fn<typeof fetch>()

  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-test-secret')
    vi.stubEnv('COACH_DAILY_LIMIT', '')
    vi.stubEnv('COACH_MODEL', '')
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
  })

  it('GET reports whether the key is configured', async () => {
    let res = await handler.fetch(new Request(`https://${HOST}/api/coach`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ enabled: true })
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    res = await handler.fetch(new Request(`https://${HOST}/api/coach`))
    expect(await res.json()).toEqual({ enabled: false })
    expect(res.headers.get('cache-control')).toBe('no-store')
  })

  it('POST calls the Messages API with Haiku, low effort, no sampling params, and the exercise context', async () => {
    fetchMock.mockResolvedValue(upstreamOk('• Baja controlado.\n• Empuja fuerte.'))
    const res = await handler.fetch(
      post({
        question: '¿Cómo mejoro?',
        context: { exercise: { name: 'Press de banca', primary: 'Pecho', cues: ['Codos a 45°'] }, profile: { goal: 'strength' } },
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ answer: '• Baja controlado.\n• Empuja fuerte.' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant-test-secret')
    expect(headers['anthropic-version']).toBe('2026-10-21')
    const body = JSON.parse(String(init?.body)) as Record<string, unknown> & {
      messages: { role: string; content: string }[]
    }
    expect(body.model).toBe('claude-haiku-5-5')
    expect(body.output_config).toEqual({ effort: 'low' })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('thinking')
    expect(typeof body.system).toBe('string')
    expect(body.messages).toHaveLength(1)
    expect(body.messages[0].role).toBe('user')
    expect(body.messages[0].content).toContain('Press de banca')
    expect(body.messages[0].content).toContain('Codos a 45°')
    expect(body.messages[0].content).toContain('ganar fuerza')
    expect(body.messages[0].content).toContain('Pregunta: ¿Cómo mejoro?')
  })

  it('validates input', async () => {
    expect((await handler.fetch(post({ question: '' }))).status).toBe(400)
    expect((await handler.fetch(post({ question: 'x'.repeat(501) }))).status).toBe(400)
    expect((await handler.fetch(post({ question: 'ok', context: 'texto' }))).status).toBe(400)
    expect((await handler.fetch(post({ question: 'ok', context: { recentSummary: 'x'.repeat(5000) } }))).status).toBe(413)
    expect((await handler.fetch(post('{nope'))).status).toBe(400)
    expect((await handler.fetch(post({ question: 'ok' }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects cross-origin requests and requests without an origin', async () => {
    expect((await handler.fetch(post({ question: 'hola' }, { origin: 'https://evil.example' }))).status).toBe(403)
    const noOrigin = new Request(`https://${HOST}/api/coach`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: HOST },
      body: JSON.stringify({ question: 'hola' }),
    })
    expect((await handler.fetch(noOrigin)).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('allows extra origins from COACH_ALLOWED_ORIGINS', async () => {
    vi.stubEnv('COACH_ALLOWED_ORIGINS', 'https://midominio.com')
    fetchMock.mockResolvedValue(upstreamOk('Hola.'))
    expect((await handler.fetch(post({ question: 'hola' }, { origin: 'https://midominio.com' }))).status).toBe(200)
  })

  it('rate limits 20 requests per hour per IP', async () => {
    fetchMock.mockImplementation(async () => upstreamOk('ok'))
    const ip = '192.168.1.50'
    for (let i = 0; i < 20; i++) expect((await handler.fetch(post({ question: 'hola' }, { 'x-real-ip': ip }))).status).toBe(200)
    const limited = await handler.fetch(post({ question: 'hola' }, { 'x-real-ip': ip }))
    expect(limited.status).toBe(429)
    expect((await handler.fetch(post({ question: 'hola' }))).status).toBe(200) // other IP still fine
  })

  it('never leaks upstream errors or the key', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key sk-ant-test-secret' } }), {
        status: 401,
      }),
    )
    const res = await handler.fetch(post({ question: 'hola' }))
    expect(res.status).toBe(502)
    const text = await res.text()
    expect(text).toBe(JSON.stringify({ error: 'unavailable' }))
    expect(text).not.toContain('sk-ant')
  })

  it('maps refusals, empty answers and network failures to errors the app falls back on', async () => {
    fetchMock.mockResolvedValueOnce(upstreamOk('', 'refusal'))
    expect((await handler.fetch(post({ question: 'hola' }))).status).toBe(422)
    fetchMock.mockResolvedValueOnce(upstreamOk('   '))
    expect((await handler.fetch(post({ question: 'hola' }))).status).toBe(502)
    fetchMock.mockRejectedValueOnce(new DOMException('timeout', 'TimeoutError'))
    expect((await handler.fetch(post({ question: 'hola' }))).status).toBe(504)
  })

  it('keeps whole lines when the answer hit max_tokens', async () => {
    fetchMock.mockResolvedValue(upstreamOk('• Primera línea completa con detalle.\n• Segunda línea completa también.\n• Terce', 'max_tokens'))
    const res = await handler.fetch(post({ question: 'hola' }))
    expect(((await res.json()) as { answer: string }).answer).toBe(
      '• Primera línea completa con detalle.\n• Segunda línea completa también.',
    )
  })

  it('returns 503 when disabled and 405 for other methods', async () => {
    expect((await handler.fetch(new Request(`https://${HOST}/api/coach`, { method: 'DELETE' }))).status).toBe(405)
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect((await handler.fetch(post({ question: 'hola' }))).status).toBe(503)
  })

  it('honours COACH_DAILY_LIMIT', async () => {
    fetchMock.mockImplementation(async () => upstreamOk('ok'))
    vi.stubEnv('COACH_DAILY_LIMIT', '1')
    // earlier tests already used today's budget on this instance
    const res = await handler.fetch(post({ question: 'hola' }))
    expect(res.status).toBe(429)
    expect(await res.json()).toEqual({ error: 'daily_limit' })
  })
})
