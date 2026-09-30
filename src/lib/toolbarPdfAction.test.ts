import { describe, expect, it, vi } from 'vitest';
import { handleToolbarClick, toolbarPdfUrl } from './toolbarPdfAction';

function api(request = vi.fn(async (_permissions: { origins: string[] }) => true), create = vi.fn(async (_properties: { url: string }) => undefined)) {
  return {
    runtime: { getURL: (path: string) => `moz-extension://test${path}` },
    permissions: { request },
    tabs: { create },
  };
}

describe('toolbar PDF URL gate', () => {
  it('accepts HTTPS PDF paths and the direct arXiv route', () => {
    expect(toolbarPdfUrl('https://example.org/paper.PDF?download=1')?.href).toBe('https://example.org/paper.PDF?download=1');
    expect(toolbarPdfUrl('https://arxiv.org/pdf/2501.01234')?.href).toBe('https://arxiv.org/pdf/2501.01234');
  });

  it.each([
    undefined, 'about:blank', 'file:///paper.pdf', 'blob:https://example.org/paper.pdf',
    'http://example.org/paper.pdf', 'https://user:pass@example.org/paper.pdf',
    'https://example.org/paper.pdf/view', 'https://arxiv.org/abs/2501.01234',
    'https://arxiv.org/html/2501.01234', 'https://example.org/paper',
  ])('rejects unsupported address %s', (value) => {
    expect(toolbarPdfUrl(value)).toBeNull();
  });
});

describe('toolbar click', () => {
  it('requests only the clicked HTTPS host synchronously, then opens the reader fragment', async () => {
    const browser = api();
    handleToolbarClick({ url: 'https://papers.example.org/a.pdf?x=1' }, browser);
    expect(browser.permissions.request).toHaveBeenCalledWith({ origins: ['https://papers.example.org/*'] });
    expect(browser.tabs.create).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(browser.tabs.create).toHaveBeenCalledOnce());
    const opened = new URL(browser.tabs.create.mock.calls[0]![0].url);
    expect(opened.pathname).toBe('/reader.html');
    expect(opened.hash).toBe('#pdf=https%3A%2F%2Fpapers.example.org%2Fa.pdf%3Fx%3D1');
  });

  it('shows a visible page for non-PDF and unknown addresses without asking permission', async () => {
    const browser = api();
    handleToolbarClick({ url: 'https://arxiv.org/abs/2501.01234' }, browser);
    handleToolbarClick({}, browser);
    await vi.waitFor(() => expect(browser.tabs.create).toHaveBeenCalledTimes(2));
    expect(browser.tabs.create.mock.calls.map(([properties]) => properties.url)).toEqual([
      'moz-extension://test/action-status.html#not-pdf',
      'moz-extension://test/action-status.html#unavailable',
    ]);
    expect(browser.permissions.request).not.toHaveBeenCalled();
  });

  it('shows permission denial and does not open the PDF', async () => {
    const browser = api(vi.fn(async () => false));
    handleToolbarClick({ url: 'https://example.org/a.pdf' }, browser);
    await vi.waitFor(() => expect(browser.tabs.create).toHaveBeenCalledOnce());
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'moz-extension://test/action-status.html#permission-denied' });
  });

  it('shows a failure when the permission API rejects', async () => {
    const browser = api(vi.fn(async () => { throw new Error('permission unavailable'); }));
    handleToolbarClick({ url: 'https://example.org/a.pdf' }, browser);
    await vi.waitFor(() => expect(browser.tabs.create).toHaveBeenCalledOnce());
    expect(browser.tabs.create).toHaveBeenCalledWith({ url: 'moz-extension://test/action-status.html#permission-denied' });
  });
});
