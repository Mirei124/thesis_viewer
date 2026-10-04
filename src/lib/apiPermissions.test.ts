import { afterEach, describe, expect, it, vi } from 'vitest';
import { containsApiHostPermission, requestApiHostPermission } from './apiPermissions';

afterEach(() => vi.unstubAllGlobals());

describe('API host permissions for automatic overviews', () => {
  it('checks the exact host match pattern without requesting new access', async () => {
    const contains = vi.fn(async () => true);
    const request = vi.fn(async () => true);
    vi.stubGlobal('chrome', { permissions: { contains, request } });
    expect(await containsApiHostPermission('https://api.example.test:8443/v1')).toEqual({ granted: true, origin: 'https://api.example.test/*' });
    expect(contains).toHaveBeenCalledWith({ origins: ['https://api.example.test/*'] });
    expect(request).not.toHaveBeenCalled();
  });

  it('initiates a user permission request synchronously before returning a promise', async () => {
    const request = vi.fn(async () => true);
    vi.stubGlobal('browser', { permissions: { request } });
    const pending = requestApiHostPermission('http://localhost:1234/api');
    expect(request).toHaveBeenCalledWith({ origins: ['http://localhost/*'] });
    expect(await pending).toEqual({ granted: true, origin: 'http://localhost/*' });
  });

  it('reports revoked access, missing APIs and API errors without a request', async () => {
    expect(await containsApiHostPermission('https://api.example.test')).toMatchObject({ granted: false, reason: 'unavailable' });
    const request = vi.fn();
    const contains = vi.fn(async () => false);
    vi.stubGlobal('chrome', { permissions: { contains, request } });
    expect(await containsApiHostPermission('https://api.example.test')).toMatchObject({ granted: false, reason: 'denied' });
    contains.mockRejectedValueOnce(new Error('permission failed'));
    expect(await containsApiHostPermission('https://api.example.test')).toMatchObject({ granted: false, reason: 'request-failed' });
    expect(request).not.toHaveBeenCalled();
  });
});
