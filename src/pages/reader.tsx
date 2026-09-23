import { createRoot } from 'react-dom/client';
import { type ChangeEvent, type FormEvent, useEffect, useRef, useState } from 'react';
import {
  GlobalWorkerOptions,
  getDocument,
  InvalidPDFException,
  PasswordException,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
} from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import '../styles.css';
import 'pdfjs-dist/web/pdf_viewer.css';
import {
  locateNormalizedRange,
  normalizePdfTextItem,
  pageBlocksFromTextContent,
  PDF_PAGE_BLOCK_EXTRACTION_VERSION,
  type PageExtraction,
  type PdfPageTextBlock,
} from '../lib/pdfPageBlocks';
import {
  pdfSectionCandidatesFromPages,
  type PdfSectionCandidate,
} from '../lib/pdfSectionCandidates';
import {
  pdfLocalCitationIndexFromPages,
  type PdfLocalCitationIndex,
} from '../lib/pdfCitationIndex';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ReaderState =
  | { kind: 'idle' }
  | { kind: 'requesting-permission'; fileName: string }
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready'; fileName: string; pageCount: number; pageIndex: number; scale: number; rotation: number }
  | { kind: 'cancelled'; message: string }
  | { kind: 'error'; message: string };

type OptionalPermissionsApi = {
  request: (permissions: { origins: string[] }) => Promise<boolean>;
};

type LocalStorageArea = {
  get: (key: string) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

type SavedView = {
  pageIndex: number;
  scale: number;
  rotation: number;
};

function readerError(error: unknown): string {
  if (error instanceof PasswordException || (error instanceof Error && error.name === 'PasswordException')) {
    return 'This PDF is password protected. Password entry and decryption are unavailable; choose an unlocked copy to read it here.';
  }
  if (error instanceof InvalidPDFException || (error instanceof Error && error.name === 'InvalidPDFException')) {
    return 'This file appears to be damaged or is not a readable PDF.';
  }
  if (error instanceof Error) {
    return `PDF.js could not load this file: ${error.message}`;
  }
  return 'PDF.js could not load this file.';
}

function isPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html') || prefix.startsWith('<html') || prefix.startsWith('<head') || prefix.startsWith('<body');
}

function permissionPattern(url: URL): string {
  // WebExtension host permissions are scoped to a scheme and host. Ports are
  // not expressible in a match pattern, so the browser applies this to HTTPS on
  // the submitted host; the request itself still uses the exact submitted URL.
  return `${url.protocol}//${url.hostname}/*`;
}

function getOptionalPermissionsApi(): OptionalPermissionsApi | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { permissions?: OptionalPermissionsApi };
    chrome?: { permissions?: OptionalPermissionsApi };
  };
  return extensionGlobal.browser?.permissions ?? extensionGlobal.chrome?.permissions;
}

function getLocalStorageArea(): LocalStorageArea | undefined {
  const extensionGlobal = globalThis as typeof globalThis & {
    browser?: { storage?: { local?: LocalStorageArea } };
    chrome?: { storage?: { local?: LocalStorageArea } };
  };
  return extensionGlobal.browser?.storage?.local ?? extensionGlobal.chrome?.storage?.local;
}

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;
const SCALE_STEP = 0.25;
const THUMBNAIL_MAX_WIDTH = 144;
const THUMBNAIL_MAX_HEIGHT = 200;
const THUMBNAIL_SCALE = 0.24;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const VIEW_STORAGE_PREFIX = 'pdf-view:';
const VIEW_SAVE_DEBOUNCE_MS = 500;

type ViewState = Pick<Extract<ReaderState, { kind: 'ready' }>, 'pageIndex' | 'scale' | 'rotation'>;
type PdfOutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];
type OutlineState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: PdfOutlineItem[] }
  | { kind: 'unavailable'; message: string };
type AutoSectionState =
  | { kind: 'idle' }
  | { kind: 'identifying' }
  | { kind: 'ready'; candidates: PdfSectionCandidate[] }
  | { kind: 'error'; message: string };
type CitationIndexState =
  | { kind: 'idle' }
  | { kind: 'indexing' }
  | { kind: 'ready'; index: PdfLocalCitationIndex }
  | { kind: 'error'; message: string };
type Thumbnail = { kind: 'loading' } | { kind: 'ready'; src: string } | { kind: 'error' };
type SearchIndexState =
  | { kind: 'idle' }
  | { kind: 'indexing'; indexedPageCount: number; pageCount: number; failedPageCount: number; revision: number }
  | { kind: 'ready'; indexedPageCount: number; pageCount: number; failedPageCount: number; revision: number }
  | { kind: 'unavailable'; message: string }
  | { kind: 'error'; message: string };
type SearchMatch = {
  pageIndex: number;
  blockId?: string;
  normalizedStart?: number;
  normalizedEnd?: number;
  rawStart?: number;
  rawEnd?: number;
  precision: 'exact' | 'block' | 'page';
};
type ExtractionCoverage = 'full' | 'partial' | 'unreadable';
type ExtractionState =
  | { kind: 'idle' }
  | { kind: 'extracting'; extractedPageCount: number; pageCount: number; textPageCount: number; emptyPageCount: number; failedPageCount: number }
  | { kind: 'ready'; coverage: ExtractionCoverage; extractedPageCount: number; pageCount: number; textPageCount: number; emptyPageCount: number; failedPageCount: number; blockCount: number; pages: PageExtraction[] }
  | { kind: 'error'; message: string };

function searchTextOccurrences(page: PageExtraction, query: string): SearchMatch[] {
  const normalizedQuery = normalizePdfTextItem(query).normalizedText.toLocaleLowerCase();
  if (!normalizedQuery) return [];
  const matches: SearchMatch[] = [];
  for (const block of page.blocks) {
    const foldedText = block.normalizedText.toLocaleLowerCase();
    const caseFoldChangedOffsets = foldedText.length !== block.normalizedText.length;
    let offset = foldedText.indexOf(normalizedQuery);
    while (offset !== -1) {
      const normalizedEnd = offset + normalizedQuery.length;
      const location = caseFoldChangedOffsets
        ? { precision: 'page' as const }
        : locateNormalizedRange(block, offset, normalizedEnd);
      matches.push({
        pageIndex: page.pageIndex,
        blockId: location.precision === 'page' ? undefined : block.blockId,
        normalizedStart: location.precision === 'page' ? undefined : offset,
        normalizedEnd: location.precision === 'page' ? undefined : normalizedEnd,
        rawStart: location.precision === 'exact' ? location.rawStart : undefined,
        rawEnd: location.precision === 'exact' ? location.rawEnd : undefined,
        precision: location.precision,
      });
      offset = foldedText.indexOf(normalizedQuery, offset + normalizedQuery.length);
    }
  }
  return matches;
}

function byteLimitMessage(size?: number): string {
  const received = size === undefined ? '' : ` (${Math.ceil(size / (1024 * 1024))} MiB received)`;
  return `This PDF exceeds the 100 MiB reader limit${received}. Choose a PDF at or below 100 MiB; large-document analysis is unavailable in this reader.`;
}

async function contentHash(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, '0')).join('');
}

function savedView(value: unknown, pageCount: number): SavedView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SavedView>;
  const { pageIndex, scale, rotation } = candidate;
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return undefined;
  if (typeof scale !== 'number' || !Number.isFinite(scale) || scale < MIN_SCALE || scale > MAX_SCALE) return undefined;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) return undefined;
  return { pageIndex, scale, rotation };
}

async function readPdfResponse(response: Response, requestId: number, isCurrent: (requestId: number) => boolean): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PDF_BYTES) {
    throw new Error(byteLimitMessage(declaredLength));
  }

  if (!response.body) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_PDF_BYTES) throw new Error(byteLimitMessage(bytes.byteLength));
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!isCurrent(requestId)) {
        await reader.cancel();
        throw new DOMException('A newer import replaced this download.', 'AbortError');
      }
      size += value.byteLength;
      if (size > MAX_PDF_BYTES) {
        await reader.cancel();
        throw new Error(byteLimitMessage(size));
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function OutlineItems({ items, depth, onNavigate }: {
  items: PdfOutlineItem[];
  depth: number;
  onNavigate: (item: PdfOutlineItem) => void;
}) {
  return (
    <ul className="outline-list">
      {items.map((item, index) => (
        <li key={`${depth}-${index}-${item.title}`}>
          <button
            type="button"
            className="outline-item"
            style={{ paddingInlineStart: `${0.5 + depth}rem` }}
            onClick={() => onNavigate(item)}
            disabled={!item.dest}
            title={item.dest ? `Go to ${item.title}` : 'This outline entry has no PDF destination.'}
          >
            {item.title || 'Untitled outline entry'}
          </button>
          {item.items.length > 0 && <OutlineItems items={item.items} depth={depth + 1} onNavigate={onNavigate} />}
        </li>
      ))}
    </ul>
  );
}

function ReaderPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);
  const renderIdRef = useRef(0);
  const thumbnailRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const extractionRequestIdRef = useRef(0);
  const viewSessionRef = useRef(0);
  const viewInteractionRevisionRef = useRef(0);
  const viewRestoreReadyRef = useRef(false);
  const viewSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchPagesRef = useRef<PageExtraction[]>([]);
  const pageBlocksRef = useRef<PdfPageTextBlock[]>([]);
  const indexedSearchQueryRef = useRef('');
  const [state, setState] = useState<ReaderState>({ kind: 'idle' });
  const [urlValue, setUrlValue] = useState('');
  const [pageInput, setPageInput] = useState('1');
  const [isRendering, setIsRendering] = useState(false);
  const [outline, setOutline] = useState<OutlineState>({ kind: 'idle' });
  const [outlineNotice, setOutlineNotice] = useState('');
  const [autoSections, setAutoSections] = useState<AutoSectionState>({ kind: 'idle' });
  const [citationIndex, setCitationIndex] = useState<CitationIndexState>({ kind: 'idle' });
  const [thumbnails, setThumbnails] = useState<Record<number, Thumbnail>>({});
  const [thumbnailSession, setThumbnailSession] = useState(0);
  const [searchIndex, setSearchIndex] = useState<SearchIndexState>({ kind: 'idle' });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatches, setSearchMatches] = useState<SearchMatch[]>([]);
  const [activeSearchMatch, setActiveSearchMatch] = useState(-1);
  const [extraction, setExtraction] = useState<ExtractionState>({ kind: 'idle' });
  const [documentContentKey, setDocumentContentKey] = useState<string | null>(null);
  const [viewStorageStatus, setViewStorageStatus] = useState('');
  const [viewRestoreEpoch, setViewRestoreEpoch] = useState(0);

  useEffect(() => () => {
    abortControllerRef.current?.abort();
    renderTaskRef.current?.cancel();
    textLayerTaskRef.current?.cancel();
    thumbnailRequestIdRef.current += 1;
    searchRequestIdRef.current += 1;
    extractionRequestIdRef.current += 1;
    if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    void loadingTaskRef.current?.destroy();
    void documentRef.current?.cleanup();
  }, []);

  useEffect(() => {
    if (state.kind !== 'ready' || !documentContentKey || !viewRestoreReadyRef.current) return;
    const storage = getLocalStorageArea();
    if (!storage) {
      setViewStorageStatus('View position cannot be saved because extension local storage is unavailable. Reading continues normally.');
      return;
    }
    if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    const savedSession = viewSessionRef.current;
    const view: SavedView = { pageIndex: state.pageIndex, scale: state.scale, rotation: state.rotation };
    viewSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await storage.set({ [`${VIEW_STORAGE_PREFIX}${documentContentKey}`]: view });
          if (savedSession === viewSessionRef.current) setViewStorageStatus('View position saved locally for this PDF.');
        } catch {
          if (savedSession === viewSessionRef.current) {
            setViewStorageStatus('View position could not be saved locally. Reading continues normally.');
          }
        }
      })();
    }, VIEW_SAVE_DEBOUNCE_MS);
    return () => {
      if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    };
  }, [documentContentKey, state, viewRestoreEpoch]);

  async function clearPreviousDocument() {
    renderIdRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    await Promise.allSettled([
      loadingTaskRef.current?.destroy(),
      documentRef.current?.cleanup(),
    ]);
    loadingTaskRef.current = null;
    documentRef.current = null;
    const canvas = canvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
    textLayerRef.current?.replaceChildren();
  }

  function isCurrent(requestId: number) {
    return requestId === requestIdRef.current;
  }

  function beginImport() {
    requestIdRef.current += 1;
    renderIdRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    thumbnailRequestIdRef.current += 1;
    searchRequestIdRef.current += 1;
    extractionRequestIdRef.current += 1;
    viewSessionRef.current += 1;
    viewInteractionRevisionRef.current = 0;
    viewRestoreReadyRef.current = false;
    if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    setDocumentContentKey(null);
    setViewStorageStatus('');
    searchPagesRef.current = [];
    pageBlocksRef.current = [];
    setThumbnails({});
    setOutline({ kind: 'idle' });
    setOutlineNotice('');
    setAutoSections({ kind: 'idle' });
    setCitationIndex({ kind: 'idle' });
    setSearchIndex({ kind: 'idle' });
    setExtraction({ kind: 'idle' });
    setSearchQuery('');
    setSearchMatches([]);
    setActiveSearchMatch(-1);
    indexedSearchQueryRef.current = '';
    const requestId = requestIdRef.current;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    return requestId;
  }

  async function prepareImport(fileName: string, requestId: number, controller: AbortController | null = null) {
    if (!isCurrent(requestId)) return false;
    abortControllerRef.current = controller;
    await clearPreviousDocument();
    if (!isCurrent(requestId)) return false;
    setState({ kind: 'loading', fileName });
    return true;
  }

  function isCurrentRender(requestId: number, renderId: number) {
    return isCurrent(requestId) && renderId === renderIdRef.current;
  }

  async function loadOutline(pdf: PDFDocumentProxy, requestId: number) {
    setOutline({ kind: 'loading' });
    try {
      const items = await pdf.getOutline();
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      setOutline(items && items.length > 0
        ? { kind: 'ready', items }
        : { kind: 'unavailable', message: 'This PDF does not provide an outline.' });
    } catch {
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      setOutline({ kind: 'unavailable', message: 'The PDF outline could not be read.' });
    }
  }

  async function extractPageBlocks(pdf: PDFDocumentProxy, requestId: number, documentVersion: string) {
    const extractionRequestId = ++extractionRequestIdRef.current;
    const searchRequestId = ++searchRequestIdRef.current;
    const pageTexts = Array<PageExtraction>(pdf.numPages);
    const pages = Array<PageExtraction>(pdf.numPages);
    searchPagesRef.current = pageTexts;
    pageBlocksRef.current = [];
    let indexedPageCount = 0;
    let failedPageCount = 0;
    let textPageCount = 0;
    let emptyPageCount = 0;

    setSearchIndex({ kind: 'indexing', indexedPageCount, pageCount: pdf.numPages, failedPageCount, revision: 0 });
    setExtraction({ kind: 'extracting', extractedPageCount: indexedPageCount, pageCount: pdf.numPages, textPageCount, emptyPageCount, failedPageCount });
    setAutoSections({ kind: 'identifying' });
    setCitationIndex({ kind: 'indexing' });

    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      if (extractionRequestId !== extractionRequestIdRef.current || searchRequestId !== searchRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (extractionRequestId !== extractionRequestIdRef.current || searchRequestId !== searchRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const textContent = await page.getTextContent();
        if (extractionRequestId !== extractionRequestIdRef.current || searchRequestId !== searchRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const pageExtraction = pageBlocksFromTextContent(textContent, pageIndex, documentVersion);
        pages[pageIndex] = pageExtraction;
        pageTexts[pageIndex] = pageExtraction;
        pageBlocksRef.current.push(...pageExtraction.blocks);
        if (pageExtraction.status === 'text') textPageCount += 1;
        else emptyPageCount += 1;
      } catch (error) {
        failedPageCount += 1;
        pages[pageIndex] = {
          pageIndex,
          blocks: [],
          searchableText: '',
          textItemCount: 0,
          status: 'failed',
          error: error instanceof Error ? error.message : 'PDF.js could not extract this page.',
        };
        pageTexts[pageIndex] = pages[pageIndex];
      }

      indexedPageCount += 1;
      if (extractionRequestId !== extractionRequestIdRef.current || searchRequestId !== searchRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
      const complete = indexedPageCount === pdf.numPages;
      if (complete && textPageCount === 0) {
        setSearchIndex({
          kind: 'unavailable',
          message: failedPageCount > 0
            ? 'No searchable text could be extracted from this PDF. You can keep reading rendered pages, but full-document search is unavailable.'
            : 'This PDF has no selectable text, likely because it is a scan. You can keep reading rendered pages, but full-document search is unavailable.',
        });
      } else {
        setSearchIndex({
          kind: complete ? 'ready' : 'indexing',
          indexedPageCount,
          pageCount: pdf.numPages,
          failedPageCount,
          revision: indexedPageCount,
        });
      }
      if (complete) {
        const coverage: ExtractionCoverage = textPageCount === pdf.numPages
          ? 'full'
          : textPageCount > 0
            ? 'partial'
            : 'unreadable';
        setExtraction({
          kind: 'ready',
          coverage,
          extractedPageCount: indexedPageCount,
          pageCount: pdf.numPages,
          textPageCount,
          emptyPageCount,
          failedPageCount,
          blockCount: pageBlocksRef.current.length,
          pages,
        });
        try {
          const candidates = pdfSectionCandidatesFromPages(pages, documentVersion);
          if (extractionRequestId !== extractionRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
          setAutoSections({ kind: 'ready', candidates });
        } catch {
          if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
            setAutoSections({ kind: 'error', message: 'Automatic section candidates could not be inspected. Page navigation remains available.' });
          }
        }
        try {
          const index = pdfLocalCitationIndexFromPages(pages, documentVersion);
          if (extractionRequestId !== extractionRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
          setCitationIndex({ kind: 'ready', index });
        } catch {
          if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
            setCitationIndex({ kind: 'error', message: 'Local References and numbered citation candidates could not be indexed. Reading and search remain available.' });
          }
        }
      } else {
        setExtraction({ kind: 'extracting', extractedPageCount: indexedPageCount, pageCount: pdf.numPages, textPageCount, emptyPageCount, failedPageCount });
      }
      // Let browser input, page navigation, and rendering work between pages.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  useEffect(() => {
    const query = searchQuery.trim();
    if (!query || searchIndex.kind === 'idle' || searchIndex.kind === 'unavailable' || searchIndex.kind === 'error') {
      setSearchMatches([]);
      setActiveSearchMatch(-1);
      indexedSearchQueryRef.current = '';
      return;
    }

    const matches = searchPagesRef.current.flatMap((page) => page ? searchTextOccurrences(page, query) : []);
    setSearchMatches(matches);
    const queryChanged = indexedSearchQueryRef.current !== query;
    indexedSearchQueryRef.current = query;
    setActiveSearchMatch((previous) => {
      if (queryChanged) return -1;
      const active = previous >= 0 ? searchMatches[previous] : undefined;
      if (active) {
        const sameMatch = matches.findIndex((match) => match.pageIndex === active.pageIndex && match.blockId === active.blockId && match.normalizedStart === active.normalizedStart);
        if (sameMatch !== -1) return sameMatch;
      }
      return -1;
    });
  }, [searchQuery, searchIndex.kind, searchIndex.kind === 'indexing' || searchIndex.kind === 'ready' ? searchIndex.revision : 0]);

  async function navigateOutline(item: PdfOutlineItem) {
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    if (!pdf || !item.dest || state.kind !== 'ready') return;
    setOutlineNotice('Resolving outline destination…');
    try {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!destination?.[0] || typeof destination[0] !== 'object') {
        setOutlineNotice(`“${item.title || 'This outline entry'}” has no page destination that this PDF can resolve.`);
        return;
      }
      const pageIndex = await pdf.getPageIndex(destination[0]);
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) {
        setOutlineNotice(`“${item.title || 'This outline entry'}” resolved to an invalid PDF page.`);
        return;
      }
      setOutlineNotice('');
      goToPage(pageIndex);
    } catch {
      if (isCurrent(requestId) && documentRef.current === pdf) {
        setOutlineNotice(`Could not resolve the destination for “${item.title || 'this outline entry'}”.`);
      }
    }
  }

  function navigateAutoSection(candidate: PdfSectionCandidate) {
    if (state.kind !== 'ready') return;
    setOutlineNotice(`Automatic candidate: “${candidate.title}” on page ${candidate.pageIndex + 1}.`);
    goToPage(candidate.pageIndex);
  }

  useEffect(() => {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    const thumbnailRequestId = ++thumbnailRequestIdRef.current;
    const indices = [state.pageIndex - 1, state.pageIndex, state.pageIndex + 1]
      .filter((pageIndex) => pageIndex >= 0 && pageIndex < state.pageCount);
    let cancelled = false;
    const renderTasks = new Set<{ cancel: () => void }>();

    setThumbnails((previous) => Object.fromEntries(indices.map((pageIndex) => [
      pageIndex,
      previous[pageIndex] ?? { kind: 'loading' },
    ])));

    async function renderThumbnail(pageIndex: number) {
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const fullSize = page.getViewport({ scale: 1 });
        const scale = Math.min(THUMBNAIL_SCALE, THUMBNAIL_MAX_WIDTH / fullSize.width, THUMBNAIL_MAX_HEIGHT / fullSize.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTasks.add(renderTask);
        await renderTask.promise;
        renderTasks.delete(renderTask);
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const src = canvas.toDataURL('image/png');
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'ready', src } }));
      } catch {
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'error' } }));
      }
    }

    for (const pageIndex of indices) {
      if (!thumbnails[pageIndex] || thumbnails[pageIndex].kind === 'loading') void renderThumbnail(pageIndex);
    }
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  // `thumbnailSession` changes after each successfully loaded document, even when its filename and first page match the prior document.
  }, [state.kind, state.kind === 'ready' ? state.pageIndex : -1, thumbnailSession]);

  async function renderPage(pdf: PDFDocumentProxy, view: ViewState, requestId: number): Promise<boolean> {
    const renderId = ++renderIdRef.current;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    if (isCurrent(requestId)) setIsRendering(true);

    try {
      const page = await pdf.getPage(view.pageIndex + 1);
      if (!isCurrentRender(requestId, renderId)) return false;
      const viewport = page.getViewport({ scale: view.scale, rotation: view.rotation });
      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      if (!canvas || !textLayer) throw new Error('The reader surface is no longer available.');

      const outputScale = window.devicePixelRatio || 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser did not provide a canvas rendering context.');

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
      textLayer.style.width = `${Math.floor(viewport.width)}px`;
      textLayer.style.height = `${Math.floor(viewport.height)}px`;
      // PDF.js's viewer stylesheet uses these variables to calculate the
      // visible text layer dimensions from its unrotated page coordinates.
      // They must live on the real container (rather than a staging element)
      // so its data-main-rotation transform applies with the canvas viewport.
      textLayer.style.setProperty('--total-scale-factor', String(view.scale));
      textLayer.style.setProperty('--scale-round-x', '1px');
      textLayer.style.setProperty('--scale-round-y', '1px');
      textLayer.replaceChildren();

      const renderTask = page.render({
        canvas,
        canvasContext: context,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
      });
      renderTaskRef.current = renderTask;
      await renderTask.promise;
      if (!isCurrentRender(requestId, renderId)) return false;
      const textLayerTask = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
      textLayerTaskRef.current = textLayerTask;
      await textLayerTask.render();
      if (!isCurrentRender(requestId, renderId)) return false;
      return true;
    } catch (error) {
      if (!isCurrentRender(requestId, renderId)) return false;
      setState({ kind: 'error', message: readerError(error) });
      return false;
    } finally {
      if (isCurrentRender(requestId, renderId)) {
        renderTaskRef.current = null;
        textLayerTaskRef.current = null;
        setIsRendering(false);
      }
    }
  }

  async function loadPdf(bytes: Uint8Array, fileName: string, requestId: number) {
    if (!isCurrent(requestId)) return;
    try {
      if (!isPdfSignature(bytes)) {
        setState({ kind: 'error', message: 'Choose a PDF file. The selected file does not have a PDF signature.' });
        return;
      }

      const hashPromise = contentHash(bytes).catch(() => undefined);
      const loadingTask = getDocument({ data: bytes });
      loadingTaskRef.current = loadingTask;
      const pdf = await loadingTask.promise;
      if (!isCurrent(requestId)) {
        await loadingTask.destroy();
        return;
      }
      if (pdf.numPages > MAX_PDF_PAGES) {
        await loadingTask.destroy();
        if (isCurrent(requestId)) {
          setState({
            kind: 'error',
            message: `This PDF has ${pdf.numPages} pages, above the 500-page reader limit. Choose a PDF with 500 pages or fewer; large-document analysis is unavailable in this reader.`,
          });
        }
        return;
      }
      documentRef.current = pdf;
      const initialView: ViewState = { pageIndex: 0, scale: 1.35, rotation: 0 };
      void loadOutline(pdf, requestId);
      if (!await renderPage(pdf, initialView, requestId)) return;
      if (!isCurrent(requestId)) return;
      setPageInput('1');
      setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...initialView });
      setThumbnailSession(requestId);
      const contentKey = await hashPromise;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      // The extraction uses the content hash in every block ID. If hashing is
      // unavailable, extraction remains inspectable for this session but is
      // explicitly not a stable cross-open document version.
      const documentVersion = contentKey ? `sha256:${contentKey}` : `unverified-session:${requestId}`;
      void extractPageBlocks(pdf, requestId, documentVersion);
      if (!contentKey) {
        viewRestoreReadyRef.current = true;
        setViewStorageStatus('This browser could not identify the PDF content, so its view position cannot be restored or saved. Reading continues normally.');
        setViewRestoreEpoch((epoch) => epoch + 1);
        return;
      }
      setDocumentContentKey(contentKey);
      const restoreSession = viewSessionRef.current;
      const restoreRevision = viewInteractionRevisionRef.current;
      const storage = getLocalStorageArea();
      if (!storage) {
        viewRestoreReadyRef.current = true;
        setViewStorageStatus('View position cannot be restored or saved because extension local storage is unavailable. Reading continues normally.');
        setViewRestoreEpoch((epoch) => epoch + 1);
        return;
      }
      setViewStorageStatus('Restoring any saved view position…');
      try {
        const values = await storage.get(`${VIEW_STORAGE_PREFIX}${contentKey}`);
        if (!isCurrent(requestId) || documentRef.current !== pdf || restoreSession !== viewSessionRef.current || restoreRevision !== viewInteractionRevisionRef.current) return;
        const restoredView = savedView(values[`${VIEW_STORAGE_PREFIX}${contentKey}`], pdf.numPages);
        if (restoredView) {
          if (!await renderPage(pdf, restoredView, requestId)) return;
          if (!isCurrent(requestId) || documentRef.current !== pdf || restoreSession !== viewSessionRef.current || restoreRevision !== viewInteractionRevisionRef.current) return;
          setPageInput(String(restoredView.pageIndex + 1));
          setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...restoredView });
          setViewStorageStatus('Saved view position restored locally for this PDF.');
        } else {
          setViewStorageStatus('No saved view position exists for this PDF yet.');
        }
      } catch {
        if (isCurrent(requestId) && documentRef.current === pdf && restoreSession === viewSessionRef.current) {
          setViewStorageStatus('View position could not be restored locally. Reading continues normally.');
        }
      } finally {
        if (isCurrent(requestId) && documentRef.current === pdf && restoreSession === viewSessionRef.current) {
          viewRestoreReadyRef.current = true;
          setViewRestoreEpoch((epoch) => epoch + 1);
        }
      }
    } catch (error) {
      if (!isCurrent(requestId)) return;
      setState({ kind: 'error', message: readerError(error) });
    }
  }

  async function importLocalFile(file: File) {
    const requestId = beginImport();
    if (file.size > MAX_PDF_BYTES) {
      setState({ kind: 'error', message: byteLimitMessage(file.size) });
      return;
    }
    if (!await prepareImport(file.name, requestId)) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent(requestId)) return;
      await loadPdf(bytes, file.name, requestId);
    } catch (error) {
      if (isCurrent(requestId)) setState({ kind: 'error', message: readerError(error) });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void importLocalFile(file);
    event.target.value = '';
  }

  async function importUrl(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(urlValue);
    } catch {
      setState({ kind: 'error', message: 'Enter a complete HTTPS PDF URL.' });
      return;
    }
    if (url.protocol !== 'https:') {
      setState({ kind: 'error', message: 'Only HTTPS PDF URLs can be imported.' });
      return;
    }

    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: 'This browser does not expose the extension permission API.' });
      return;
    }
    const requestId = beginImport();
    const origin = permissionPattern(url);
    // This call must remain synchronous with the form-submit user gesture. In
    // particular, do not await document cleanup or permissions.contains() first.
    let permissionRequest: Promise<boolean>;
    try {
      permissionRequest = permissions.request({ origins: [origin] });
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setState({ kind: 'error', message: `Could not request permission for ${url.origin}.${detail}` });
      return;
    }
    setState({ kind: 'requesting-permission', fileName: url.href });
    try {
      const granted = await permissionRequest;
      if (!isCurrent(requestId)) return;
      if (!granted) {
        setState({ kind: 'error', message: `Permission to download from ${url.origin} was denied. You can choose a local PDF instead.` });
        return;
      }

      const controller = new AbortController();
      if (!await prepareImport(url.href, requestId, controller)) return;

      const response = await fetch(url.href, {
        credentials: 'omit',
        headers: { Accept: 'application/pdf' },
        signal: controller.signal,
      });
      if (!isCurrent(requestId)) return;
      if (!response.ok) {
        setState({ kind: 'error', message: `The server responded with HTTP ${response.status} ${response.statusText}. Download the PDF and choose it locally instead.` });
        return;
      }

      const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
      const bytes = await readPdfResponse(response, requestId, isCurrent);
      if (!isCurrent(requestId)) return;
      if (!isPdfSignature(bytes)) {
        const html = contentType.includes('text/html') || looksLikeHtml(bytes);
        setState({
          kind: 'error',
          message: html
            ? 'The URL returned HTML instead of a PDF, often a sign-in or landing page. Download the PDF and choose it locally instead.'
            : 'The downloaded response is not a PDF. Download the PDF and choose it locally instead.',
        });
        return;
      }
      await loadPdf(bytes, url.pathname.split('/').pop() || url.hostname, requestId);
    } catch (error) {
      if (!isCurrent(requestId)) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ kind: 'cancelled', message: 'URL import cancelled.' });
        return;
      }
      if (error instanceof Error && error.message.startsWith('This PDF exceeds the 100 MiB reader limit')) {
        setState({ kind: 'error', message: error.message });
        return;
      }
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setState({ kind: 'error', message: `Could not download this PDF. Check the URL and network connection, or choose a local PDF instead.${detail}` });
    }
  }

  function cancelImport() {
    if (state.kind !== 'loading' && state.kind !== 'requesting-permission') return;
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (state.kind === 'loading') void clearPreviousDocument();
    setState({ kind: 'cancelled', message: 'URL import cancelled.' });
  }

  function changeView(nextView: ViewState) {
    if (state.kind !== 'ready' || !documentRef.current) return;
    viewInteractionRevisionRef.current += 1;
    setState({ ...state, ...nextView });
    setPageInput(String(nextView.pageIndex + 1));
    void renderPage(documentRef.current, nextView, requestIdRef.current);
  }

  function goToPage(pageIndex: number) {
    if (state.kind !== 'ready' || pageIndex < 0 || pageIndex >= state.pageCount) return;
    changeView({ pageIndex, scale: state.scale, rotation: state.rotation });
  }

  function submitPage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== 'ready') return;
    const pageNumber = Number(pageInput);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > state.pageCount) {
      setPageInput(String(state.pageIndex + 1));
      return;
    }
    goToPage(pageNumber - 1);
  }

  function adjustScale(direction: -1 | 1) {
    if (state.kind !== 'ready') return;
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((state.scale + direction * SCALE_STEP) * 100) / 100));
    if (scale !== state.scale) changeView({ pageIndex: state.pageIndex, scale, rotation: state.rotation });
  }

  function rotate(direction: -1 | 1) {
    if (state.kind !== 'ready') return;
    const rotation = (state.rotation + direction * 90 + 360) % 360;
    changeView({ pageIndex: state.pageIndex, scale: state.scale, rotation });
  }

  function navigateSearchMatch(direction: -1 | 1) {
    if (state.kind !== 'ready' || searchMatches.length === 0) return;
    const nextIndex = activeSearchMatch === -1
      ? (direction === 1 ? 0 : searchMatches.length - 1)
      : (activeSearchMatch + direction + searchMatches.length) % searchMatches.length;
    const match = searchMatches[nextIndex];
    setActiveSearchMatch(nextIndex);
    goToPage(match.pageIndex);
  }

  function searchStatus(): string {
    const query = searchQuery.trim();
    if (searchIndex.kind === 'idle') return 'Search becomes available after a PDF has loaded.';
    if (searchIndex.kind === 'unavailable' || searchIndex.kind === 'error') return searchIndex.message;
    const progress = `${searchIndex.indexedPageCount} of ${searchIndex.pageCount} pages`;
    const extractionWarning = searchIndex.failedPageCount > 0
      ? ` Text could not be extracted from ${searchIndex.failedPageCount} page${searchIndex.failedPageCount === 1 ? '' : 's'}.`
      : '';
    if (!query) {
      return searchIndex.kind === 'indexing'
        ? `Indexing searchable text from ${progress}. Reading controls remain available.`
        : `Searchable text indexed from ${progress}.${extractionWarning}`;
    }
    const resultSummary = searchMatches.length === 0
      ? 'No matches'
      : `${searchMatches.length} match${searchMatches.length === 1 ? '' : 'es'} on ${new Set(searchMatches.map((match) => match.pageIndex)).size} page${new Set(searchMatches.map((match) => match.pageIndex)).size === 1 ? '' : 's'}`;
    const activeMatch = searchMatches[activeSearchMatch];
    const activeSummary = activeMatch
      ? ` Viewing match ${activeSearchMatch + 1} on page ${activeMatch.pageIndex + 1}${activeMatch.precision === 'exact'
        ? ` at raw item offsets ${activeMatch.rawStart}–${activeMatch.rawEnd}`
        : activeMatch.precision === 'block'
          ? ' at the matching PDF.js text item; normalization prevents an exact raw-offset claim'
          : '; case folding or an incomplete map limits this result to page-level navigation'}.`
      : '';
    return searchIndex.kind === 'indexing'
      ? `${resultSummary} in ${progress}; indexing continues.${activeSummary}`
      : `${resultSummary} in the indexed document.${extractionWarning}${activeSummary}`;
  }

  function extractionStatus(): string {
    if (extraction.kind === 'idle') return 'Page-block diagnostics become available after a PDF has loaded.';
    if (extraction.kind === 'error') return extraction.message;
    if (extraction.kind === 'extracting') {
      return `Extracting local page blocks from ${extraction.extractedPageCount} of ${extraction.pageCount} pages: ${extraction.textPageCount} with text, ${extraction.emptyPageCount} with no text, ${extraction.failedPageCount} unreadable.`;
    }
    const coverage = extraction.coverage === 'full'
      ? 'full text coverage'
      : extraction.coverage === 'partial'
        ? 'partial text coverage'
        : 'unreadable text coverage';
    const transformedBlocks = pageBlocksRef.current.filter((block) => block.qualityFlags.some((flag) => flag.startsWith('normalized-') || flag === 'offset-map-ambiguous')).length;
    return `${coverage}: ${extraction.textPageCount} of ${extraction.pageCount} pages have extractable text; ${extraction.emptyPageCount} have no text and ${extraction.failedPageCount} could not be extracted. ${extraction.blockCount} local page blocks were created with ${PDF_PAGE_BLOCK_EXTRACTION_VERSION} mapping; ${transformedBlocks} blocks have normalization changes or uncertain interior offsets.`;
  }

  return (
    <main className="reader-page" aria-labelledby="page-title">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Independent reader · local PDF.js spike</p>
          <h1 id="page-title">Open a PDF</h1>
        </div>
        <label className="file-picker">
          <span>Choose PDF</span>
          <input aria-label="Choose a local PDF" type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
        </label>
      </header>
      <form className="url-import" onSubmit={importUrl}>
        <label htmlFor="pdf-url">Import an HTTPS PDF URL</label>
        <div className="url-import-controls">
          <input id="pdf-url" type="url" value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.org/paper.pdf" inputMode="url" />
          <button type="submit" disabled={state.kind === 'loading' || state.kind === 'requesting-permission'}>Import URL</button>
          {(state.kind === 'loading' || state.kind === 'requesting-permission') && <button type="button" className="secondary-button" onClick={cancelImport}>Cancel</button>}
        </div>
        <p>Submitting requests permission only for this HTTPS host, then downloads without site cookies and verifies the PDF signature.</p>
      </form>
      <section className="reader-status" aria-live="polite" role="status">
        {state.kind === 'idle' && 'No document is loaded. Choose a local PDF to render its first page.'}
        {state.kind === 'requesting-permission' && `Requesting permission to download from ${state.fileName}…`}
        {state.kind === 'loading' && `Loading ${state.fileName} with the extension-packaged PDF.js worker…`}
        {state.kind === 'ready' && `${state.fileName}: page ${state.pageIndex + 1} of ${state.pageCount} at ${Math.round(state.scale * 100)}% zoom, rotated ${state.rotation}°. The page is rendered locally; search is enabled only when PDF.js can extract text.`}
        {state.kind === 'cancelled' && state.message}
        {state.kind === 'error' && state.message}
      </section>
      {state.kind === 'ready' && viewStorageStatus && <p className="view-storage-status" role="status">{viewStorageStatus}</p>}
      {state.kind === 'ready' && <section className="reader-controls" aria-label="PDF page controls">
        <div className="page-navigation" role="group" aria-label="Page navigation">
          <button type="button" onClick={() => goToPage(state.pageIndex - 1)} disabled={isRendering || state.pageIndex === 0}>Previous page</button>
          <form onSubmit={submitPage}>
            <label htmlFor="page-number">Page</label>
            <input id="page-number" type="text" inputMode="numeric" pattern="[0-9]*" value={pageInput} onChange={(event) => setPageInput(event.target.value)} aria-describedby="page-count" disabled={isRendering} />
            <span id="page-count">of {state.pageCount}</span>
            <button type="submit" disabled={isRendering}>Go</button>
          </form>
          <button type="button" onClick={() => goToPage(state.pageIndex + 1)} disabled={isRendering || state.pageIndex === state.pageCount - 1}>Next page</button>
        </div>
        <div className="view-controls" role="group" aria-label="Zoom and rotation">
          <button type="button" onClick={() => adjustScale(-1)} disabled={isRendering || state.scale <= MIN_SCALE}>Zoom out</button>
          <output aria-label="Current zoom">{Math.round(state.scale * 100)}%</output>
          <button type="button" onClick={() => adjustScale(1)} disabled={isRendering || state.scale >= MAX_SCALE}>Zoom in</button>
          <button type="button" onClick={() => rotate(-1)} disabled={isRendering}>Rotate counterclockwise</button>
          <button type="button" onClick={() => rotate(1)} disabled={isRendering}>Rotate clockwise</button>
        </div>
      </section>}
      {state.kind === 'ready' && <section className="search-controls" aria-label="Full document search">
        <div className="search-input">
          <label htmlFor="document-search">Find in document</label>
          <input
            id="document-search"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search all PDF pages"
            autoComplete="off"
            disabled={searchIndex.kind === 'unavailable' || searchIndex.kind === 'error'}
          />
        </div>
        <div className="search-navigation" role="group" aria-label="Search result navigation">
          <button type="button" onClick={() => navigateSearchMatch(-1)} disabled={isRendering || searchIndex.kind === 'unavailable' || searchIndex.kind === 'error' || searchMatches.length === 0}>Previous match</button>
          <output aria-live="polite" aria-label="Search status">{searchStatus()}</output>
          <button type="button" onClick={() => navigateSearchMatch(1)} disabled={isRendering || searchIndex.kind === 'unavailable' || searchIndex.kind === 'error' || searchMatches.length === 0}>Next match</button>
        </div>
      </section>}
      {state.kind === 'ready' && <section className="extraction-diagnostics" aria-labelledby="extraction-diagnostics-title">
        <h2 id="extraction-diagnostics-title">Text extraction diagnostics</h2>
        <p aria-live="polite">{extractionStatus()}</p>
        <p className="extraction-caution">Blocks keep PDF.js source-item order and original item coordinates for page anchors. That source order is not a reliable paper reading order, especially for columns, tables, and formulas.</p>
        <p className="extraction-caution">Offset mapping is versioned and applies inside one PDF.js text item only. Search never claims a cross-item, cross-column, or cross-page exact offset; transformed or uncertain items fall back to block or page navigation.</p>
        {extraction.kind === 'ready' && <details>
          <summary>Inspect page coverage</summary>
          <ul className="extraction-page-list">
            {extraction.pages.map((page) => <li key={page.pageIndex}>
              Page {page.pageIndex + 1}: {page.status === 'text'
                ? `${page.blocks.length} blocks with text`
                : page.status === 'empty'
                  ? 'no extractable text'
                  : `text extraction failed${page.error ? ` (${page.error})` : ''}`}.
            </li>)}
          </ul>
        </details>}
      </section>}
      {state.kind === 'ready' && <section className="extraction-diagnostics" aria-labelledby="citation-diagnostics-title">
        <h2 id="citation-diagnostics-title">Local References and citation diagnostics</h2>
        {citationIndex.kind === 'idle' || citationIndex.kind === 'indexing'
          ? <p aria-live="polite">Indexing conservative local References and numbered bracket markers after page extraction…</p>
          : citationIndex.kind === 'error'
            ? <p className="extraction-caution" role="status">{citationIndex.message}</p>
            : <>
              <p aria-live="polite">{citationIndex.index.references.length} local numbered Reference candidate{citationIndex.index.references.length === 1 ? '' : 's'}; {citationIndex.index.occurrences.length} numbered bracket occurrence{citationIndex.index.occurrences.length === 1 ? '' : 's'}: {citationIndex.index.matchedOccurrenceCount} matched, {citationIndex.index.ambiguousOccurrenceCount} ambiguous, {citationIndex.index.unresolvedOccurrenceCount} unresolved.</p>
              {citationIndex.index.diagnostics.map((diagnostic) => <p key={diagnostic} className="extraction-caution">{diagnostic}</p>)}
              <details>
                <summary>Inspect local Reference and citation candidates</summary>
                <ul className="extraction-page-list">
                  {citationIndex.index.referenceHeading && <li>Heuristic heading on Page {citationIndex.index.referenceHeading.anchor.pageIndex + 1}: {citationIndex.index.referenceHeading.rawText}</li>}
                  {citationIndex.index.references.slice(0, 50).map((reference) => <li key={reference.refId}>Reference [{reference.number}] candidate on Page {reference.anchor.pageIndex + 1}: {reference.rawText}</li>)}
                  {citationIndex.index.references.length > 50 && <li>{citationIndex.index.references.length - 50} more Reference candidates are not shown here.</li>}
                  {citationIndex.index.occurrences.slice(0, 100).map((occurrence) => <li key={occurrence.occurrenceId}>Marker {occurrence.displayMarker} on Page {occurrence.anchor.pageIndex + 1}: {occurrence.status}; {occurrence.basis.join(', ')}.</li>)}
                  {citationIndex.index.occurrences.length > 100 && <li>{citationIndex.index.occurrences.length - 100} more marker occurrences are not shown here.</li>}
                  {citationIndex.index.references.length === 0 && citationIndex.index.occurrences.length === 0 && <li>No eligible single-item numbered Reference entries or bracket markers were found.</li>}
                </ul>
              </details>
            </>}
      </section>}
      <div className="reader-workspace">
        {state.kind === 'ready' && <aside className="reader-navigation" aria-label="PDF navigation">
          <section className="navigation-panel" aria-labelledby="outline-title">
            <h2 id="outline-title">Outline</h2>
            {outline.kind === 'idle' || outline.kind === 'loading'
              ? <p>Reading this PDF’s outline…</p>
              : outline.kind === 'ready'
                ? <nav aria-label="PDF outline"><OutlineItems items={outline.items} depth={0} onNavigate={navigateOutline} /></nav>
                : <>
                  <p>{outline.message}</p>
                  {autoSections.kind === 'idle' || autoSections.kind === 'identifying'
                    ? <p>Identifying conservative automatic section candidates from local PDF text…</p>
                    : autoSections.kind === 'error'
                      ? <p className="navigation-notice">{autoSections.message}</p>
                      : autoSections.candidates.length === 0
                        ? <p>No reliable automatic section candidates were found. Use page thumbnails and page navigation.</p>
                        : <nav aria-label="Automatically identified section candidates">
                          <p className="automatic-outline-label">Automatically identified sections · candidates only</p>
                          <p className="automatic-outline-caution">These are not a native PDF outline or a reconstructed reading order. Each candidate comes from one PDF.js text item. Multi-column pages, tables, and formulas can produce false headings; low-confidence entries are marked.</p>
                          <ul className="outline-list automatic-outline-list">
                            {autoSections.candidates.map((candidate) => <li key={candidate.candidateId}>
                              <button
                                type="button"
                                className="outline-item"
                                onClick={() => navigateAutoSection(candidate)}
                                title={`Automatic ${candidate.confidence}-confidence candidate; go to page ${candidate.pageIndex + 1}`}
                              >
                                {candidate.title} <span className="automatic-outline-meta">Page {candidate.pageIndex + 1} · {candidate.confidence} confidence · source: {candidate.signals.join(', ')}</span>
                              </button>
                            </li>)}
                          </ul>
                        </nav>}
                </>}
            {outlineNotice && <p className="navigation-notice" role="status">{outlineNotice}</p>}
          </section>
          <section className="navigation-panel" aria-labelledby="thumbnails-title">
            <h2 id="thumbnails-title">Pages</h2>
            <p className="thumbnail-hint">Previews are rendered only for this page and its immediate neighbors.</p>
            <div className="thumbnail-list" aria-label="Nearby page thumbnails">
              {[state.pageIndex - 1, state.pageIndex, state.pageIndex + 1]
                .filter((pageIndex) => pageIndex >= 0 && pageIndex < state.pageCount)
                .map((pageIndex) => {
                  const thumbnail = thumbnails[pageIndex];
                  return <button
                    type="button"
                    className="thumbnail-button"
                    key={pageIndex}
                    onClick={() => goToPage(pageIndex)}
                    aria-current={pageIndex === state.pageIndex ? 'page' : undefined}
                    aria-label={`Go to page ${pageIndex + 1}${pageIndex === state.pageIndex ? ', current page' : ''}`}
                  >
                    {thumbnail?.kind === 'ready'
                      ? <img src={thumbnail.src} alt={`Thumbnail preview of page ${pageIndex + 1}`} />
                      : <span className="thumbnail-placeholder">{thumbnail?.kind === 'error' ? 'Preview unavailable' : 'Rendering preview…'}</span>}
                    <span>Page {pageIndex + 1}</span>
                  </button>;
                })}
            </div>
          </section>
        </aside>}
        <section className="reader-stage" aria-label="PDF page preview">
          <div className="pdf-page" hidden={state.kind !== 'ready' && state.kind !== 'loading'}>
            <canvas ref={canvasRef} aria-label="Rendered PDF page" />
            <div ref={textLayerRef} className="textLayer" aria-label="Selectable text from the rendered PDF page" />
          </div>
        </section>
      </div>
      <p className="reader-boundary">This reader accepts local or HTTPS PDFs up to 100 MiB and 500 pages, renders one page at a time, and searches PDF.js text only when text is available. It includes PDF-provided outlines and nearby-page thumbnails. It does not save files, accept passwords, perform OCR, annotate, import HTML, or use AI features.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
