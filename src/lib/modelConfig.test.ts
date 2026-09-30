import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_MODEL_CONFIG, loadModelConfig, saveModelConfig } from './modelConfig';

afterEach(() => {
  delete (globalThis as { chrome?: unknown }).chrome;
  delete (globalThis as { browser?: unknown }).browser;
});

describe('model configuration defaults and migration', () => {
  it('uses the requested DeepSeek defaults only when no configuration is saved', async () => {
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: {
      get: async () => ({}), set: async () => {}, remove: async () => {},
    } } };
    expect(await loadModelConfig()).toEqual({
      baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-flash',
      structuredOutput: true, contextLimit: 32_000, outputLimit: 32_000,
    });
    expect(DEFAULT_MODEL_CONFIG).not.toHaveProperty('streaming');
  });

  it('keeps an existing custom configuration while dropping the obsolete streaming field', async () => {
    const values: Record<string, unknown> = {
      'model-config:v1': {
        baseUrl: 'https://example.test/api/', model: 'custom-model', streaming: true,
        structuredOutput: false, contextLimit: 16_000, outputLimit: 4_000,
      },
    };
    (globalThis as { chrome?: unknown }).chrome = { storage: { local: {
      get: async (key: string) => ({ [key]: values[key] }),
      set: async (items: Record<string, unknown>) => { Object.assign(values, items); },
      remove: async (key: string) => { delete values[key]; },
    } } };
    const loaded = await loadModelConfig();
    expect(loaded).toEqual({
      baseUrl: 'https://example.test/api', model: 'custom-model',
      structuredOutput: false, contextLimit: 16_000, outputLimit: 4_000,
    });
    expect(await saveModelConfig(loaded)).toEqual(loaded);
    expect(values['model-config:v1']).toEqual(loaded);
  });
});
