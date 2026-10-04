import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_OVERVIEW_PREFERENCES, OVERVIEW_PREFERENCES_KEY, loadOverviewPreferences, parseOverviewPreferences, saveOverviewPreferences } from './overviewPreferences';

afterEach(() => vi.unstubAllGlobals());

describe('automatic overview preferences', () => {
  it('defaults both options off and accepts only literal true independently', () => {
    for (const value of [undefined, null, false, 'true', {}, { threeLine: 'true', detailed: 1 }]) {
      expect(parseOverviewPreferences(value)).toEqual(DEFAULT_OVERVIEW_PREFERENCES);
    }
    expect(parseOverviewPreferences({ threeLine: true, detailed: false })).toEqual({ threeLine: true, detailed: false });
    expect(parseOverviewPreferences({ threeLine: false, detailed: true })).toEqual({ threeLine: false, detailed: true });
  });

  it('persists independent choices without changing model settings or caches, and reloads changes', async () => {
    const values: Record<string, unknown> = { 'model-config:v1': { model: 'custom' }, 'overview-cache': 'existing' };
    const set = vi.fn(async (items: Record<string, unknown>) => { Object.assign(values, items); });
    vi.stubGlobal('chrome', { storage: { local: { get: async (key: string) => ({ [key]: values[key] }), set } } });
    expect(await loadOverviewPreferences()).toEqual(DEFAULT_OVERVIEW_PREFERENCES);
    await saveOverviewPreferences({ threeLine: true, detailed: false });
    expect(await loadOverviewPreferences()).toEqual({ threeLine: true, detailed: false });
    await saveOverviewPreferences({ threeLine: false, detailed: true });
    expect(await loadOverviewPreferences()).toEqual({ threeLine: false, detailed: true });
    expect(set).toHaveBeenLastCalledWith({ [OVERVIEW_PREFERENCES_KEY]: { threeLine: false, detailed: true } });
    expect(values['model-config:v1']).toEqual({ model: 'custom' });
    expect(values['overview-cache']).toBe('existing');
  });

  it('supports browser storage and reports unavailable storage', async () => {
    await expect(loadOverviewPreferences()).rejects.toThrow('unavailable');
    vi.stubGlobal('browser', { storage: { local: { get: async () => ({ [OVERVIEW_PREFERENCES_KEY]: { detailed: true } }), set: async () => {} } } });
    expect(await loadOverviewPreferences()).toEqual({ threeLine: false, detailed: true });
  });
});
