import { normalizeBaseUrl, type ModelConfig } from './modelConfig';

export type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type ProviderErrorCode =
  | 'aborted'
  | 'network'
  | 'unauthorized'
  | 'not-found'
  | 'context-too-large'
  | 'rate-limited'
  | 'server-error'
  | 'http-error'
  | 'invalid-response';

export class CompatibleProviderError extends Error {
  readonly code: ProviderErrorCode;
  readonly status?: number;
  readonly retryAfterSeconds?: number;

  constructor(code: ProviderErrorCode, options: { status?: number; retryAfterSeconds?: number } = {}) {
    super(code);
    this.name = 'CompatibleProviderError';
    this.code = code;
    this.status = options.status;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

export type CompatibleRequest = {
  config: Pick<ModelConfig, 'baseUrl' | 'model' | 'structuredOutput' | 'outputLimit'>;
  messages: readonly ChatMessage[];
  apiKey?: string;
  signal?: AbortSignal;
  /** Injectable for deterministic tests; production callers omit it. */
  fetchImpl?: typeof fetch;
};

export type CompatibleResponse = {
  content: string;
  /**
   * Optional provider accounting. It is deliberately limited to numeric token
   * counters: callers must never need to retain messages, completions, or
   * credentials merely to show local request diagnostics.
   */
  usage?: CompatibleUsage;
};

export type CompatibleUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  promptCacheHitTokens?: number;
  promptCacheMissTokens?: number;
};

function completionUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

/**
 * The configured limit is user-supplied data, so check it again at the network
 * boundary before placing it in a provider request.  This adapter deliberately
 * has one documented OpenAI-compatible mapping and never guesses alternatives.
 */
function validatedOutputLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('The configured output limit must be a positive whole number.');
  }
  return value;
}

function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, Math.ceil((timestamp - now) / 1000));
}

async function responseSaysContextTooLarge(response: Response): Promise<boolean> {
  if (response.status !== 400 && response.status !== 413) return false;
  try {
    return /context|maximum.*token|token.*limit|too many tokens/i.test(await response.clone().text());
  } catch {
    return false;
  }
}

async function errorForResponse(response: Response): Promise<CompatibleProviderError> {
  if (response.status === 401 || response.status === 403) return new CompatibleProviderError('unauthorized', { status: response.status });
  if (response.status === 404) return new CompatibleProviderError('not-found', { status: response.status });
  if (await responseSaysContextTooLarge(response)) return new CompatibleProviderError('context-too-large', { status: response.status });
  if (response.status === 429) return new CompatibleProviderError('rate-limited', {
    status: response.status,
    retryAfterSeconds: retryAfterSeconds(response.headers.get('retry-after')),
  });
  if (response.status >= 500 && response.status <= 599) return new CompatibleProviderError('server-error', { status: response.status });
  return new CompatibleProviderError('http-error', { status: response.status });
}

function invalidResponse(): CompatibleProviderError {
  return new CompatibleProviderError('invalid-response');
}

function optionalTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Reads known OpenAI-compatible counters but never makes their absence fatal. */
function usageFromPayload(payload: unknown): CompatibleUsage | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;
  const result: CompatibleUsage = {
    promptTokens: optionalTokenCount(record.prompt_tokens),
    completionTokens: optionalTokenCount(record.completion_tokens),
    totalTokens: optionalTokenCount(record.total_tokens),
    promptCacheHitTokens: optionalTokenCount(record.prompt_cache_hit_tokens),
    promptCacheMissTokens: optionalTokenCount(record.prompt_cache_miss_tokens),
  };
  return Object.values(result).some((value) => value !== undefined) ? result : undefined;
}

function contentFromNonStream(payload: unknown): string {
  if (!payload || typeof payload !== 'object') throw invalidResponse();
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length < 1) throw invalidResponse();
  const message = choices[0] && typeof choices[0] === 'object'
    ? (choices[0] as { message?: unknown }).message
    : undefined;
  const content = message && typeof message === 'object'
    ? (message as { content?: unknown }).content
    : undefined;
  if (typeof content !== 'string') throw invalidResponse();
  return content;
}

/** Sends only caller-supplied messages to the configured OpenAI-compatible endpoint. */
export async function requestCompatibleCompletion(request: CompatibleRequest): Promise<CompatibleResponse> {
  const fetchImpl = request.fetchImpl ?? globalThis.fetch;
  if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
  // Revalidate at the network boundary. Settings normally supplies a normalized
  // value, but a caller must not be able to turn this adapter into an arbitrary
  // HTTP request or put credentials/query data into the destination URL.
  const baseUrl = normalizeBaseUrl(request.config.baseUrl);
  const outputLimit = validatedOutputLimit(request.config.outputLimit);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`;
  let response: Response;
  try {
    response = await fetchImpl(completionUrl(baseUrl), {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: request.config.model,
        messages: request.messages,
        stream: false,
        // First-version protocol contract: OpenAI-compatible chat completion
        // endpoints receive the explicitly configured limit as max_tokens.
        max_tokens: outputLimit,
        // This is an explicit user-declared capability. Do not infer it from
        // the model name or retry with another protocol when it is rejected.
        ...(request.config.structuredOutput ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: request.signal,
    });
  } catch (error) {
    if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
    throw new CompatibleProviderError('network');
  }
  if (!response.ok) throw await errorForResponse(response);
  try {
    const payload = await response.json();
    if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
    const usage = usageFromPayload(payload);
    return { content: contentFromNonStream(payload), ...(usage ? { usage } : {}) };
  } catch (error) {
    if (error instanceof CompatibleProviderError) throw error;
    if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
    throw invalidResponse();
  }
}

/** A separate streaming adapter for paper QA; overview/translation keep their
 * existing non-streaming protocol. Never retries a paid generation implicitly. */
export async function requestCompatibleCompletionStream(
  request: CompatibleRequest,
  onDelta: (delta: string) => void,
): Promise<CompatibleResponse> {
  if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
  const baseUrl = normalizeBaseUrl(request.config.baseUrl);
  const outputLimit = validatedOutputLimit(request.config.outputLimit);
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'text/event-stream' };
  if (request.apiKey) headers.authorization = `Bearer ${request.apiKey}`;
  let response: Response;
  try {
    response = await (request.fetchImpl ?? globalThis.fetch)(completionUrl(baseUrl), {
      method: 'POST', headers, signal: request.signal,
      body: JSON.stringify({
        model: request.config.model, messages: request.messages, stream: true,
        stream_options: { include_usage: true }, max_tokens: outputLimit,
        ...(request.config.structuredOutput ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
  } catch (error) {
    if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
    throw new CompatibleProviderError('network');
  }
  if (!response.ok) throw await errorForResponse(response);
  if (request.signal?.aborted) {
    await response.body?.cancel().catch(() => undefined);
    throw new CompatibleProviderError('aborted');
  }
  // Some compatible services deliberately return one JSON response even when
  // asked to stream. Consume that response once; do not send another request.
  if (/application\/(?:[\w.+-]+\+)?json/i.test(response.headers.get('content-type') ?? '')) {
    try {
      const payload: unknown = await response.json();
      if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
      const choices = (payload as { choices?: Array<{ finish_reason?: unknown }> } | null)?.choices;
      const reason = Array.isArray(choices) ? choices[0]?.finish_reason : undefined;
      if (reason !== undefined && reason !== null && reason !== 'stop') throw invalidResponse();
      const content = contentFromNonStream(payload);
      onDelta(content);
      if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
      const usage = usageFromPayload(payload);
      return { content, ...(usage ? { usage } : {}) };
    } catch (error) {
      if (error instanceof CompatibleProviderError) throw error;
      if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
      throw invalidResponse();
    }
  }
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let buffer = '', dataLines: string[] = [], content = '', done = false;
  let usage: CompatibleUsage | undefined;
  const abortReading = () => { void reader.cancel().catch(() => undefined); };
  request.signal?.addEventListener('abort', abortReading, { once: true });
  const dispatch = () => {
    if (!dataLines.length) return;
    const data = dataLines.join('\n');
    dataLines = [];
    if (!data.trim()) return;
    if (data.trim() === '[DONE]') { done = true; return; }
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { throw invalidResponse(); }
    if (!payload || typeof payload !== 'object' || 'error' in payload) throw invalidResponse();
    const nextUsage = usageFromPayload(payload);
    if (nextUsage) {
      usage ??= {};
      for (const key of Object.keys(nextUsage) as Array<keyof CompatibleUsage>) {
        if (nextUsage[key] !== undefined) usage[key] = nextUsage[key];
      }
    }
    const choices = (payload as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) throw invalidResponse();
    // An empty choices array is the normal final accounting event.
    if (choices.length === 0) return;
    const choice = choices.find((item: unknown) => Boolean(item && typeof item === 'object' && ((item as { index?: unknown }).index === 0 || (item as { index?: unknown }).index === undefined)));
    if (!choice || typeof choice !== 'object') return;
    const reason = (choice as { finish_reason?: unknown }).finish_reason;
    if (reason !== undefined && reason !== null && reason !== 'stop') throw invalidResponse();
    const delta = (choice as { delta?: unknown }).delta;
    if (!delta || typeof delta !== 'object') throw invalidResponse();
    const text = (delta as { content?: unknown }).content;
    if (text !== undefined && text !== null && typeof text !== 'string') throw invalidResponse();
    if (typeof text === 'string' && text) { content += text; onDelta(text); }
  };
  const line = (value: string) => {
    if (!value) { dispatch(); return; }
    if (value.startsWith(':')) return;
    const colon = value.indexOf(':');
    const field = colon < 0 ? value : value.slice(0, colon);
    let valueText = colon < 0 ? '' : value.slice(colon + 1);
    if (valueText.startsWith(' ')) valueText = valueText.slice(1);
    if (field === 'data') dataLines.push(valueText);
  };
  const consume = (final = false) => {
    let start = 0;
    for (let index = 0; index < buffer.length && !done; index++) {
      if (buffer[index] !== '\r' && buffer[index] !== '\n') continue;
      // Keep a trailing CR until its possible LF arrives in the next chunk.
      if (buffer[index] === '\r' && index === buffer.length - 1 && !final) break;
      line(buffer.slice(start, index));
      if (buffer[index] === '\r' && buffer[index + 1] === '\n') index++;
      start = index + 1;
    }
    buffer = buffer.slice(start);
    if (final && !done) {
      if (buffer) line(buffer);
      buffer = '';
      dispatch();
    }
  };
  try {
    while (!done) {
      if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try { chunk = await reader.read(); } catch (error) {
        if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
        throw new CompatibleProviderError('network');
      }
      if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
      buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
      consume(chunk.done);
      if (chunk.done) break;
    }
    if (request.signal?.aborted) throw new CompatibleProviderError('aborted');
    // EOF is not completion: a dropped connection must not commit partial JSON.
    if (!done) throw invalidResponse();
    return { content, ...(usage ? { usage } : {}) };
  } catch (error) {
    if (error instanceof CompatibleProviderError) throw error;
    if (request.signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
    throw invalidResponse();
  } finally {
    request.signal?.removeEventListener('abort', abortReading);
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export const __testOnly = { completionUrl, retryAfterSeconds, contentFromNonStream, usageFromPayload, validatedOutputLimit };
