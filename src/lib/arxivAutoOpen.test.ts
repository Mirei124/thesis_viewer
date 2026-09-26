import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ARXIV_PERMISSION_ORIGIN,
  requestArxivAutoOpenPermission,
  saveArxivAutoOpenEnabled,
  syncArxivAutoOpenEnabled,
} from './arxivAutoOpen';
import { ARXIV_AUTO_OPEN_STORAGE_KEY } from './arxivPdfInterception';

afterEach(() => vi.unstubAllGlobals());

describe('arXiv auto-open preference', () => {
  it('clears a stored enabled switch when the optional arXiv permission is gone', async () => {
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: true })), set } },
      permissions: { contains: vi.fn(async () => false), request: vi.fn(async () => false) },
    });

    await expect(syncArxivAutoOpenEnabled()).resolves.toBe(false);
    expect(set).toHaveBeenCalledWith({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: false });
  });

  it('requests only arXiv from a user gesture and saves only after it is granted', async () => {
    const request = vi.fn(async () => true);
    const set = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      storage: { local: { get: vi.fn(async () => ({})), set } },
      permissions: { contains: vi.fn(async () => false), request },
    });

    await expect(requestArxivAutoOpenPermission()).resolves.toEqual({ granted: true });
    expect(request).toHaveBeenCalledWith({ origins: [ARXIV_PERMISSION_ORIGIN] });
    expect(set).not.toHaveBeenCalled();
    await saveArxivAutoOpenEnabled(true);
    expect(set).toHaveBeenCalledWith({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: true });
  });
});
