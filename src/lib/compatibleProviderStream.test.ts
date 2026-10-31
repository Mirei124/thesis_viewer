import { describe, expect, it } from 'vitest';
import { requestCompatibleCompletionStream } from './compatibleProvider';
const config = { baseUrl: 'https://api.example.test/v1', model: 'test-model', structuredOutput: true, outputLimit: 64_000 };
const messages = [{ role: 'user' as const, content: 'Question' }];
const event = (payload: unknown) => `data: ${JSON.stringify(payload)}\r\n\r\n`;
const delta = (content: string) => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] });
const stop = event({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
function stream(chunks: Uint8Array[], cancelled?: () => void): Response {
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); },
    cancel() { cancelled?.(); },
  }), { headers: { 'content-type': 'text/event-stream' } });
}
const bytes = (value: string) => new TextEncoder().encode(value);
describe('paper QA compatible streaming adapter', () => {
  it('sends streaming-only options, preserves output limit and incrementally decodes split Chinese bytes', async () => {
    const raw = bytes(event(delta('你')) + event({ choices: [{ index: 0, delta: { reasoning_content: 'hidden', content: '好' } }] }) + stop + 'data: [DONE]\r\n\r\n');
    const chunks = Array.from(raw, value => new Uint8Array([value])); const received: string[] = [];
    const result = await requestCompatibleCompletionStream({ config, messages, apiKey: 'secret', fetchImpl: async (url, init) => {
      expect(String(url)).toBe('https://api.example.test/v1/chat/completions');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer secret' });
      expect(JSON.parse(String(init?.body))).toEqual({ model: 'test-model', messages, stream: true, stream_options: { include_usage: true }, max_tokens: 64_000, response_format: { type: 'json_object' } });
      return stream(chunks);
    } }, part => received.push(part));
    expect(received).toEqual(['你', '好']); expect(result).toEqual({ content: '你好' });
  });
  it('reads multiline data events, comments and final usage with empty choices', async () => {
    const received: string[] = [];
    const raw = ': keepalive\n\ndata: \n\nid: 1\nevent: message\ndata: {"choices":\ndata: [{"delta":{"content":"ok"}}]}\n\n' + stop + event({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_cache_hit_tokens: 7, prompt_cache_miss_tokens: 3 } }) + 'data: [DONE]';
    const result = await requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => stream([bytes(raw)]) }, value => received.push(value));
    expect(received).toEqual(['ok']);
    expect(result).toEqual({ content: 'ok', usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12, promptCacheHitTokens: 7, promptCacheMissTokens: 3 } });
  });
  it('cancels remaining transport resources immediately after DONE without waiting for EOF', async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes(event(delta('ok')) + stop + 'data: [DONE]\n\n')); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    await expect(requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => response }, () => {})).resolves.toEqual({ content: 'ok' });
    expect(cancelled).toBe(true);
  });
  it.each([
    ['missing DONE', event(delta('partial')) + stop],
    ['length truncation', event(delta('partial')) + event({ choices: [{ delta: {}, finish_reason: 'length' }] }) + 'data: [DONE]\n\n'],
    ['filtered response', event({ choices: [{ delta: {}, finish_reason: 'content_filter' }] }) + 'data: [DONE]\n\n'],
    ['malformed event', 'data: {broken}\n\n'],
    ['provider stream error', event({ error: { message: 'private provider payload' } })],
  ])('rejects %s instead of committing incomplete content', async (_label, raw) => {
    await expect(requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => stream([bytes(raw)]) }, () => {})).rejects.toMatchObject({ code: 'invalid-response' });
  });
  it('maps transport interruption to network while preserving emitted content for the caller', async () => {
    let reads = 0; const received: string[] = [];
    const response = new Response(new ReadableStream<Uint8Array>({ pull(c) { if (reads++ === 0) c.enqueue(bytes(event(delta('partial')))); else c.error(new Error('disconnected')); } }), { headers: { 'content-type': 'text/event-stream' } });
    await expect(requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => response }, part => received.push(part))).rejects.toMatchObject({ code: 'network' });
    expect(received).toEqual(['partial']);
  });
  it('aborts before fetch and cancels a blocked stream read promptly', async () => {
    const already = new AbortController(); already.abort(); let fetched = false;
    await expect(requestCompatibleCompletionStream({ config, messages, signal: already.signal, fetchImpl: async () => { fetched = true; return stream([]); } }, () => {})).rejects.toMatchObject({ code: 'aborted' });
    expect(fetched).toBe(false);
    const controller = new AbortController(); let cancelled = false; let ready!: () => void;
    const responseReady = new Promise<void>(resolve => { ready = resolve; });
    const response = new Response(new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes(event(delta('partial')))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
    const completion = requestCompatibleCompletionStream({ config, messages, signal: controller.signal, fetchImpl: async () => response }, () => ready());
    const rejection = expect(completion).rejects.toMatchObject({ code: 'aborted' });
    await responseReady; controller.abort(); await rejection; expect(cancelled).toBe(true);
  });
  it('consumes a deliberate JSON fallback once and does not implicitly retry a rejected stream option', async () => {
    let calls = 0; const received: string[] = [];
    const result = await requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }], usage: { total_tokens: 4 } }), { headers: { 'content-type': 'application/json' } }); } }, part => received.push(part));
    expect(calls).toBe(1); expect(received).toEqual(['ok']); expect(result).toMatchObject({ content: 'ok', usage: { totalTokens: 4 } });
    await expect(requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => { calls++; return new Response('unsupported stream_options', { status: 400 }); } }, () => {})).rejects.toMatchObject({ code: 'http-error' });
    expect(calls).toBe(2);
  });
  it('rejects non-stream JSON length truncation and invalid limits before sending', async () => {
    await expect(requestCompatibleCompletionStream({ config, messages, fetchImpl: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), { headers: { 'content-type': 'application/json' } }) }, () => {})).rejects.toMatchObject({ code: 'invalid-response' });
    let fetched = false;
    await expect(requestCompatibleCompletionStream({ config: { ...config, outputLimit: 0 }, messages, fetchImpl: async () => { fetched = true; return stream([]); } }, () => {})).rejects.toThrow('positive whole number');
    expect(fetched).toBe(false);
  });
});
