import { ARXIV_AUTO_OPEN_STORAGE_KEY } from './arxivPdfInterception';

export const ARXIV_PERMISSION_ORIGIN = 'https://arxiv.org/*';

type ExtensionStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

type OptionalPermissionsApi = {
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

type ExtensionApi = {
  storage?: { local?: ExtensionStorageArea };
  permissions?: OptionalPermissionsApi;
};

export type ArxivAutoOpenPermissionResult =
  | { granted: true }
  | { granted: false; reason: 'unavailable' | 'denied' | 'request-failed' };

function extensionApi(): ExtensionApi | undefined {
  const globals = globalThis as typeof globalThis & { browser?: ExtensionApi; chrome?: ExtensionApi };
  return globals.browser ?? globals.chrome;
}

/** Must be called synchronously from a settings-page user gesture. */
export function requestArxivAutoOpenPermission(): Promise<ArxivAutoOpenPermissionResult> {
  const permissions = extensionApi()?.permissions;
  if (!permissions) return Promise.resolve({ granted: false, reason: 'unavailable' });
  try {
    return permissions.request({ origins: [ARXIV_PERMISSION_ORIGIN] }).then(
      (granted) => granted ? { granted: true } : { granted: false, reason: 'denied' },
      () => ({ granted: false, reason: 'request-failed' }),
    );
  } catch {
    return Promise.resolve({ granted: false, reason: 'request-failed' });
  }
}

export async function syncArxivAutoOpenEnabled(): Promise<boolean> {
  const api = extensionApi();
  const storage = api?.storage?.local;
  const permissions = api?.permissions;
  if (!storage || !permissions) return false;

  const enabled = (await storage.get(ARXIV_AUTO_OPEN_STORAGE_KEY))[ARXIV_AUTO_OPEN_STORAGE_KEY] === true;
  const granted = await permissions.contains({ origins: [ARXIV_PERMISSION_ORIGIN] });
  if (enabled && !granted) await storage.set({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: false });
  return enabled && granted;
}

export async function saveArxivAutoOpenEnabled(enabled: boolean): Promise<void> {
  const storage = extensionApi()?.storage?.local;
  if (!storage) throw new Error('storage-unavailable');
  await storage.set({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: enabled });
}
