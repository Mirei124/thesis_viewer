import { afterEach, describe, expect, it } from 'vitest';

import { apiHostPermissionPattern, requestApiHostPermission } from './apiPermissions';
import { CompatibleProviderError, requestCompatibleCompletion } from './compatibleProvider';
import { detailedEvidencePacket, detailedSectionMessages } from './detailedOverview';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { threeLineEvidencePacket, threeLineOverviewMessages } from './threeLineOverview';
import { translationMessages } from './translationResponse';

const config = { baseUrl: 'https://api.example.test/v1', model: 'test-model', streaming: false, structuredOutput: false, outputLimit: 32_000 };
const messages = [{ role: 'user' as const, content: 'Only this text is sent.' }];

function response(body: BodyInit | null, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { browser?: unknown }).browser;
});

describe('compatible provider', () => {
  it('sends one exact completion URL and reads a non-stream response', async () => {
    let seen: RequestInit | undefined;
    let url = '';
    const result = await requestCompatibleCompletion({
      config,
      messages,
      apiKey: 'secret',
      fetchImpl: async (input, init) => {
        url = String(input);
        seen = init;
        return response(JSON.stringify({ choices: [{ message: { content: 'complete' } }] }), { status: 200 });
      },
    });
    expect(result).toEqual({ content: 'complete', streamed: false });
    expect(url).toBe('https://api.example.test/v1/chat/completions');
    expect(seen?.method).toBe('POST');
    expect(seen?.headers).toMatchObject({ authorization: 'Bearer secret' });
    expect(JSON.parse(String(seen?.body))).toEqual({ model: 'test-model', messages, stream: false, max_tokens: 32_000 });
  });

  it('returns optional non-stream token accounting without retaining payload text', async () => {
    const result = await requestCompatibleCompletion({
      config,
      messages,
      fetchImpl: async () => response(JSON.stringify({
        choices: [{ message: { content: 'complete' } }],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 16,
          total_tokens: 136,
          prompt_cache_hit_tokens: 80,
          prompt_cache_miss_tokens: 40,
          ignored: 'not exposed',
        },
      })),
    });
    expect(result).toEqual({
      content: 'complete', streamed: false,
      usage: { promptTokens: 120, completionTokens: 16, totalTokens: 136, promptCacheHitTokens: 80, promptCacheMissTokens: 40 },
    });
  });

  it('maps only the explicitly enabled structured-output capability to json_object', async () => {
    let payload: Record<string, unknown> | undefined;
    await requestCompatibleCompletion({
      config: { ...config, structuredOutput: true },
      messages,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response(JSON.stringify({ choices: [{ message: { content: 'complete' } }] }));
      },
    });
    expect(payload?.response_format).toEqual({ type: 'json_object' });

    await requestCompatibleCompletion({
      config,
      messages,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response(JSON.stringify({ choices: [{ message: { content: 'complete' } }] }));
      },
    });
    expect(payload).not.toHaveProperty('response_format');
  });

  it('does not send Authorization without a key', async () => {
    let headers: HeadersInit | undefined;
    await requestCompatibleCompletion({
      config,
      messages,
      fetchImpl: async (_input, init) => {
        headers = init?.headers;
        return response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      },
    });
    expect(headers).toEqual({ 'content-type': 'application/json' });
  });

  it.each([
    ['translation', translationMessages('A selected sentence.', 'Chinese')],
    ['three-line overview', threeLineOverviewMessages(threeLineEvidencePacket(pdfEvidenceLedgerFromPages([], 'test-document', [])))],
    ['detailed overview section', detailedSectionMessages('problem_motivation', detailedEvidencePacket(pdfEvidenceLedgerFromPages([], 'test-document', []), 'problem_motivation'))],
  ])('sends the explicit output limit for %s requests', async (_requestKind, requestMessages) => {
    let payload: Record<string, unknown> | undefined;
    await requestCompatibleCompletion({
      config,
      messages: requestMessages,
      fetchImpl: async (_input, init) => {
        payload = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }));
      },
    });
    expect(payload).toMatchObject({ model: 'test-model', stream: false, max_tokens: 32_000 });
    expect(payload?.messages).toEqual(requestMessages);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects an invalid configured output limit locally: %p', async (outputLimit) => {
    let fetched = false;
    await expect(requestCompatibleCompletion({
      config: { ...config, outputLimit },
      messages,
      fetchImpl: async () => {
        fetched = true;
        return response('unexpected');
      },
    })).rejects.toThrow('configured output limit must be a positive whole number');
    expect(fetched).toBe(false);
  });

  it('joins only completed SSE delta events', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'));
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"lo"}}]}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const result = await requestCompatibleCompletion({
      config: { ...config, streaming: true }, messages,
      fetchImpl: async () => response(stream),
    });
    expect(result).toEqual({ content: 'Hello', streamed: true });
  });

  it('reads optional accounting from an SSE terminal event', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":2,"prompt_cache_hit_tokens":64,"prompt_cache_miss_tokens":36}}\n\ndata: [DONE]\n\n'));
        controller.close();
      },
    });
    const result = await requestCompatibleCompletion({ config: { ...config, streaming: true }, messages, fetchImpl: async () => response(stream) });
    expect(result).toEqual({
      content: 'ok', streamed: true,
      usage: { promptTokens: 100, completionTokens: 2, promptCacheHitTokens: 64, promptCacheMissTokens: 36 },
    });
  });

  it('accepts a valid completion when usage is absent or malformed', async () => {
    const result = await requestCompatibleCompletion({
      config, messages,
      fetchImpl: async () => response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: -1 } })),
    });
    expect(result).toEqual({ content: 'ok', streamed: false });
  });

  it.each([
    [401, 'unauthorized'],
    [404, 'not-found'],
    [500, 'server-error'],
  ] as const)('classifies HTTP %i', async (status, code) => {
    await expect(requestCompatibleCompletion({ config, messages, fetchImpl: async () => response('error', { status }) }))
      .rejects.toMatchObject({ code });
  });

  it('classifies context, rate limits, invalid stream, and cancellation', async () => {
    await expect(requestCompatibleCompletion({
      config, messages, fetchImpl: async () => response('maximum token limit exceeded', { status: 400 }),
    })).rejects.toMatchObject({ code: 'context-too-large' });
    await expect(requestCompatibleCompletion({
      config, messages, fetchImpl: async () => response('slow down', { status: 429, headers: { 'retry-after': '12' } }),
    })).rejects.toMatchObject({ code: 'rate-limited', retryAfterSeconds: 12 });
    await expect(requestCompatibleCompletion({
      config: { ...config, streaming: true }, messages, fetchImpl: async () => response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'),
    })).rejects.toMatchObject({ code: 'invalid-response' });
    const controller = new AbortController();
    controller.abort();
    await expect(requestCompatibleCompletion({ config, messages, signal: controller.signal }))
      .rejects.toMatchObject({ code: 'aborted' });
  });
});

describe('API host permission', () => {
  it('uses minimal HTTPS and explicitly allowed loopback patterns', async () => {
    expect(apiHostPermissionPattern('https://provider.example/v1')).toBe('https://provider.example/*');
    expect(apiHostPermissionPattern('http://127.0.0.1:8181/v1')).toBe('http://127.0.0.1/*');
    let requested: unknown;
    (globalThis as { chrome?: unknown }).chrome = {
      permissions: { request: (value: unknown) => { requested = value; return Promise.resolve(true); } },
    };
    await expect(requestApiHostPermission('http://localhost:3000/v1')).resolves.toEqual({ granted: true, origin: 'http://localhost/*' });
    expect(requested).toEqual({ origins: ['http://localhost/*'] });
  });

  it('returns an explicit result if the permission prompt is rejected or unavailable', async () => {
    await expect(requestApiHostPermission('https://provider.example/v1')).resolves.toMatchObject({ granted: false, reason: 'unavailable' });
    (globalThis as { browser?: unknown }).browser = { permissions: { request: () => Promise.resolve(false) } };
    await expect(requestApiHostPermission('https://provider.example/v1')).resolves.toMatchObject({ granted: false, reason: 'denied' });
  });
});
