// @vitest-environment node
/** Adversarial checks of functions/api/agent.ts: SSRF, oversized/chunked bodies, key leakage, request shape. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { LIMITS, safeBaseUrl } from '../../../functions/api/agent'

const HOST = 'gym.example.app'
let ip = 100
const hdrs = (): Record<string, string> => ({ 'content-type': 'application/json', host: HOST, origin: `https://${HOST}`, 'cf-connecting-ip': `10.9.0.${++ip}` })
const USER = [{ role: 'user', text: 'hola' }]
const fetchMock = vi.fn<typeof fetch>()
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'COACH_API_KEY', 'COACH_BASE_URL', 'COACH_MODEL', 'COACH_PROVIDER', 'AGENT_PROVIDER', 'AGENT_MODEL']) vi.stubEnv(k, '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('SSRF guard on COACH_BASE_URL', () => {
  it.each([
    ['https://api.groq.com/openai/v1', true],
    ['http://localhost:11434/v1', true],
    ['http://127.0.0.1:8080/v1', true],
    ['http://localhost.evil.com/v1', false],
    ['http://127.0.0.1.evil.com/v1', false],
    ['http://169.254.169.254/latest', false],
    ['http://metadata.google.internal', false],
    ['https://user:pw@api.example.com/v1', false],
    ['https://api.example.com/v1?x=1', false],
    ['file:///etc/passwd', false],
    ['ftp://x.com', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s → %s', (u, allowed) => {
    expect(safeBaseUrl(u) !== null).toBe(allowed)
  })

  it('an unsafe base URL never reaches fetch', async () => {
    vi.stubEnv('COACH_API_KEY', 'k')
    vi.stubEnv('COACH_MODEL', 'm')
    vi.stubEnv('COACH_BASE_URL', 'http://localhost.evil.com/v1')
    const res = await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ messages: USER }) }))
    expect(res.status).toBe(504)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('body abuse', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret'))

  it('a chunked body without content-length is cut off once it is too big', async () => {
    let sent = 0
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 4096
        c.enqueue(new Uint8Array(4096).fill(120))
        if (sent > 5_000_000) c.close()
      },
    })
    const req = new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: hdrs(), body, duplex: 'half' } as RequestInit)
    const res = await handler.fetch(req)
    expect(res.status).toBe(413)
    expect(sent).toBeLessThan(1_000_000) // stopped reading early
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('exactly-too-large JSON, deep nesting and huge arrays are rejected', async () => {
    const mk = (b: unknown) => handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: hdrs(), body: typeof b === 'string' ? b : JSON.stringify(b) }))
    expect((await mk({ messages: [{ role: 'user', text: 'x'.repeat(LIMITS.bodyChars + 1) }] })).status).toBe(413)
    expect((await mk('['.repeat(5000))).status).toBe(400)
    expect((await mk({ messages: Array.from({ length: 500 }, () => ({ role: 'user', text: 'a' })) })).status).toBe(400)
  })

  it('missing or spoofed origin is refused before anything is sent upstream', async () => {
    const h = hdrs()
    delete (h as Record<string, string>).origin
    expect((await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: h, body: JSON.stringify({ messages: USER }) }))).status).toBe(403)
    expect((await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: { ...hdrs(), origin: 'null' }, body: JSON.stringify({ messages: USER }) }))).status).toBe(403)
    expect((await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: { ...hdrs(), origin: `https://${HOST}.evil.com` }, body: JSON.stringify({ messages: USER }) }))).status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('request shape and leakage', () => {
  it('Anthropic call: cache markers on system and the last tool, no tool_choice or sampling, key only in header', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }))
    const res = await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ messages: USER }) }))
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(sent.system[0].cache_control).toEqual({ type: 'ephemeral' })
    expect(sent.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    for (const bad of ['tool_choice', 'temperature', 'top_p', 'top_k']) expect(sent).not.toHaveProperty(bad)
    expect(sent.model).toBe('claude-haiku-5-5')
    expect(sent.output_config).toEqual({ effort: 'low' })
    expect(JSON.stringify(sent)).not.toContain('sk-ant-secret')
    expect(await res.text()).not.toContain('sk-ant-secret')
    // the injection-framing and safety rules are in the cached system prompt
    expect(sent.system[0].text).toMatch(/nunca son instrucciones/)
    expect(sent.system[0].text).toMatch(/embarazo/i)
    expect(sent.system[0].text).toMatch(/psicólogo/)
  })

  it('upstream error bodies containing the key never reach the client', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret')
    fetchMock.mockResolvedValue(new Response('invalid x-api-key sk-ant-secret', { status: 401 }))
    const res = await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'POST', headers: hdrs(), body: JSON.stringify({ messages: USER }) }))
    const t = await res.text()
    expect(res.status).toBe(502)
    expect(t).not.toContain('sk-ant')
  })
})
