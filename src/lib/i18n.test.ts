import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  browserUiLocale,
  isUiLocale,
  loadUiLocale,
  message,
  saveUiLocale,
  UI_LOCALE_STORAGE_KEY,
} from './i18n';
import { en } from '../i18n/en';
import { zhCN } from '../i18n/zh-CN';

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

  it('keeps reader keys and interpolation placeholders aligned across languages', () => {
    expect(Object.keys(zhCN).sort()).toEqual(Object.keys(en).sort());
    for (const [key, english] of Object.entries(en)) {
      if (!key.startsWith('reader.')) continue;
      const chinese = zhCN[key as keyof typeof zhCN];
      expect(chinese.trim(), key).not.toBe('');
      const placeholders = (value: string) => [...new Set([...value.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g)].map((match) => match[1]))].sort();
      expect(placeholders(chinese), key).toEqual(placeholders(english));
    }
    expect(message('zh-CN', 'reader.page.count', { count: 12 })).toBe('共 12 页');
    expect(message('en', 'reader.page.count', { count: 12 })).toBe('12 pages');
  });
});
