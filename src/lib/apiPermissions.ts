import { normalizeBaseUrl } from './modelConfig';

type OptionalPermissionsApi = {
  contains?: (permissions: { origins: string[] }) => Promise<boolean>;
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

export type ApiPermissionResult =
  | { granted: true; origin: string }
  | { granted: false; origin: string; reason: 'unavailable' | 'denied' | 'request-failed' };

/**
 * The browser match-pattern language intentionally has no port component. The
 * actual provider request still uses the precise URL entered in settings.
 */
export function apiHostPermissionPattern(baseUrl: string): string {
  const url = new URL(normalizeBaseUrl(baseUrl));
  return `${url.protocol}//${url.hostname}/*`;
}

function optionalPermissionsApi(): OptionalPermissionsApi | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { permissions?: OptionalPermissionsApi };
    chrome?: { permissions?: OptionalPermissionsApi };
  };
  return extensionGlobal.browser?.permissions ?? extensionGlobal.chrome?.permissions;
}

/**
 * Call this directly from a trusted extension-page click handler. In
 * particular, do not put an await before this function: permissions.request
 * must be initiated while the user's gesture is still active.
 */
export function requestApiHostPermission(baseUrl: string): Promise<ApiPermissionResult> {
  const origin = apiHostPermissionPattern(baseUrl);
  const permissions = optionalPermissionsApi();
  if (!permissions) return Promise.resolve({ granted: false, origin, reason: 'unavailable' });

  let request: Promise<boolean>;
  try {
    request = permissions.request({ origins: [origin] });
  } catch {
    return Promise.resolve({ granted: false, origin, reason: 'request-failed' });
  }
  return request.then(
    granted => granted ? { granted: true, origin } : { granted: false, origin, reason: 'denied' },
    () => ({ granted: false, origin, reason: 'request-failed' }),
  );
}

/** Automatic tasks can only inspect an existing grant; never prompt without a gesture. */
export async function containsApiHostPermission(baseUrl: string): Promise<ApiPermissionResult> {
  const origin = apiHostPermissionPattern(baseUrl);
  const permissions = optionalPermissionsApi();
  if (!permissions?.contains) return { granted: false, origin, reason: 'unavailable' };
  try {
    return await permissions.contains({ origins: [origin] })
      ? { granted: true, origin } : { granted: false, origin, reason: 'denied' };
  } catch {
    return { granted: false, origin, reason: 'request-failed' };
  }
}
