import { en } from '../i18n/en';
import { zhCN } from '../i18n/zh-CN';

export const UI_LOCALE_STORAGE_KEY = 'ui-locale:v1';
export type UiLocale = 'en' | 'zh-CN';
export type MessageKey = keyof typeof en;

type ExtensionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

const messages: Record<UiLocale, Record<MessageKey, string>> = { en, 'zh-CN': zhCN };

export function isUiLocale(value: unknown): value is UiLocale {
  return value === 'en' || value === 'zh-CN';
}

export function browserUiLocale(languages: readonly string[] | undefined = globalThis.navigator?.languages): UiLocale {
  return languages?.some((language) => language.toLowerCase().startsWith('zh')) ? 'zh-CN' : 'en';
}

export function message(locale: UiLocale, key: MessageKey): string {
  return messages[locale][key];
}

function extensionStorage(): ExtensionStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: ExtensionStorageArea } };
    chrome?: { storage?: { local?: ExtensionStorageArea } };
  };
  return extensionGlobal.browser?.storage?.local ?? extensionGlobal.chrome?.storage?.local;
}

export async function loadUiLocale(): Promise<UiLocale | undefined> {
  const storage = extensionStorage();
  if (!storage) return undefined;
  const value = (await storage.get(UI_LOCALE_STORAGE_KEY))[UI_LOCALE_STORAGE_KEY];
  return isUiLocale(value) ? value : undefined;
}

export async function saveUiLocale(locale: UiLocale): Promise<void> {
  const storage = extensionStorage();
  if (storage) await storage.set({ [UI_LOCALE_STORAGE_KEY]: locale });
}
