export type ModelConfig = {
  baseUrl: string;
  model: string;
  structuredOutput: boolean;
  contextLimit: number;
  outputLimit: number;
};

export type ModelConfigInput = ModelConfig & { apiKey?: string };

type ExtensionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (keys: string | string[]) => Promise<void>;
};

const CONFIG_STORAGE_KEY = 'model-config:v1';
const API_KEY_STORAGE_KEY = 'model-api-key:v1';

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-flash',
  structuredOutput: true,
  contextLimit: 32_000,
  outputLimit: 32_000,
};

function getLocalStorageArea(): ExtensionStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: ExtensionStorageArea } };
    chrome?: { storage?: { local?: ExtensionStorageArea } };
  };
  return extensionGlobal.browser?.storage?.local ?? extensionGlobal.chrome?.storage?.local;
}

function getSessionStorageArea(): ExtensionStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { storage?: { session?: ExtensionStorageArea } };
    chrome?: { storage?: { session?: ExtensionStorageArea } };
  };
  // storage.session is memory-only and, by default, is limited to trusted
  // extension contexts. Do not call setAccessLevel: content scripts must not
  // receive the key.
  return extensionGlobal.browser?.storage?.session ?? extensionGlobal.chrome?.storage?.session;
}

function isLoopbackHttpHost(hostname: string): boolean {
  return hostname.toLowerCase() === 'localhost' || hostname === '127.0.0.1';
}

/**
 * Validates an endpoint exactly as supplied by the user. The trailing slash is
 * removed only to make a later `/chat/completions` append unambiguous; no API
 * prefix is inserted or inferred.
 */
export function normalizeBaseUrl(value: string): string {
  const submitted = value.trim();
  if (!submitted) throw new Error('Enter the compatible API base URL.');

  let url: URL;
  try {
    url = new URL(submitted);
  } catch {
    throw new Error('Enter a complete HTTPS URL, or an explicit localhost HTTP URL.');
  }

  if (url.username || url.password) throw new Error('The API base URL must not contain credentials.');
  if (url.search || url.hash) throw new Error('The API base URL must not contain a query or fragment.');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHttpHost(url.hostname))) {
    throw new Error('Use HTTPS. HTTP is allowed only for localhost or 127.0.0.1.');
  }

  const normalizedPath = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${normalizedPath}`;
}

function positiveLimit(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive whole number.`);
  return value;
}

export function normalizeModelConfig(input: ModelConfigInput): ModelConfig {
  const model = input.model.trim();
  if (!model) throw new Error('Enter a model identifier.');
  return {
    baseUrl: normalizeBaseUrl(input.baseUrl),
    model,
    structuredOutput: Boolean(input.structuredOutput),
    contextLimit: positiveLimit(input.contextLimit, 'Context limit'),
    outputLimit: positiveLimit(input.outputLimit, 'Output limit'),
  };
}

function isStoredConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<ModelConfig>;
  return typeof candidate.baseUrl === 'string'
    && typeof candidate.model === 'string'
    && typeof candidate.structuredOutput === 'boolean'
    && typeof candidate.contextLimit === 'number'
    && typeof candidate.outputLimit === 'number';
}

export async function loadModelConfig(): Promise<ModelConfig> {
  const storage = getLocalStorageArea();
  if (!storage) throw new Error('Extension local storage is unavailable.');
  const stored = (await storage.get(CONFIG_STORAGE_KEY))[CONFIG_STORAGE_KEY];
  if (!isStoredConfig(stored)) return DEFAULT_MODEL_CONFIG;
  try {
    return normalizeModelConfig(stored);
  } catch {
    return DEFAULT_MODEL_CONFIG;
  }
}

export async function saveModelConfig(input: ModelConfigInput): Promise<ModelConfig> {
  const storage = getLocalStorageArea();
  if (!storage) throw new Error('Extension local storage is unavailable.');
  const config = normalizeModelConfig(input);
  await storage.set({ [CONFIG_STORAGE_KEY]: config });
  return config;
}

export type SessionApiKey = {
  apiKey?: string;
  remembered: boolean;
};

export async function loadApiKey(): Promise<SessionApiKey> {
  const session = getSessionStorageArea();
  if (!session) throw new Error('Session storage is unavailable in this browser. API keys cannot be kept safely for this session.');
  const sessionValue = (await session.get(API_KEY_STORAGE_KEY))[API_KEY_STORAGE_KEY];
  if (typeof sessionValue === 'string' && sessionValue.length > 0) return { apiKey: sessionValue, remembered: false };

  const storage = getLocalStorageArea();
  if (!storage) throw new Error('Extension local storage is unavailable.');
  const value = (await storage.get(API_KEY_STORAGE_KEY))[API_KEY_STORAGE_KEY];
  return typeof value === 'string' && value.length > 0 ? { apiKey: value, remembered: true } : { remembered: false };
}

/** Saves the key either to browser-memory session storage or, only on request, local storage. */
export async function saveApiKey(apiKey: string, remember: boolean): Promise<void> {
  const storage = getLocalStorageArea();
  if (!storage) throw new Error('Extension local storage is unavailable.');
  const session = getSessionStorageArea();
  if (!session) throw new Error('Session storage is unavailable in this browser. API keys cannot be kept safely for this session.');
  const secret = apiKey.trim();
  if (remember && secret) {
    await storage.set({ [API_KEY_STORAGE_KEY]: secret });
    await session.remove(API_KEY_STORAGE_KEY);
    return;
  }
  if (!secret) {
    await session.remove(API_KEY_STORAGE_KEY);
    await storage.remove(API_KEY_STORAGE_KEY);
    return;
  }
  await session.set({ [API_KEY_STORAGE_KEY]: secret });
  await storage.remove(API_KEY_STORAGE_KEY);
}

export async function clearApiKey(): Promise<void> {
  const storage = getLocalStorageArea();
  if (!storage) throw new Error('Extension local storage is unavailable.');
  const session = getSessionStorageArea();
  if (!session) throw new Error('Session storage is unavailable in this browser. API keys cannot be cleared safely.');
  await session.remove(API_KEY_STORAGE_KEY);
  await storage.remove(API_KEY_STORAGE_KEY);
}
