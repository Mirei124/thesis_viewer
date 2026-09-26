export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

type ExtensionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export const THEME_STORAGE_KEY = 'theme-preference:v1';
const THEME_BOOTSTRAP_KEY = 'thesis-viewer:theme-preference:v1';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system';
}

export function resolveTheme(preference: ThemePreference, systemPrefersDark: boolean): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

function getExtensionStorage(): ExtensionStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: ExtensionStorageArea } };
    chrome?: { storage?: { local?: ExtensionStorageArea } };
  };
  return extensionGlobal.browser?.storage?.local ?? extensionGlobal.chrome?.storage?.local;
}

function systemPrefersDark(): boolean {
  return typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(prefers-color-scheme: dark)').matches;
}

function bootstrapPreference(): ThemePreference | undefined {
  try {
    const saved = globalThis.localStorage?.getItem(THEME_BOOTSTRAP_KEY);
    return isThemePreference(saved) ? saved : undefined;
  } catch {
    return undefined;
  }
}

function saveBootstrapPreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(THEME_BOOTSTRAP_KEY, preference);
  } catch {
    // The extension storage copy remains the durable source when localStorage
    // is unavailable. This mirror exists solely for synchronous first paint.
  }
}

/** Applies a resolved palette without changing reader or document state. */
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark());
  const root = globalThis.document?.documentElement;
  if (root) {
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
    root.style.colorScheme = resolved;
  }
  return resolved;
}

/**
 * Reads the synchronous mirror before React mounts. CSS has a system-colour
 * fallback, so a first visit and a saved explicit preference both avoid a
 * light-to-dark repaint while extension storage is loading.
 */
export function applyInitialTheme(): ThemePreference {
  const preference = bootstrapPreference() ?? 'system';
  applyTheme(preference);
  return preference;
}

export async function loadThemePreference(): Promise<ThemePreference | undefined> {
  const storage = getExtensionStorage();
  if (!storage) return undefined;
  const value = (await storage.get(THEME_STORAGE_KEY))[THEME_STORAGE_KEY];
  return isThemePreference(value) ? value : undefined;
}

export async function saveThemePreference(preference: ThemePreference): Promise<void> {
  saveBootstrapPreference(preference);
  const storage = getExtensionStorage();
  if (!storage) return;
  await storage.set({ [THEME_STORAGE_KEY]: preference });
}

/** Returns the sync bootstrap choice so React starts with the visible palette. */
export function initialThemePreference(): ThemePreference {
  return bootstrapPreference() ?? 'system';
}
