// @vitest-environment node
/**
 * Tests for functions/api/agent.ts (Web-standard handler) with the three upstream providers mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import handler, { LIMITS } from '../../../functions/api/agent'
import { TOOL_NAMES } from './toolDefs'

const HOST = 'gym.example.app'
let ip = 0
const nextIp = () => `10.1.0.${++ip}`

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://${HOST}/api/agent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', host: HOST, origin: `https://${HOST}`, 'cf-connecting-ip': nextIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

const USER = [{ role: 'user', text: 'registra 80 por 10' }]
const WITH_TOOL = [
  { role: 'user', text: 'registra 80 por 10' },
  { role: 'assistant', text: 'Voy.', tool_calls: [{ id: 'c1', name: 'log_set', args: { weight: 80, reps: 10 } }] },
  { role: 'tool', results: [{ id: 'c1', name: 'log_set', content: '{"ok":true,"result":{"logged":1}}' }] },
]

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const fetchMock = vi.fn<typeof fetch>()
const upstreamBody = () => JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
const upstreamHeaders = () => fetchMock.mock.calls[0][1]?.headers as Record<string, string>
const upstreamUrl = () => String(fetchMock.mock.calls[0][0])

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  for (const k of ['ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'COACH_API_KEY', 'COACH_BASE_URL', 'COACH_MODEL', 'COACH_PROVIDER', 'AGENT_PROVIDER', 'AGENT_MODEL', 'COACH_DAILY_LIMIT', 'AGENT_DAILY_LIMIT']) vi.stubEnv(k, '')
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('guards', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret'))

  it('GET reports enabled + digest; disabled without keys', async () => {
    const res = await handler.fetch(new Request(`https://${HOST}/api/agent`))
    expect(await res.json()).toMatchObject({ enabled: true, toolsDigest: expect.any(String) })
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    expect(await (await handler.fetch(new Request(`https://${HOST}/api/agent`))).json()).toMatchObject({ enabled: false })
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(503)
  })

  it('rejects cross-origin, wrong content type, bad JSON, wrong method', async () => {
    expect((await handler.fetch(post({ messages: USER }, { origin: 'https://evil.example' }))).status).toBe(403)
    expect((await handler.fetch(post({ messages: USER }, { 'content-type': 'text/plain' }))).status).toBe(415)
    expect((await handler.fetch(post('{nope'))).status).toBe(400)
    expect((await handler.fetch(new Request(`https://${HOST}/api/agent`, { method: 'DELETE' }))).status).toBe(405)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('accepts an extra allowed origin', async () => {
    vi.stubEnv('AGENT_ALLOWED_ORIGINS', 'https://app.example.com')
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }))
    expect((await handler.fetch(post({ messages: USER }, { origin: 'https://app.example.com' }))).status).toBe(200)
  })

  it('size and shape limits', async () => {
    const big = JSON.stringify({ messages: [{ role: 'user', text: 'x'.repeat(LIMITS.bodyChars) }] })
    expect((await handler.fetch(post(big))).status).toBe(413)
    const many = Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: 'hola' }))
    expect((await handler.fetch(post({ messages: many }))).status).toBe(400)
    const bad: unknown[] = [
      [],
      'hola',
      [{ role: 'system', text: 'x' }],
      [{ role: 'assistant', text: 'x' }], // must start with user
      [{ role: 'user', text: 'x' }, { role: 'assistant', text: 'y' }], // must end with user/tool
      [{ role: 'user', text: '' }],
      [{ role: 'user', text: 'x'.repeat(LIMITS.userText + 1) }],
      [{ role: 'user', text: 'x' }, { role: 'assistant', tool_calls: [{ id: 'c1', name: 'rm_rf', args: {} }] }, { role: 'tool', results: [{ id: 'c1', name: 'rm_rf', content: '{}' }] }],
      // tool call without its result / result with the wrong id
      [{ role: 'user', text: 'x' }, { role: 'assistant', tool_calls: [{ id: 'c1', name: 'log_set', args: {} }] }, { role: 'user', text: 'y' }],
      [{ role: 'user', text: 'x' }, { role: 'assistant', tool_calls: [{ id: 'c1', name: 'log_set', args: {} }] }, { role: 'tool', results: [{ id: 'zz', name: 'log_set', content: '{}' }] }],
      // orphan tool result
      [{ role: 'user', text: 'x' }, { role: 'tool', results: [{ id: 'c1', name: 'log_set', content: '{}' }] }],
      [{ role: 'user', text: 'x' }, { role: 'assistant', tool_calls: [{ id: 'bad id!', name: 'log_set', args: {} }] }, { role: 'tool', results: [{ id: 'bad id!', name: 'log_set', content: '{}' }] }],
    ]
    for (const messages of bad) expect((await handler.fetch(post({ messages }))).status, JSON.stringify(messages).slice(0, 80)).toBe(400)
    expect((await handler.fetch(post({}))).status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('per-IP rate limit and optional daily limit', async () => {
    fetchMock.mockImplementation(async () => ok({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }))
    const same = { 'cf-connecting-ip': '9.9.9.9' }
    for (let i = 0; i < LIMITS.perIp; i++) expect((await handler.fetch(post({ messages: USER }, same))).status).toBe(200)
    const res = await handler.fetch(post({ messages: USER }, same))
    expect(res.status).toBe(429)
    expect(res.headers.get('retry-after')).toBeTruthy()
    vi.stubEnv('AGENT_DAILY_LIMIT', '1')
    // the daily counter is per instance; whatever was counted already exceeds 1
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(429)
  })
})

describe('anthropic adapter', () => {
  beforeEach(() => vi.stubEnv('ANTHROPIC_API_KEY', 'sk-ant-secret'))

  it('request shape: cached system+tools, no forced tool_choice, no sampling params, tool_result pairing', async () => {
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'Hecho.' }], stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 7, cache_read_input_tokens: 90 } }))
    const res = await handler.fetch(post({ messages: WITH_TOOL }))
    expect(upstreamUrl()).toBe('https://api.anthropic.com/v1/messages')
    expect(upstreamHeaders()['x-api-key']).toBe('sk-ant-secret')
    const b = upstreamBody()
    expect(b.model).toBe('claude-haiku-5-5')
    expect(b.max_tokens).toBe(700)
    expect(b.output_config).toEqual({ effort: 'low' })
    expect(b.thinking).toEqual({ type: 'disabled' })
    for (const k of ['temperature', 'top_p', 'top_k', 'tool_choice']) expect(b).not.toHaveProperty(k)
    expect(b.system[0]).toMatchObject({ type: 'text', cache_control: { type: 'ephemeral' } })
    expect(b.system[0].text).toContain('datos de la app')
    expect(b.tools.map((t: any) => t.name)).toEqual([...TOOL_NAMES])
    expect(b.tools[0]).toHaveProperty('input_schema')
    expect(b.tools.at(-1).cache_control).toEqual({ type: 'ephemeral' })
    expect(b.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'registra 80 por 10' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'Voy.' }, { type: 'tool_use', id: 'c1', name: 'log_set', input: { weight: 80, reps: 10 } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '{"ok":true,"result":{"logged":1}}' }] },
    ])
    expect(await res.json()).toEqual({
      message: { text: 'Hecho.', tool_calls: [] },
      usage: { input_tokens: 100, output_tokens: 7, cached_tokens: 90 },
      toolsDigest: expect.any(String),
    })
  })

  it('normalizes tool_use, ignores thinking blocks, drops unknown tools', async () => {
    fetchMock.mockResolvedValue(
      ok({
        content: [
          { type: 'thinking', thinking: '', signature: 'x' },
          { type: 'text', text: 'Voy a registrarlo.' },
          { type: 'tool_use', id: 'toolu_1', name: 'log_set', input: { weight: 70, reps: 8 } },
          { type: 'tool_use', id: 'toolu_2', name: 'launch_missiles', input: {} },
        ],
        stop_reason: 'tool_use',
      }),
    )
    const body = await (await handler.fetch(post({ messages: USER }))).json()
    expect(body.message).toEqual({ text: 'Voy a registrarlo.', tool_calls: [{ id: 'toolu_1', name: 'log_set', args: { weight: 70, reps: 8 } }] })
  })

  it('model override only accepts claude-* names; other models get no `thinking` param', async () => {
    vi.stubEnv('AGENT_MODEL', 'claude-sonnet-5-5')
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }))
    await handler.fetch(post({ messages: USER }))
    expect(upstreamBody().model).toBe('claude-sonnet-5-5')
    expect(upstreamBody()).not.toHaveProperty('thinking')
    fetchMock.mockClear()
    vi.stubEnv('AGENT_MODEL', 'gpt-evil')
    await handler.fetch(post({ messages: USER }))
    expect(upstreamBody().model).toBe('claude-haiku-5-5')
  })

  it('merges consecutive same-role turns (valid alternation)', async () => {
    fetchMock.mockResolvedValue(ok({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' }))
    await handler.fetch(post({ messages: [{ role: 'user', text: 'a' }, { role: 'user', text: 'b' }] }))
    expect(upstreamBody().messages).toHaveLength(1)
    expect(upstreamBody().messages[0].content).toHaveLength(2)
  })

  it('truncated text is cut at a sentence; empty, refusal and upstream errors are generic', async () => {
    fetchMock.mockResolvedValueOnce(ok({ content: [{ type: 'text', text: 'Primera frase completa y bastante larga para pasar el mínimo. Segunda que se corta a la mit' }], stop_reason: 'max_tokens' }))
    expect((await (await handler.fetch(post({ messages: USER }))).json()).message.text).toBe('Primera frase completa y bastante larga para pasar el mínimo.')
    fetchMock.mockResolvedValueOnce(ok({ content: [], stop_reason: 'end_turn' }))
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(502)
    fetchMock.mockResolvedValueOnce(ok({ content: [], stop_reason: 'refusal' }))
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(422)
  })

  it('never leaks upstream errors or the key', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{"error":{"message":"invalid x-api-key sk-ant-secret"}}', { status: 401 }))
    let res = await handler.fetch(post({ messages: USER }))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toMatch(/sk-ant|invalid|x-api-key/)
    fetchMock.mockResolvedValueOnce(new Response('slow down', { status: 429 }))
    res = await handler.fetch(post({ messages: USER }))
    expect(res.status).toBe(503)
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED sk-ant-secret'))
    res = await handler.fetch(post({ messages: USER }))
    expect(res.status).toBe(504)
    expect(await res.text()).toBe('{"error":"unavailable"}')
  })
})

describe('gemini adapter', () => {
  beforeEach(() => vi.stubEnv('GEMINI_API_KEY', 'g-secret'))

  it('request shape: functionDeclarations, functionCall/functionResponse parts, key in header', async () => {
    fetchMock.mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: 'Listo.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 4 } }))
    const res = await handler.fetch(post({ messages: WITH_TOOL }))
    expect(upstreamUrl()).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent')
    expect(upstreamUrl()).not.toContain('g-secret')
    expect(upstreamHeaders()['x-goog-api-key']).toBe('g-secret')
    const b = upstreamBody()
    expect(b.systemInstruction.parts[0].text).toContain('Gymfullness')
    expect(b.generationConfig.maxOutputTokens).toBe(700)
    const decl = b.tools[0].functionDeclarations
    expect(decl.map((d: any) => d.name)).toEqual([...TOOL_NAMES])
    expect(decl.find((d: any) => d.name === 'skip_rest')).not.toHaveProperty('parameters')
    expect(JSON.stringify(decl)).not.toContain('maxLength')
    expect(b.contents).toEqual([
      { role: 'user', parts: [{ text: 'registra 80 por 10' }] },
      { role: 'model', parts: [{ text: 'Voy.' }, { functionCall: { name: 'log_set', args: { weight: 80, reps: 10 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'log_set', response: { ok: true, result: { logged: 1 } } } }] },
    ])
    expect(await res.json()).toMatchObject({ message: { text: 'Listo.', tool_calls: [] }, usage: { input_tokens: 50, output_tokens: 4 } })
  })

  it('normalizes functionCall parts (ids generated, unknown tools dropped, thoughts skipped)', async () => {
    fetchMock.mockResolvedValue(
      ok({
        candidates: [
          {
            content: {
              parts: [
                { text: 'pensando…', thought: true },
                { functionCall: { name: 'search_exercises', args: { query: 'plancha' } } },
                { functionCall: { name: 'get_progress', args: { period: 'week' } } },
                { functionCall: { name: 'nope', args: {} } },
              ],
            },
            finishReason: 'STOP',
          },
        ],
      }),
    )
    const m = (await (await handler.fetch(post({ messages: USER }))).json()).message
    expect(m.text).toBe('')
    expect(m.tool_calls.map((c: any) => c.name)).toEqual(['search_exercises', 'get_progress'])
    expect(m.tool_calls[0].args).toEqual({ query: 'plancha' })
    expect(new Set(m.tool_calls.map((c: any) => c.id)).size).toBe(2)
    expect(m.tool_calls[0].id).toMatch(/^[\w-]{1,64}$/)
  })

  it('safety block → 422, errors hidden', async () => {
    fetchMock.mockResolvedValueOnce(ok({ candidates: [{ finishReason: 'SAFETY' }] }))
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(422)
    fetchMock.mockResolvedValueOnce(new Response('quota g-secret', { status: 500 }))
    const res = await handler.fetch(post({ messages: USER }))
    expect(res.status).toBe(502)
    expect(await res.text()).not.toContain('g-secret')
  })

  it('wraps non-object tool results', async () => {
    fetchMock.mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
    const msgs = JSON.parse(JSON.stringify(WITH_TOOL))
    msgs[2].results[0].content = 'texto plano'
    await handler.fetch(post({ messages: msgs }))
    expect(upstreamBody().contents[2].parts[0].functionResponse.response).toEqual({ content: 'texto plano' })
  })
})

describe('openai-compatible adapter', () => {
  beforeEach(() => {
    vi.stubEnv('COACH_API_KEY', 'oa-secret')
    vi.stubEnv('COACH_BASE_URL', 'https://api.groq.com/openai/v1/')
    vi.stubEnv('COACH_MODEL', 'llama-3.3-70b')
  })

  it('request shape: system + tools + assistant tool_calls + one tool message per result', async () => {
    fetchMock.mockResolvedValue(ok({ choices: [{ message: { content: 'Listo.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 60, completion_tokens: 3 } }))
    const msgs = JSON.parse(JSON.stringify(WITH_TOOL))
    msgs[1].tool_calls.push({ id: 'c2', name: 'get_context', args: {} })
    msgs[2].results.push({ id: 'c2', name: 'get_context', content: '{"ok":true}' })
    const res = await handler.fetch(post({ messages: msgs }))
    expect(upstreamUrl()).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(upstreamHeaders().authorization).toBe('Bearer oa-secret')
    const b = upstreamBody()
    expect(b.model).toBe('llama-3.3-70b')
    expect(b.tools[0]).toMatchObject({ type: 'function', function: { name: 'get_context' } })
    expect(b.messages[0].role).toBe('system')
    expect(b.messages[2]).toEqual({
      role: 'assistant',
      content: 'Voy.',
      tool_calls: [
        { id: 'c1', type: 'function', function: { name: 'log_set', arguments: '{"weight":80,"reps":10}' } },
        { id: 'c2', type: 'function', function: { name: 'get_context', arguments: '{}' } },
      ],
    })
    expect(b.messages.slice(3)).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: '{"ok":true,"result":{"logged":1}}' },
      { role: 'tool', tool_call_id: 'c2', content: '{"ok":true}' },
    ])
    expect(await res.json()).toMatchObject({ message: { text: 'Listo.', tool_calls: [] }, usage: { input_tokens: 60, output_tokens: 3 } })
  })

  it('normalizes tool_calls (string arguments), strips <think>, tolerates bad JSON args', async () => {
    fetchMock.mockResolvedValue(
      ok({
        choices: [
          {
            message: {
              content: '<think>razonando</think>Voy.',
              tool_calls: [
                { id: 'call_9', type: 'function', function: { name: 'log_set', arguments: '{"weight":60,"reps":10}' } },
                { id: '', type: 'function', function: { name: 'get_progress', arguments: '{rota' } },
                { id: 'call_x', type: 'function', function: { name: 'format_disk', arguments: '{}' } },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      }),
    )
    const m = (await (await handler.fetch(post({ messages: USER }))).json()).message
    expect(m.text).toBe('Voy.')
    expect(m.tool_calls).toHaveLength(2)
    expect(m.tool_calls[0]).toEqual({ id: 'call_9', name: 'log_set', args: { weight: 60, reps: 10 } })
    expect(m.tool_calls[1].args).toEqual({})
    expect(m.tool_calls[1].id).toMatch(/^[\w-]{1,64}$/)
  })

  it('rejects non-https base URLs and hides errors', async () => {
    vi.stubEnv('COACH_BASE_URL', 'http://evil.example/v1')
    const res = await handler.fetch(post({ messages: USER }))
    expect(res.status).toBe(504)
    expect(fetchMock).not.toHaveBeenCalled()
    vi.stubEnv('COACH_BASE_URL', 'https://api.groq.com/openai/v1')
    fetchMock.mockResolvedValueOnce(new Response('bad oa-secret', { status: 401 }))
    const r2 = await handler.fetch(post({ messages: USER }))
    expect(r2.status).toBe(502)
    expect(await r2.text()).not.toContain('oa-secret')
  })
})

describe('provider selection', () => {
  it('AGENT_PROVIDER wins, falls back to COACH_PROVIDER, first key otherwise', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'a')
    vi.stubEnv('GEMINI_API_KEY', 'g')
    fetchMock.mockResolvedValue(ok({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] }))
    vi.stubEnv('AGENT_PROVIDER', 'gemini')
    await handler.fetch(post({ messages: USER }))
    expect(upstreamUrl()).toContain('generativelanguage')
    fetchMock.mockClear()
    vi.stubEnv('AGENT_PROVIDER', '')
    vi.stubEnv('COACH_PROVIDER', 'gemini')
    await handler.fetch(post({ messages: USER }))
    expect(upstreamUrl()).toContain('generativelanguage')
    // a forced provider without its key disables the endpoint
    vi.stubEnv('AGENT_PROVIDER', 'openai')
    expect((await handler.fetch(post({ messages: USER }))).status).toBe(503)
  })
})
