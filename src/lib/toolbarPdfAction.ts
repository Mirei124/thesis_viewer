import { isArxivDirectPdfUrl } from './arxivPdfInterception';
import { formatReaderSourceFragment } from './readerSourceFragment';
import { permissionPattern } from './urlPdfImport';

export type ToolbarStatus = 'not-pdf' | 'unavailable' | 'permission-denied' | 'open-failed';

type ClickedTab = { url?: string };
type ToolbarApi = {
  runtime: { getURL: (path: string) => string };
  permissions: { request: (permissions: { origins: string[] }) => Promise<boolean> };
  tabs: { create: (properties: { url: string }) => Promise<unknown> };
};

/** The address bar is only a URL gate; the reader verifies the PDF bytes. */
export function toolbarPdfUrl(value: string | undefined): URL | null {
  if (!value) return null;
  let url: URL;
  try { url = new URL(value); }
  catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  if (/\.pdf$/i.test(url.pathname) || isArxivDirectPdfUrl(url.href)) return url;
  return null;
}

function statusUrl(api: ToolbarApi, status: ToolbarStatus): string {
  return `${api.runtime.getURL('/action-status.html')}#${status}`;
}

async function showStatus(api: ToolbarApi, status: ToolbarStatus): Promise<void> {
  try { await api.tabs.create({ url: statusUrl(api, status) }); }
  catch { /* The browser may be closing; no further tab operation is possible. */ }
}

/** Call directly from action.onClicked so the permission request retains the click gesture. */
export function handleToolbarClick(tab: ClickedTab, api: ToolbarApi | undefined): void {
  if (!api) return;
  const pdfUrl = toolbarPdfUrl(tab.url);
  if (!pdfUrl) {
    void showStatus(api, tab.url ? 'not-pdf' : 'unavailable');
    return;
  }

  // Even a contains() await would lose the user gesture on some browsers.
  let request: Promise<boolean>;
  try { request = api.permissions.request({ origins: [permissionPattern(pdfUrl)] }); }
  catch { void showStatus(api, 'permission-denied'); return; }

  void (async () => {
    let granted: boolean;
    try { granted = await request; }
    catch { await showStatus(api, 'permission-denied'); return; }
    if (!granted) { await showStatus(api, 'permission-denied'); return; }

    try {
      const readerUrl = `${api.runtime.getURL('/reader.html')}${formatReaderSourceFragment(pdfUrl)}`;
      await api.tabs.create({ url: readerUrl });
    } catch {
      await showStatus(api, 'open-failed');
    }
  })();
}
