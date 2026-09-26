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
  config: Pick<ModelConfig, 'baseUrl' | 'model' | 'streaming' | 'structuredOutput' | 'outputLimit'>;
  messages: readonly ChatMessage[];
  apiKey?: string;
  signal?: AbortSignal;
  /** Injectable for deterministic tests; production callers omit it. */
  fetchImpl?: typeof fetch;
};

export type CompatibleResponse = {
  content: string;
  streamed: boolean;
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

function streamDeltaFromEvent(data: string): string {
  let payload: unknown;
  try {
    payload = JSON.parse(data);
  } catch {
    throw invalidResponse();
  }
  if (!payload || typeof payload !== 'object') throw invalidResponse();
  const choices = (payload as { choices?: unknown }).choices;
  // OpenAI-compatible usage terminal chunks may intentionally have no choice.
  if (!Array.isArray(choices)) throw invalidResponse();
  if (choices.length === 0) return '';
  if (!choices[0] || typeof choices[0] !== 'object') throw invalidResponse();
  const delta = (choices[0] as { delta?: unknown }).delta;
  const content = delta && typeof delta === 'object' ? (delta as { content?: unknown }).content : undefined;
  // A role-only / finish event is valid but contributes no text.
  if (content === undefined) return '';
  if (typeof content !== 'string') throw invalidResponse();
  return content;
}

async function readSse(response: Response, signal?: AbortSignal): Promise<{ content: string; usage?: CompatibleUsage }> {
  if (!response.body) throw invalidResponse();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let eventLines: string[] = [];
  let content = '';
  let complete = false;
  let usage: CompatibleUsage | undefined;

  const processEvent = () => {
    const data = eventLines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n');
    eventLines = [];
    if (!data) return;
    if (data === '[DONE]') {
      complete = true;
      return;
    }
    let payload: unknown;
    try {
      payload = JSON.parse(data);
    } catch {
      throw invalidResponse();
    }
    // Some compatible providers send usage in a final event with an empty
    // choices array. Treat it as accounting, not malformed text.
    usage = usageFromPayload(payload) ?? usage;
    content += streamDeltaFromEvent(data);
  };

  try {
    while (true) {
      if (signal?.aborted) throw new CompatibleProviderError('aborted');
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, newline).replace(/\r$/, '');
        pending = pending.slice(newline + 1);
        if (line === '') processEvent();
        else if (!line.startsWith(':')) eventLines.push(line);
      }
      if (done) break;
    }
    if (pending) eventLines.push(pending.replace(/\r$/, ''));
    if (eventLines.length) processEvent();
  } catch (error) {
    if (error instanceof CompatibleProviderError) throw error;
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw new CompatibleProviderError('aborted');
    throw new CompatibleProviderError('network');
  } finally {
    reader.releaseLock();
  }
  if (!complete) throw invalidResponse();
  return { content, ...(usage ? { usage } : {}) };
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
        stream: request.config.streaming,
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
  if (request.config.streaming) {
    const streamed = await readSse(response, request.signal);
    return { ...streamed, streamed: true };
  }
  try {
    const payload = await response.json();
    const usage = usageFromPayload(payload);
    return { content: contentFromNonStream(payload), streamed: false, ...(usage ? { usage } : {}) };
  } catch (error) {
    if (error instanceof CompatibleProviderError) throw error;
    throw invalidResponse();
  }
}

export const __testOnly = { completionUrl, retryAfterSeconds, contentFromNonStream, streamDeltaFromEvent, usageFromPayload, validatedOutputLimit };
