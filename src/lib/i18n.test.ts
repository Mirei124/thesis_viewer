import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browserUiLocale,
  isUiLocale,
  loadUiLocale,
  saveUiLocale,
  UI_LOCALE_STORAGE_KEY,
} from './i18n';

afterEach(() => vi.unstubAllGlobals());

describe('UI locale preferences', () => {
  it('uses Chinese only for a Chinese browser language and validates stored choices', () => {
    expect(browserUiLocale(['zh-CN', 'en-US'])).toBe('zh-CN');
    expect(browserUiLocale(['en-US'])).toBe('en');
    expect(isUiLocale('zh-CN')).toBe(true);
    expect(isUiLocale('fr')).toBe(false);
  });

  it('loads and saves only the explicit UI locale preference', async () => {
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: vi.fn(async () => ({ [UI_LOCALE_STORAGE_KEY]: 'zh-CN' })),
          set,
        },
      },
    });

    await expect(loadUiLocale()).resolves.toBe('zh-CN');
    await saveUiLocale('en');
    expect(set).toHaveBeenCalledWith({ [UI_LOCALE_STORAGE_KEY]: 'en' });
  });
});
