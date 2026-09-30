import {
  ARXIV_AUTO_OPEN_STORAGE_KEY,
  isArxivDirectPdfUrl,
  readerUrlForArxivPdf,
} from '../src/lib/arxivPdfInterception';
import { handleToolbarClick } from '../src/lib/toolbarPdfAction';
import { registerActionMenu, type ActionMenuApi } from '../src/lib/actionMenu';

type NavigationDetails = { tabId: number; frameId: number; url: string };
type TabUpdateDetails = { url?: string };

type ExtensionApi = {
  storage?: { local?: { get: (key: string) => Promise<Record<string, unknown>>; set: (items: Record<string, unknown>) => Promise<void> } };
  permissions?: {
    contains: (permissions: { origins: string[] }) => Promise<boolean>;
    request: (permissions: { origins: string[] }) => Promise<boolean>;
    onRemoved?: { addListener: (callback: (permissions: { origins?: string[] }) => void) => void };
  };
  runtime?: { getURL: (path: string) => string; onInstalled?: ActionMenuApi['runtime']['onInstalled'] };
  menus?: ActionMenuApi['menus'];
  contextMenus?: ActionMenuApi['menus'];
  tabs?: {
    update: (tabId: number, updateProperties: { url: string }) => Promise<unknown>;
    create: (createProperties: { url: string }) => Promise<unknown>;
    onUpdated?: { addListener: (callback: (tabId: number, changeInfo: TabUpdateDetails) => void) => void };
  };
  action?: { onClicked?: { addListener: (callback: (tab: { url?: string }) => void) => void } };
  webNavigation?: {
    onBeforeNavigate?: { addListener: (callback: (details: NavigationDetails) => void, filter?: { url: Array<{ schemes: string[]; hostEquals: string; pathPrefix: string }> }) => void };
    onCommitted?: { addListener: (callback: (details: NavigationDetails) => void, filter?: { url: Array<{ schemes: string[]; hostEquals: string; pathPrefix: string }> }) => void };
  };
};

function extensionApi(): ExtensionApi | undefined {
  const globals = globalThis as typeof globalThis & { browser?: ExtensionApi; chrome?: ExtensionApi };
  return globals.browser ?? globals.chrome;
}

// `onBeforeNavigate` can be delivered more than once for one navigation. A
// short-lived per-tab key prevents a feedback loop without retaining browsing
// history. The extension URL itself does not match the route gate.
const recentNavigations = new Map<number, { url: string; expiresAt: number }>();
const DEDUPE_WINDOW_MS = 5_000;
const ARXIV_PDF_NAVIGATION_FILTER = { url: [{ schemes: ['https'], hostEquals: 'arxiv.org', pathPrefix: '/pdf/' }] };

async function mayOpenArxivPdf(details: NavigationDetails): Promise<void> {
  if (details.frameId !== 0 || details.tabId < 0 || !isArxivDirectPdfUrl(details.url)) return;

  const api = extensionApi();
  const storage = api?.storage?.local;
  const permissions = api?.permissions;
  const runtime = api?.runtime;
  const tabs = api?.tabs;
  if (!storage || !permissions || !runtime || !tabs) return;

  const previous = recentNavigations.get(details.tabId);
  const now = Date.now();
  if (previous?.url === details.url && previous.expiresAt > now) return;

  try {
    const settings = await storage.get(ARXIV_AUTO_OPEN_STORAGE_KEY);
    if (settings[ARXIV_AUTO_OPEN_STORAGE_KEY] !== true) return;

    // Permission is requested by the eventual settings toggle, which has a
    // user gesture. Never attempt a prompt from a navigation listener: if it
    // is absent, retain the ordinary arXiv navigation as the safe fallback.
    if (!await permissions.contains({ origins: ['https://arxiv.org/*'] })) return;

    recentNavigations.set(details.tabId, { url: details.url, expiresAt: now + DEDUPE_WINDOW_MS });
    await tabs.update(details.tabId, { url: readerUrlForArxivPdf(runtime.getURL('/'), details.url) });
  } catch {
    // Background failures must not cancel or replace a normal paper download.
  }
}

export default defineBackground(() => {
  const api = extensionApi();
  const menus = api?.menus ?? api?.contextMenus;
  if (menus && api?.runtime?.onInstalled && api.tabs) {
    registerActionMenu({ menus, runtime: { getURL: api.runtime.getURL, onInstalled: api.runtime.onInstalled }, tabs: api.tabs });
  }
  api?.action?.onClicked?.addListener((tab) => {
    handleToolbarClick(tab, api?.permissions && api.runtime && api.tabs
      ? { permissions: api.permissions, runtime: api.runtime, tabs: api.tabs }
      : undefined);
  });
  api?.webNavigation?.onBeforeNavigate?.addListener(
    (details) => { void mayOpenArxivPdf(details); },
    ARXIV_PDF_NAVIGATION_FILTER,
  );
  // Chromium's built-in PDF viewer can commit quickly enough that a service
  // worker started by onBeforeNavigate misses the update window. The committed
  // event and the tab URL notification are idempotent fallbacks; every path is
  // still gated by the exact direct-PDF predicate and explicit permission.
  api?.webNavigation?.onCommitted?.addListener(
    (details) => { void mayOpenArxivPdf(details); },
    ARXIV_PDF_NAVIGATION_FILTER,
  );
  api?.tabs?.onUpdated?.addListener((tabId, changeInfo) => {
    if (changeInfo.url) void mayOpenArxivPdf({ tabId, frameId: 0, url: changeInfo.url });
  });
  api?.permissions?.onRemoved?.addListener((removed) => {
    if (!removed.origins?.includes('https://arxiv.org/*')) return;
    // Never leave a stale enabled switch after the user revokes the optional
    // site permission in the browser's extension settings.
    void api.storage?.local?.set({ [ARXIV_AUTO_OPEN_STORAGE_KEY]: false });
  });
});
