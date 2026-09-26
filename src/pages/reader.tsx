import { createRoot } from 'react-dom/client';
import { type ChangeEvent, type FormEvent, type KeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  GlobalWorkerOptions,
  getDocument,
  InvalidPDFException,
  PasswordException,
  TextLayer,
  type PDFDocumentLoadingTask,
  type PDFDocumentProxy,
  type PageViewport,
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
  type PdfCitationOccurrence,
  type PdfLocalCitationIndex,
  type PdfReferenceCandidate,
} from '../lib/pdfCitationIndex';
import {
  locateEvidenceCandidate,
  pdfEvidenceLedgerFromPages,
  type EvidenceLedger,
} from '../lib/evidenceLedger';
import {
  parseThreeLineOverview,
  threeLineEvidencePacket,
  threeLineOverviewMessages,
  validateThreeLineOverview,
  type ThreeLineOverview,
} from '../lib/threeLineOverview';
import {
  DETAILED_SECTION_IDS,
  assembleDetailedOverview,
  parseDetailedSectionResponse,
  progressiveDetailedSectionMessages,
  unavailableDetailedSection,
  validateProgressiveDetailedSectionResponse,
  type DetailedOverview,
  type DetailedSectionId,
  type DetailedOverviewSection,
} from '../lib/detailedOverview';
import { appendProgressiveEvidenceStage, createProgressiveEvidenceSession } from '../lib/evidencePacket';
import { createEvidencePassages } from '../lib/evidencePassages';
import { createPassageRetrievalIndex, selectRankedPassagesForPurpose } from '../lib/retrievalIndex';
import {
  clearPdfHighlights,
  deletePdfHighlight,
  loadPdfHighlights,
  putPdfHighlight,
  type StoredPdfHighlight,
} from '../lib/pdfHighlightRepository';
import { requestApiHostPermission } from '../lib/apiPermissions';
import { CompatibleProviderError, requestCompatibleCompletion, type CompatibleUsage } from '../lib/compatibleProvider';
import { loadApiKey, loadModelConfig, type ModelConfig } from '../lib/modelConfig';
import { parseTranslationResponse, translationMessages, type TranslationResult } from '../lib/translationResponse';
import { TRANSLATION_PROMPT_VERSION, translationSourceForSelection } from '../lib/translationContext';
import { cacheTranslation, loadCachedTranslation, type TranslationCacheInput } from '../lib/translationCache';
import {
  createTranslationJob,
  interruptActiveTranslationJobs,
  loadSuccessfulTranslationJobs,
  updateTranslationJob,
  type StoredTranslationJob,
} from '../lib/translationJobRepository';
import {
  classifyUrlPdfResponse,
  isPdfSignature,
  permissionPattern,
  urlPdfRejectionMessage,
} from '../lib/urlPdfImport';
import { isArxivDirectPdfUrl } from '../lib/arxivPdfInterception';
import { useThemePreference } from '../components/ThemePreferenceControl';

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
  contains: (permissions: { origins: string[] }) => Promise<boolean>;
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

type PdfHighlightRect = {
  left: number;
  bottom: number;
  right: number;
  top: number;
};

type PdfHighlightColor = 'yellow' | 'green' | 'blue' | 'pink';

type SessionHighlight = {
  id: string;
  documentVersion: string;
  pageIndex: number;
  quote: string;
  rects: PdfHighlightRect[];
  color: PdfHighlightColor;
  createdAt: number;
};

type SelectionDraft = {
  pageIndex: number;
  quote: string;
  rects: PdfHighlightRect[];
  toolbarLeft: number;
  toolbarTop: number;
};

type TranslationState = {
  quote: string;
  targetLanguage: 'Chinese' | 'English';
  left: number;
  top: number;
  status: 'preparing' | 'generating' | 'success' | 'error';
  result?: TranslationResult;
  message?: string;
  sourceNotice?: string;
};

type OverviewState = {
  status: 'preparing' | 'generating' | 'success' | 'error';
  result?: ThreeLineOverview;
  message?: string;
};

type DetailedOverviewState = {
  status: 'preparing' | 'generating' | 'success' | 'error';
  result?: DetailedOverview;
  /** Kept only for a completed click; never includes model/PDF text or secrets. */
  diagnostics?: DetailedOverviewDiagnostics;
  message?: string;
};

type DetailedOverviewSectionDiagnostic = {
  id: DetailedSectionId;
  /** Number of retrieval-selected passages actually added to this user turn. */
  newSourceCount: number;
  /** Number of source aliases legal after this turn, including earlier turns. */
  availableAliasCount: number;
  usage?: CompatibleUsage;
};

type DetailedOverviewDiagnostics = {
  sections: DetailedOverviewSectionDiagnostic[];
};

function tokenCountLabel(value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${value} tokens`;
}

function cacheRateLabel(usage: CompatibleUsage | undefined): string | undefined {
  if (!usage) return undefined;
  const hit = usage.promptCacheHitTokens;
  const miss = usage.promptCacheMissTokens;
  if (hit === undefined && miss === undefined) return undefined;
  if (hit === undefined) return `cache miss ${miss} tokens`;
  if (miss === undefined) return `cache hit ${hit} tokens`;
  const total = hit + miss;
  return total === 0 ? 'cache rate unavailable' : `cache ${Math.round((hit / total) * 100)}% (${hit}/${total} tokens)`;
}

function totalCacheRateLabel(diagnostics: DetailedOverviewDiagnostics): string | undefined {
  let hit = 0;
  let miss = 0;
  let hasCounters = false;
  for (const diagnostic of diagnostics.sections) {
    if (diagnostic.usage?.promptCacheHitTokens !== undefined) {
      hit += diagnostic.usage.promptCacheHitTokens;
      hasCounters = true;
    }
    if (diagnostic.usage?.promptCacheMissTokens !== undefined) {
      miss += diagnostic.usage.promptCacheMissTokens;
      hasCounters = true;
    }
  }
  if (!hasCounters || hit + miss === 0) return undefined;
  return `Total prefix-cache rate: ${Math.round((hit / (hit + miss)) * 100)}% (${hit}/${hit + miss} tokens).`;
}

function readerSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function translationJobId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const MAX_TRANSLATION_CHARACTERS = 4_000;

function translationErrorMessage(error: unknown): string {
  if (error instanceof CompatibleProviderError) {
    if (error.code === 'unauthorized') return 'The provider rejected this API key. Update it in Settings.';
    if (error.code === 'not-found') return 'The provider did not find this model or chat-completions endpoint. Check Settings.';
    if (error.code === 'context-too-large') return 'The provider rejected this translation as too large. Select less text.';
    if (error.code === 'rate-limited') return error.retryAfterSeconds === undefined
      ? 'The provider is rate-limiting requests. Try again later.'
      : `The provider is rate-limiting requests. Try again after ${error.retryAfterSeconds} seconds.`;
    if (error.code === 'network') return 'The provider could not be reached. Check the endpoint and connection.';
    if (error.code === 'server-error') return 'The provider had a server error. No retry was sent.';
    if (error.code === 'invalid-response') return 'The provider returned an invalid response. No translation was shown.';
    return 'The translation request was cancelled.';
  }
  return error instanceof Error ? error.message : 'Translation failed before a result was available.';
}

function overviewErrorMessage(error: unknown, subject: 'overview' | 'detailed overview' = 'overview'): string {
  if (error instanceof CompatibleProviderError) {
    if (error.code === 'unauthorized') return 'The provider rejected this API key. Update it in Settings.';
    if (error.code === 'not-found') return 'The provider did not find this model or chat-completions endpoint. Check Settings.';
    if (error.code === 'context-too-large') return `The provider rejected this ${subject} because the local evidence ledger is too large. No ${subject} was shown.`;
    if (error.code === 'rate-limited') return error.retryAfterSeconds === undefined ? 'The provider is rate-limiting requests. Try again later.' : `The provider is rate-limiting requests. Try again after ${error.retryAfterSeconds} seconds.`;
    if (error.code === 'network') return 'The provider could not be reached. Check the endpoint and connection.';
    if (error.code === 'server-error') return 'The provider had a server error. No retry was sent.';
    if (error.code === 'invalid-response') return `The provider returned an invalid response. No ${subject} was shown.`;
    return `The ${subject} request was cancelled.`;
  }
  return error instanceof Error ? error.message : 'The overview failed before a result was available.';
}

const DETAILED_SECTION_LABELS: Record<DetailedSectionId, string> = {
  problem_motivation: '问题与动机',
  method: '方法总览与具体步骤',
  contributions: '核心贡献',
  relative_novelty: '相对创新',
  experiments_ablations: '实验与消融',
  limitations: '局限与未覆盖问题',
};

type RenderedHighlightViewport = {
  pageIndex: number;
  viewport: PageViewport;
};

type ActiveCitation = {
  occurrence: PdfCitationOccurrence;
  references: PdfReferenceCandidate[];
  left: number;
  top: number;
};

type CitationHitRegion = {
  occurrenceId: string;
  rects: Array<{ left: number; top: number; width: number; height: number }>;
};

const HIGHLIGHT_COLORS: Array<{ value: PdfHighlightColor; label: string }> = [
  { value: 'yellow', label: 'Yellow' },
  { value: 'green', label: 'Green' },
  { value: 'blue', label: 'Blue' },
  { value: 'pink', label: 'Pink' },
];

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
type EvidenceLedgerState =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'ready'; ledger: EvidenceLedger }
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
  // Theme changes apply only to CSS tokens and never reset PDF/AI state.
  useThemePreference();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);
  const highlightToolbarRef = useRef<HTMLDivElement>(null);
  const translationPopoverRef = useRef<HTMLDivElement>(null);
  const citationPopoverRef = useRef<HTMLDivElement>(null);
  const citationOverlayRef = useRef<HTMLDivElement>(null);
  const citationTriggerRef = useRef<HTMLElement | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationRequestRef = useRef(0);
  const overviewAbortRef = useRef<AbortController | null>(null);
  const overviewRequestRef = useRef(0);
  const detailedOverviewAbortRef = useRef<AbortController | null>(null);
  const detailedOverviewRequestRef = useRef(0);
  const readerSessionIdRef = useRef(readerSessionId());
  const translationJobRef = useRef<{ jobId: string; documentVersion: string } | null>(null);
  const translationJobCreateRef = useRef<Promise<void> | null>(null);
  const modelConfigRef = useRef<ModelConfig | null>(null);
  const apiKeyRef = useRef<string | undefined>(undefined);
  const modelConfigLoadErrorRef = useRef<string | null>(null);
  const requestIdRef = useRef(0);
  const automaticArxivImportStartedRef = useRef(false);
  const renderIdRef = useRef(0);
  const thumbnailRequestIdRef = useRef(0);
  const searchRequestIdRef = useRef(0);
  const extractionRequestIdRef = useRef(0);
  const viewSessionRef = useRef(0);
  const viewInteractionRevisionRef = useRef(0);
  const viewRestoreReadyRef = useRef(false);
  const viewSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const highlightStorageSessionRef = useRef(0);
  const highlightMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const highlightDeletedIdsRef = useRef(new Set<string>());
  const highlightClearRequestedRef = useRef(false);
  const highlightRevisionRef = useRef(0);
  const highlightDocumentKeyRef = useRef<string | null>(null);
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
  const [evidenceLedger, setEvidenceLedger] = useState<EvidenceLedgerState>({ kind: 'idle' });
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
  const [sessionHighlights, setSessionHighlights] = useState<SessionHighlight[]>([]);
  const [highlightStorageStatus, setHighlightStorageStatus] = useState('');
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [renderedHighlightViewport, setRenderedHighlightViewport] = useState<RenderedHighlightViewport | null>(null);
  const [activeCitation, setActiveCitation] = useState<ActiveCitation | null>(null);
  const [citationHitRegions, setCitationHitRegions] = useState<CitationHitRegion[]>([]);
  const [translation, setTranslation] = useState<TranslationState | null>(null);
  const [translationTarget, setTranslationTarget] = useState<'Chinese' | 'English'>('Chinese');
  const [savedTranslations, setSavedTranslations] = useState<StoredTranslationJob[]>([]);
  const [translationStorageStatus, setTranslationStorageStatus] = useState('');
  const [overview, setOverview] = useState<OverviewState | null>(null);
  const [detailedOverview, setDetailedOverview] = useState<DetailedOverviewState | null>(null);
  // This is only a narrow-layout presentation choice. It deliberately does
  // not participate in the PDF, selection, translation, or overview state.
  const [narrowPanel, setNarrowPanel] = useState<'reading' | 'information'>('reading');

  useEffect(() => () => {
    const activeJob = translationJobRef.current;
    if (activeJob) void (translationJobCreateRef.current ?? Promise.resolve()).then(() => interruptActiveTranslationJobs(activeJob.documentVersion, readerSessionIdRef.current)).catch(() => undefined);
    abortControllerRef.current?.abort();
    translationAbortRef.current?.abort();
    overviewAbortRef.current?.abort();
    detailedOverviewAbortRef.current?.abort();
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
    const markActiveTranslationInterrupted = () => {
      const activeJob = translationJobRef.current;
      if (activeJob) void (translationJobCreateRef.current ?? Promise.resolve()).then(() => interruptActiveTranslationJobs(activeJob.documentVersion, readerSessionIdRef.current)).catch(() => undefined);
    };
    window.addEventListener('pagehide', markActiveTranslationInterrupted);
    return () => window.removeEventListener('pagehide', markActiveTranslationInterrupted);
  }, []);

  useEffect(() => {
    void Promise.all([loadModelConfig(), loadApiKey()]).then(([config, key]) => {
      modelConfigRef.current = config;
      apiKeyRef.current = key.apiKey;
      modelConfigLoadErrorRef.current = null;
    }).catch(() => {
      modelConfigLoadErrorRef.current = 'Model settings could not be loaded.';
    });
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
    setRenderedHighlightViewport(null);
  }

  function isCurrent(requestId: number) {
    return requestId === requestIdRef.current;
  }

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function invalidateTranslation() {
    translationRequestRef.current += 1;
    translationAbortRef.current?.abort();
    translationAbortRef.current = null;
    const activeJob = translationJobRef.current;
    translationJobRef.current = null;
    const creation = translationJobCreateRef.current;
    translationJobCreateRef.current = null;
    if (activeJob) void (creation ?? Promise.resolve()).then(() => updateTranslationJob(activeJob.jobId, 'cancelled')).catch(() => undefined);
    setTranslation(null);
  }

  async function restoreSavedTranslations(contentKey: string, session: number) {
    const documentVersion = `sha256:${contentKey}`;
    setTranslationStorageStatus('Restoring completed translations locally…');
    try {
      // An active checkpoint cannot safely survive a reader reload: do not
      // resume it or send another model request.
      await interruptActiveTranslationJobs(documentVersion);
      const restored = await loadSuccessfulTranslationJobs(documentVersion);
      if (session !== highlightStorageSessionRef.current || highlightDocumentKeyRef.current !== contentKey) return;
      setSavedTranslations(restored);
      setTranslationStorageStatus(restored.length === 0
        ? 'No completed translations are saved for this PDF yet.'
        : `${restored.length} completed translation${restored.length === 1 ? '' : 's'} restored locally. Reopen one without contacting the model.`);
    } catch {
      if (session === highlightStorageSessionRef.current) {
        setTranslationStorageStatus('Completed translations could not be restored locally. No model request was sent.');
      }
    }
  }

  function openSavedTranslation(job: StoredTranslationJob) {
    if (!job.result) return;
    invalidateTranslation();
    setTranslation({
      quote: job.selectedText,
      targetLanguage: job.targetLanguage,
      left: window.innerWidth / 2,
      top: Math.max(8, window.innerHeight * 0.15),
      status: 'success',
      result: job.result,
      sourceNotice: 'Completed translation restored from this browser’s local storage. It was not sent to the model again.',
    });
  }

  function closeTranslation() {
    invalidateTranslation();
  }

  function dismissCitationPopover(returnFocus = true) {
    const trigger = citationTriggerRef.current;
    citationTriggerRef.current = null;
    setActiveCitation(null);
    if (returnFocus && trigger?.isConnected) {
      window.setTimeout(() => trigger.focus(), 0);
    }
  }

  function citationForId(occurrenceId: string): { occurrence: PdfCitationOccurrence; references: PdfReferenceCandidate[] } | null {
    if (citationIndex.kind !== 'ready') return null;
    const occurrence = citationIndex.index.occurrences.find((item) => item.occurrenceId === occurrenceId);
    if (!occurrence) return null;
    const references = occurrence.refIds.flatMap((refId) => {
      const reference = citationIndex.index.references.find((item) => item.refId === refId);
      return reference ? [reference] : [];
    });
    return { occurrence, references };
  }

  function openCitation(occurrenceId: string, trigger: HTMLElement) {
    const citation = citationForId(occurrenceId);
    if (!citation) return;
    const bounds = trigger.getBoundingClientRect();
    citationTriggerRef.current = trigger;
    setSelectionDraft(null);
    setActiveHighlightId(null);
    const viewportPadding = 8;
    const anticipatedWidth = Math.min(400, Math.max(0, window.innerWidth - viewportPadding * 2));
    // Keep the card adjacent to the marker when it fits. At the right edge,
    // align its right edge with the marker instead of letting it overflow.
    const preferredLeft = bounds.left + anticipatedWidth <= window.innerWidth - viewportPadding
      ? bounds.left
      : bounds.right - anticipatedWidth;
    setActiveCitation({
      ...citation,
      left: Math.max(viewportPadding, Math.min(preferredLeft, window.innerWidth - anticipatedWidth - viewportPadding)),
      top: Math.max(viewportPadding, bounds.bottom + viewportPadding),
    });
  }

  function measureVisibleCitationMarkers() {
    if (citationIndex.kind !== 'ready' || state.kind !== 'ready' || renderedHighlightViewport?.pageIndex !== state.pageIndex) {
      setCitationHitRegions([]);
      return;
    }
    const textLayer = textLayerRef.current;
    const pageElement = pdfPageRef.current;
    if (!textLayer || !pageElement) return;
    const occurrences = citationIndex.index.occurrences.filter((occurrence) => occurrence.anchor.pageIndex === state.pageIndex);
    if (occurrences.length === 0) {
      setCitationHitRegions([]);
      return;
    }
    const blocksById = new Map(pageBlocksRef.current.map((block) => [block.blockId, block]));
    const directSpans = Array.from(textLayer.children).filter((child): child is HTMLSpanElement => child instanceof HTMLSpanElement);
    const spansByBlockId = new Map<string, HTMLSpanElement>();
    const usedSpans = new Set<HTMLSpanElement>();
    for (const occurrence of occurrences) {
      const block = blocksById.get(occurrence.sourceBlockId);
      if (!block || spansByBlockId.has(block.blockId)) continue;
      const expected = directSpans[block.sourceOrder];
      const span = expected?.textContent === block.rawText && !usedSpans.has(expected)
        ? expected
        : directSpans.find((candidate) => !usedSpans.has(candidate) && candidate.textContent === block.rawText);
      if (span) {
        spansByBlockId.set(block.blockId, span);
        usedSpans.add(span);
      }
    }
    const pageBounds = pageElement.getBoundingClientRect();
    const regions = occurrences.flatMap((occurrence): CitationHitRegion[] => {
      const span = spansByBlockId.get(occurrence.sourceBlockId);
      if (!span) return [];
      const textNode = Array.from(span.childNodes).find((node): node is Text => node instanceof Text
        && node.data.length >= occurrence.rawEnd
        && node.data.slice(occurrence.rawStart, occurrence.rawEnd) === occurrence.displayMarker);
      if (!textNode) return [];
      const range = document.createRange();
      range.setStart(textNode, occurrence.rawStart);
      range.setEnd(textNode, occurrence.rawEnd);
      const rects = Array.from(range.getClientRects())
        .filter((rect) => rect.width > 0 && rect.height > 0)
        .map((rect) => ({ left: rect.left - pageBounds.left, top: rect.top - pageBounds.top, width: rect.width, height: rect.height }));
      return rects.length > 0 ? [{ occurrenceId: occurrence.occurrenceId, rects }] : [];
    });
    setCitationHitRegions(regions);
  }

  function captureTextLayerSelection() {
    if (state.kind !== 'ready' || !renderedHighlightViewport || renderedHighlightViewport.pageIndex !== state.pageIndex) return;
    const selection = window.getSelection();
    const textLayer = textLayerRef.current;
    const pageElement = pdfPageRef.current;
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !textLayer || !pageElement) return;
    const range = selection.getRangeAt(0);
    const commonNode = range.commonAncestorContainer;
    const commonElement = commonNode.nodeType === Node.ELEMENT_NODE ? commonNode as Element : commonNode.parentElement;
    if (!commonElement || !textLayer.contains(commonElement)) return;
    const quote = selection.toString().trim();
    if (!quote) return;

    const pageBounds = pageElement.getBoundingClientRect();
    const rects = Array.from(range.getClientRects())
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect): PdfHighlightRect => {
        const [firstX, firstY] = renderedHighlightViewport.viewport.convertToPdfPoint(rect.left - pageBounds.left, rect.top - pageBounds.top);
        const [secondX, secondY] = renderedHighlightViewport.viewport.convertToPdfPoint(rect.right - pageBounds.left, rect.bottom - pageBounds.top);
        return {
          left: Math.min(firstX, secondX),
          right: Math.max(firstX, secondX),
          bottom: Math.min(firstY, secondY),
          top: Math.max(firstY, secondY),
        };
      });
    if (rects.length === 0) return;
    const toolbarBounds = range.getBoundingClientRect();
    invalidateTranslation();
    setSelectionDraft({
      pageIndex: state.pageIndex,
      quote,
      rects,
      toolbarLeft: toolbarBounds.left + toolbarBounds.width / 2,
      toolbarTop: Math.max(8, toolbarBounds.top - 10),
    });
    setActiveHighlightId(null);
  }

  function createHighlight(color: PdfHighlightColor) {
    if (!selectionDraft || state.kind !== 'ready' || selectionDraft.pageIndex !== state.pageIndex) return;
    const documentVersion = documentContentKey ? `sha256:${documentContentKey}` : `unverified-session:${requestIdRef.current}`;
    const id = globalThis.crypto?.randomUUID?.() ?? `session-highlight-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const highlight: SessionHighlight = {
      id,
      documentVersion,
      pageIndex: selectionDraft.pageIndex,
      quote: selectionDraft.quote,
      rects: selectionDraft.rects,
      color,
      createdAt: Date.now(),
    };
    highlightRevisionRef.current += 1;
    setSessionHighlights((previous) => [...previous, highlight]);
    if (documentContentKey) void saveHighlight(highlight, highlightStorageSessionRef.current);
    else setHighlightStorageStatus('This browser could not identify the PDF content, so this highlight remains available only while this reader stays open.');
    setSelectionDraft(null);
    clearBrowserSelection();
    setActiveHighlightId(id);
  }

  function updateActiveHighlightColor(color: PdfHighlightColor) {
    if (!activeHighlightId) return;
    const current = sessionHighlights.find((highlight) => highlight.id === activeHighlightId);
    if (!current || current.color === color) return;
    const updated = { ...current, color };
    highlightRevisionRef.current += 1;
    setSessionHighlights((previous) => previous.map((highlight) => highlight.id === activeHighlightId ? updated : highlight));
    if (documentContentKey) void saveHighlight(updated, highlightStorageSessionRef.current);
  }

  function deleteActiveHighlight() {
    if (!activeHighlightId) return;
    const deletedId = activeHighlightId;
    highlightRevisionRef.current += 1;
    highlightDeletedIdsRef.current.add(deletedId);
    setSessionHighlights((previous) => previous.filter((highlight) => highlight.id !== activeHighlightId));
    setActiveHighlightId(null);
    if (documentContentKey) void removeHighlight(deletedId, highlightStorageSessionRef.current);
  }

  function toStoredHighlight(highlight: SessionHighlight): StoredPdfHighlight {
    return {
      id: highlight.id,
      documentVersion: highlight.documentVersion,
      anchor: { pageIndex: highlight.pageIndex, rects: highlight.rects },
      quote: highlight.quote,
      color: highlight.color,
      createdAt: highlight.createdAt,
    };
  }

  function fromStoredHighlight(highlight: StoredPdfHighlight): SessionHighlight {
    return {
      id: highlight.id,
      documentVersion: highlight.documentVersion,
      pageIndex: highlight.anchor.pageIndex,
      rects: highlight.anchor.rects,
      quote: highlight.quote,
      color: highlight.color,
      createdAt: highlight.createdAt,
    };
  }

  function queueHighlightMutation(session: number, operation: () => Promise<void>, success: string) {
    setHighlightStorageStatus('Saving highlights locally…');
    const next = highlightMutationQueueRef.current.catch(() => undefined).then(operation);
    highlightMutationQueueRef.current = next;
    void next.then(() => {
      if (session === highlightStorageSessionRef.current) setHighlightStorageStatus(success);
    }).catch(() => {
      if (session === highlightStorageSessionRef.current) {
        setHighlightStorageStatus('Highlights could not be saved locally. They remain available in this reader until it closes.');
      }
    });
  }

  function saveHighlight(highlight: SessionHighlight, session: number) {
    queueHighlightMutation(session, () => putPdfHighlight(toStoredHighlight(highlight)), 'Highlights are saved locally for this PDF.');
  }

  function removeHighlight(id: string, session: number) {
    queueHighlightMutation(session, () => deletePdfHighlight(id), 'Highlight deletion was saved locally.');
  }

  function clearCurrentDocumentHighlights() {
    if (!documentContentKey) return;
    const session = highlightStorageSessionRef.current;
    highlightRevisionRef.current += 1;
    highlightClearRequestedRef.current = true;
    setSessionHighlights([]);
    setActiveHighlightId(null);
    setSelectionDraft(null);
    queueHighlightMutation(session, () => clearPdfHighlights(`sha256:${documentContentKey}`), 'All saved highlights for this PDF were cleared locally.');
  }

  async function restoreSavedHighlights(contentKey: string, session: number) {
    const documentVersion = `sha256:${contentKey}`;
    const restoreRevision = highlightRevisionRef.current;
    setHighlightStorageStatus('Restoring saved highlights…');
    try {
      const stored = await loadPdfHighlights(documentVersion);
      if (session !== highlightStorageSessionRef.current || highlightDocumentKeyRef.current !== contentKey) return;
      const restored = stored
        .filter((highlight) => !highlightDeletedIdsRef.current.has(highlight.id))
        .map(fromStoredHighlight);
      if (!highlightClearRequestedRef.current) {
        setSessionHighlights((previous) => {
          if (highlightRevisionRef.current === restoreRevision) return restored;
          const merged = new Map(restored.map((highlight) => [highlight.id, highlight]));
          previous.forEach((highlight) => merged.set(highlight.id, highlight));
          return [...merged.values()];
        });
      }
      setHighlightStorageStatus(restored.length === 0 ? 'No saved highlights exist for this PDF yet.' : `${restored.length} saved highlight${restored.length === 1 ? '' : 's'} restored locally for this PDF.`);
    } catch {
      if (session === highlightStorageSessionRef.current && highlightDocumentKeyRef.current === contentKey) {
        setHighlightStorageStatus('Saved highlights could not be restored locally. New highlights remain available in this reader.');
      }
    }
  }

  function dismissHighlightControls() {
    invalidateTranslation();
    setSelectionDraft(null);
    setActiveHighlightId(null);
    clearBrowserSelection();
  }

  function onPdfPageClick(event: MouseEvent<HTMLDivElement>) {
    if (state.kind !== 'ready' || !renderedHighlightViewport || renderedHighlightViewport.pageIndex !== state.pageIndex) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return;
    const pageElement = pdfPageRef.current;
    if (!pageElement) return;
    const bounds = pageElement.getBoundingClientRect();
    const citationHit = citationHitRegions.find((region) => region.rects.some((rect) => (
      event.clientX - bounds.left >= rect.left
      && event.clientX - bounds.left <= rect.left + rect.width
      && event.clientY - bounds.top >= rect.top
      && event.clientY - bounds.top <= rect.top + rect.height
    )));
    if (citationHit) {
      const trigger = citationOverlayRef.current?.querySelector<HTMLElement>(`[data-citation-id="${CSS.escape(citationHit.occurrenceId)}"]`);
      if (trigger) openCitation(citationHit.occurrenceId, trigger);
      return;
    }
    const [pdfX, pdfY] = renderedHighlightViewport.viewport.convertToPdfPoint(event.clientX - bounds.left, event.clientY - bounds.top);
    const hit = [...sessionHighlights].reverse().find((highlight) => highlight.pageIndex === state.pageIndex && highlight.rects.some((rect) => (
      pdfX >= rect.left && pdfX <= rect.right && pdfY >= rect.bottom && pdfY <= rect.top
    )));
    if (!hit) return;
    setSelectionDraft(null);
    clearBrowserSelection();
    setActiveHighlightId(hit.id);
  }

  function onTextLayerKeyUp(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      if (activeCitation) dismissCitationPopover();
      else if (translation) closeTranslation();
      else dismissHighlightControls();
      return;
    }
    captureTextLayerSelection();
  }

  useEffect(() => {
    measureVisibleCitationMarkers();
  }, [citationIndex, renderedHighlightViewport, state.kind, state.kind === 'ready' ? state.pageIndex : -1]);

  useEffect(() => {
    if (activeCitation) citationPopoverRef.current?.focus();
  }, [activeCitation]);

  useLayoutEffect(() => {
    if (!activeCitation) return;
    const popover = citationPopoverRef.current;
    if (!popover) return;
    const padding = 8;
    const bounds = popover.getBoundingClientRect();
    const left = Math.max(padding, Math.min(bounds.left, window.innerWidth - bounds.width - padding));
    const top = Math.max(padding, Math.min(bounds.top, window.innerHeight - bounds.height - padding));
    if (Math.abs(left - bounds.left) < 0.5 && Math.abs(top - bounds.top) < 0.5) return;
    setActiveCitation((current) => current ? { ...current, left, top } : null);
  }, [activeCitation]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (citationPopoverRef.current?.contains(target) || (target instanceof Element && target.closest('[data-citation-id]')))) return;
      if (activeCitation) dismissCitationPopover();
      if (target && (pdfPageRef.current?.contains(target) || highlightToolbarRef.current?.contains(target) || translationPopoverRef.current?.contains(target))) return;
      if (selectionDraft || activeHighlightId) dismissHighlightControls();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (activeCitation) dismissCitationPopover();
      else if (translation) closeTranslation();
      else dismissHighlightControls();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selectionDraft, activeHighlightId, activeCitation, translation]);

  function startTranslation() {
    const draft = selectionDraft;
    if (!draft) return;
    const position = { left: draft.toolbarLeft, top: draft.toolbarTop };
    const source = translationSourceForSelection(searchPagesRef.current[draft.pageIndex], draft.quote);
    const characterCount = Array.from(source.text).length;
    if (characterCount > MAX_TRANSLATION_CHARACTERS) {
      setTranslation({
        quote: source.text,
        targetLanguage: translationTarget,
        ...position,
        status: 'error',
        message: `This selection has ${characterCount} characters. Select at most ${MAX_TRANSLATION_CHARACTERS} characters.`,
        sourceNotice: source.degradation,
      });
      setSelectionDraft(null);
      clearBrowserSelection();
      return;
    }
    const config = modelConfigRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setTranslation({
        quote: draft.quote,
        targetLanguage: translationTarget,
        ...position,
        status: 'error',
        message: modelConfigLoadErrorRef.current ?? 'Configure an API endpoint and model in Settings before translating.',
      });
      setSelectionDraft(null);
      clearBrowserSelection();
      return;
    }

    // Keep this as the first asynchronous operation in the user-click path.
    // Browser permission prompts lose their user gesture if anything is awaited first.
    const permissionRequest = requestApiHostPermission(config.baseUrl);
    const requestToken = ++translationRequestRef.current;
    translationAbortRef.current?.abort();
    const previousJob = translationJobRef.current;
    translationJobRef.current = null;
    const previousJobCreation = translationJobCreateRef.current;
    translationJobCreateRef.current = null;
    if (previousJob) void (previousJobCreation ?? Promise.resolve()).then(() => updateTranslationJob(previousJob.jobId, 'cancelled')).catch(() => undefined);
    const controller = new AbortController();
    translationAbortRef.current = controller;
    const documentVersion = documentContentKey ? `sha256:${documentContentKey}` : undefined;
    const cacheInput: TranslationCacheInput | undefined = documentContentKey
      ? {
        documentVersion: `sha256:${documentContentKey}`,
        selectedText: source.text,
        neighborContext: source.neighborContext,
        targetLanguage: translationTarget,
        model: config.model,
        promptVersion: TRANSLATION_PROMPT_VERSION,
      }
      : undefined;
    const sourceNotice = source.degradation ?? (source.expanded ? 'Expanded to a verified sentence from this same PDF text item. Neighboring sentences are context only and are not translated.' : undefined);
    const job = documentVersion ? {
      jobId: translationJobId(),
      documentVersion,
      stage: 'preparing' as const,
      readerSessionId: readerSessionIdRef.current,
      selectedText: source.text,
      neighborContext: source.neighborContext,
      targetLanguage: translationTarget,
      model: config.model,
      promptVersion: TRANSLATION_PROMPT_VERSION,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies StoredTranslationJob : undefined;
    const jobCreation = job ? createTranslationJob(job) : undefined;
    const persistJobUpdate = (stage: 'generating' | 'success' | 'failed' | 'cancelled', options?: { result?: TranslationResult; error?: string }) => {
      if (!job || !jobCreation) return Promise.resolve();
      return jobCreation.then(() => updateTranslationJob(job.jobId, stage, options));
    };
    if (job && jobCreation) {
      translationJobRef.current = { jobId: job.jobId, documentVersion: job.documentVersion };
      translationJobCreateRef.current = jobCreation;
      void jobCreation.catch(() => {
        if (requestToken === translationRequestRef.current) setTranslationStorageStatus('This translation cannot be saved locally; it remains available in this reader if it succeeds.');
      });
    } else {
      setTranslationStorageStatus('This PDF has no stable content version, so this translation will not be saved after the reader closes.');
    }
    setTranslation({ quote: source.text, targetLanguage: translationTarget, ...position, status: 'preparing', sourceNotice });
    setSelectionDraft(null);
    clearBrowserSelection();

    void (async () => {
      const permission = await permissionRequest;
      if (requestToken !== translationRequestRef.current) return;
      if (!permission.granted) {
        if (job) void persistJobUpdate('failed', { error: 'API host permission was not granted.' }).catch(() => undefined);
        if (translationJobRef.current?.jobId === job?.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
        setTranslation((current) => current && ({
          ...current,
          status: 'error',
          message: permission.reason === 'denied'
            ? 'Permission to contact this API host was denied. You can grant it by starting translation again.'
            : 'This browser could not request permission for the configured API host.',
        }));
        return;
      }
      // Permission is requested synchronously from the click above. A cache
      // hit below never contacts the configured model endpoint.
      if (cacheInput) {
        try {
          const cached = await loadCachedTranslation(cacheInput);
          if (requestToken !== translationRequestRef.current || controller.signal.aborted) return;
          if (cached) {
            if (job) {
              void persistJobUpdate('success', { result: cached }).then(() => {
                if (requestToken === translationRequestRef.current) setSavedTranslations((previous) => [{ ...job, stage: 'success', result: cached, updatedAt: Date.now() }, ...previous.filter((item) => item.jobId !== job.jobId)]);
              }).catch(() => undefined);
              if (translationJobRef.current?.jobId === job.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
            }
            setTranslation((current) => current && ({ ...current, status: 'success', result: cached, message: 'Translation loaded from this browser’s local cache.' }));
            return;
          }
        } catch {
          // Caching is optional; an unavailable or full database cannot block translation.
        }
      }
      if (job) void persistJobUpdate('generating').catch(() => undefined);
      setTranslation((current) => current && ({ ...current, status: 'generating' }));
      try {
        const response = await requestCompatibleCompletion({
          config,
          apiKey: apiKeyRef.current,
          messages: translationMessages(source.text, translationTarget, source.neighborContext),
          signal: controller.signal,
        });
        const result = parseTranslationResponse(response.content);
        if (requestToken !== translationRequestRef.current || controller.signal.aborted) return;
        if (cacheInput) void cacheTranslation(cacheInput, result).catch(() => undefined);
        if (job) {
          void persistJobUpdate('success', { result }).then(() => {
            if (requestToken === translationRequestRef.current) setSavedTranslations((previous) => [{ ...job, stage: 'success', result, updatedAt: Date.now() }, ...previous.filter((item) => item.jobId !== job.jobId)]);
          }).catch(() => {
            if (requestToken === translationRequestRef.current) setTranslationStorageStatus('Translation succeeded but could not be saved locally.');
          });
          if (translationJobRef.current?.jobId === job.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
        }
        setTranslation((current) => current && ({ ...current, status: 'success', result }));
      } catch (error) {
        if (requestToken !== translationRequestRef.current || controller.signal.aborted) return;
        const message = translationErrorMessage(error);
        if (job) void persistJobUpdate('failed', { error: message }).catch(() => undefined);
        if (translationJobRef.current?.jobId === job?.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
        setTranslation((current) => current && ({ ...current, status: 'error', message }));
      }
    })();
  }

  async function copyTranslation() {
    if (!translation?.result) return;
    try {
      await navigator.clipboard.writeText(translation.result.translation);
      setTranslation((current) => current?.result ? { ...current, message: 'Translation copied.' } : current);
    } catch {
      setTranslation((current) => current?.result ? { ...current, message: 'Could not copy the translation in this browser.' } : current);
    }
  }

  function startThreeLineOverview() {
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    if (evidenceLedger.ledger.candidates.length === 0) {
      setOverview({ status: 'error', message: 'No reliable local body excerpts are available for a paper overview. No model request was sent.' });
      return;
    }
    const config = modelConfigRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setOverview({ status: 'error', message: modelConfigLoadErrorRef.current ?? 'Configure an API endpoint and model in Settings before generating an overview.' });
      return;
    }
    // Keep permission invocation in the click call stack so browsers retain
    // the user gesture. The ledger itself is the only source supplied later.
    const permissionRequest = requestApiHostPermission(config.baseUrl);
    const requestToken = ++overviewRequestRef.current;
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    const ledger = evidenceLedger.ledger;
    const pages = extraction.pages;
    // The packet and its private alias mapping are request-local. Construct it
    // once for this user-triggered request so the response cannot be resolved
    // against a packet from another PDF or earlier attempt.
    const packet = threeLineEvidencePacket(ledger);
    setOverview({ status: 'preparing' });
    void (async () => {
      const permission = await permissionRequest;
      if (requestToken !== overviewRequestRef.current) return;
      if (!permission.granted) {
        setOverview({ status: 'error', message: permission.reason === 'denied' ? 'Permission to contact this API host was denied. Start overview generation again to request it.' : 'This browser could not request permission for the configured API host.' });
        return;
      }
      setOverview({ status: 'generating' });
      try {
        const response = await requestCompatibleCompletion({
          config,
          apiKey: apiKeyRef.current,
          messages: threeLineOverviewMessages(packet),
          signal: controller.signal,
        });
        const result = validateThreeLineOverview(parseThreeLineOverview(response.content), packet, ledger, pages);
        if (requestToken !== overviewRequestRef.current || controller.signal.aborted) return;
        setOverview({ status: 'success', result });
      } catch (error) {
        if (requestToken !== overviewRequestRef.current || controller.signal.aborted) return;
        setOverview({ status: 'error', message: overviewErrorMessage(error) });
      }
    })();
  }

  function cancelThreeLineOverview() {
    overviewRequestRef.current += 1;
    overviewAbortRef.current?.abort();
    overviewAbortRef.current = null;
    setOverview(null);
  }

  function startDetailedOverview() {
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    if (overview?.status !== 'success') {
      setDetailedOverview({ status: 'error', message: 'Generate a successful three-line paper overview first; detailed generation will not replace it.' });
      return;
    }
    if (evidenceLedger.ledger.candidates.length === 0) {
      setDetailedOverview({ status: 'error', message: 'No reliable local body excerpts are available for a detailed overview. No model request was sent.' });
      return;
    }
    const config = modelConfigRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setDetailedOverview({ status: 'error', message: modelConfigLoadErrorRef.current ?? 'Configure an API endpoint and model in Settings before generating a detailed overview.' });
      return;
    }
    const permissionRequest = requestApiHostPermission(config.baseUrl);
    const requestToken = ++detailedOverviewRequestRef.current;
    detailedOverviewAbortRef.current?.abort();
    const controller = new AbortController();
    detailedOverviewAbortRef.current = controller;
    const ledger = evidenceLedger.ledger;
    const pages = extraction.pages;
    setDetailedOverview({ status: 'preparing' });
    void (async () => {
      const permission = await permissionRequest;
      if (requestToken !== detailedOverviewRequestRef.current) return;
      if (!permission.granted) {
        setDetailedOverview({ status: 'error', message: permission.reason === 'denied' ? 'Permission to contact this API host was denied. Start detailed overview generation again to request it.' : 'This browser could not request permission for the configured API host.' });
        return;
      }
      setDetailedOverview({ status: 'generating' });
      const sections: DetailedOverviewSection[] = [];
      const diagnostics: DetailedOverviewSectionDiagnostic[] = [];
      // One session is deliberately local to this click. Each following
      // request preserves the exact earlier messages, which lets compatible
      // providers reuse a stable prefix while the only new material is the
      // next retrieval-selected evidence increment and task.
      const passages = createEvidencePassages(ledger, { targetChars: 360, maxChars: 960 });
      const retrievalIndex = createPassageRetrievalIndex(passages);
      const evidenceSession = createProgressiveEvidenceSession(ledger, { maxExcerptChars: 960 });
      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      for (const sectionId of DETAILED_SECTION_IDS) {
        if (requestToken !== detailedOverviewRequestRef.current || controller.signal.aborted) return;
        const orderedPassages = selectRankedPassagesForPurpose(retrievalIndex, sectionId, {
          maxCandidates: 12,
          maxCandidatesPerPage: 2,
          includeAdjacent: true,
        });
        const increment = appendProgressiveEvidenceStage(evidenceSession, sectionId, { orderedPassages });
        const messages = progressiveDetailedSectionMessages(sectionId, increment, history);
        const finalMessage = messages[messages.length - 1];
        if (!finalMessage || finalMessage.role !== 'user') throw new Error('The progressive detailed request must end with its current evidence turn.');
        const currentUserTurn: { role: 'user'; content: string } = { role: 'user', content: finalMessage.content };
        const diagnostic: DetailedOverviewSectionDiagnostic = {
          id: sectionId,
          newSourceCount: increment.sources.length,
          availableAliasCount: increment.sentAliases.length,
        };
        diagnostics.push(diagnostic);
        try {
          const response = await requestCompatibleCompletion({ config, apiKey: apiKeyRef.current, messages, signal: controller.signal });
          if (requestToken !== detailedOverviewRequestRef.current || controller.signal.aborted) return;
          diagnostic.usage = response.usage;
          // Keep the provider's exact content as history even if it fails the
          // local schema/evidence gate. The stable system prompt explicitly
          // marks assistant history as an unverified draft, never as evidence.
          history.push(currentUserTurn, { role: 'assistant', content: response.content });
          sections.push(validateProgressiveDetailedSectionResponse(sectionId, parseDetailedSectionResponse(response.content), evidenceSession, ledger, pages));
        } catch {
          if (requestToken !== detailedOverviewRequestRef.current || controller.signal.aborted) return;
          // A malformed, ungrounded, or failed section cannot erase already
          // verified sections or become a factual fallback.
          sections.push(unavailableDetailedSection(sectionId, 'unavailable', 'This section could not be safely grounded in the available PDF excerpts.'));
        }
      }
      if (requestToken !== detailedOverviewRequestRef.current || controller.signal.aborted) return;
      setDetailedOverview({ status: 'success', result: assembleDetailedOverview(sections), diagnostics: { sections: diagnostics } });
    })();
  }

  function cancelDetailedOverview() {
    detailedOverviewRequestRef.current += 1;
    detailedOverviewAbortRef.current?.abort();
    detailedOverviewAbortRef.current = null;
    setDetailedOverview(null);
  }

  function beginImport() {
    invalidateTranslation();
    cancelThreeLineOverview();
    cancelDetailedOverview();
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
    highlightStorageSessionRef.current += 1;
    highlightMutationQueueRef.current = Promise.resolve();
    highlightDeletedIdsRef.current = new Set();
    highlightClearRequestedRef.current = false;
    highlightRevisionRef.current = 0;
    highlightDocumentKeyRef.current = null;
    if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    setDocumentContentKey(null);
    setSavedTranslations([]);
    setTranslationStorageStatus('');
    setViewStorageStatus('');
    searchPagesRef.current = [];
    pageBlocksRef.current = [];
    setThumbnails({});
    setOutline({ kind: 'idle' });
    setOutlineNotice('');
    setAutoSections({ kind: 'idle' });
    setCitationIndex({ kind: 'idle' });
    setEvidenceLedger({ kind: 'idle' });
    setOverview(null);
    setSearchIndex({ kind: 'idle' });
    setExtraction({ kind: 'idle' });
    setSearchQuery('');
    setSearchMatches([]);
    setActiveSearchMatch(-1);
    indexedSearchQueryRef.current = '';
    setSessionHighlights([]);
    setHighlightStorageStatus('');
    setSelectionDraft(null);
    setActiveHighlightId(null);
    setRenderedHighlightViewport(null);
    setCitationHitRegions([]);
    citationTriggerRef.current = null;
    setActiveCitation(null);
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
    setEvidenceLedger({ kind: 'building' });

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
          try {
            const ledger = pdfEvidenceLedgerFromPages(pages, documentVersion, candidates);
            if (extractionRequestId !== extractionRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
            setEvidenceLedger({ kind: 'ready', ledger });
          } catch {
            if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
              setEvidenceLedger({ kind: 'error', message: 'Local evidence candidates could not be prepared. Reading and text extraction remain available.' });
            }
          }
        } catch {
          if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
            setAutoSections({ kind: 'error', message: 'Automatic section candidates could not be inspected. Page navigation remains available.' });
            setEvidenceLedger({ kind: 'error', message: 'Local evidence candidates need section inspection and could not be prepared. Reading and text extraction remain available.' });
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
    setRenderedHighlightViewport(null);
    setCitationHitRegions([]);
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
      setRenderedHighlightViewport({ pageIndex: view.pageIndex, viewport });
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
      highlightDocumentKeyRef.current = contentKey;
      void restoreSavedHighlights(contentKey, highlightStorageSessionRef.current);
      void restoreSavedTranslations(contentKey, highlightStorageSessionRef.current);
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

      const bytes = await readPdfResponse(response, requestId, isCurrent);
      if (!isCurrent(requestId)) return;
      const responseKind = classifyUrlPdfResponse(bytes);
      if (responseKind !== 'pdf') {
        setState({
          kind: 'error',
          message: urlPdfRejectionMessage(responseKind),
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

  async function importAutomaticArxivPdf(urlValueFromNavigation: string) {
    if (!isArxivDirectPdfUrl(urlValueFromNavigation)) {
      setState({ kind: 'error', message: 'Automatic arXiv opening accepts only an arxiv.org /pdf/ direct link.' });
      return;
    }
    const url = new URL(urlValueFromNavigation);
    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: 'This browser does not expose the extension permission API.' });
      return;
    }

    // The listener only redirects after it has checked this too. Repeat the
    // check because the extension page URL is editable, and never prompt for a
    // host permission without a user gesture.
    let granted = false;
    try {
      granted = await permissions.contains({ origins: [permissionPattern(url)] });
    } catch {
      setState({ kind: 'error', message: `Could not verify permission for ${url.origin}. Open the PDF URL from the import form instead.` });
      return;
    }
    if (!granted) {
      setState({ kind: 'error', message: `Permission to download from ${url.origin} is unavailable. Open the PDF URL from the import form to grant it.` });
      return;
    }

    const requestId = beginImport();
    const controller = new AbortController();
    try {
      if (!await prepareImport(url.href, requestId, controller)) return;
      const response = await fetch(url.href, {
        credentials: 'omit',
        headers: { Accept: 'application/pdf' },
        signal: controller.signal,
      });
      if (!isCurrent(requestId)) return;
      if (!response.ok) {
        setState({ kind: 'error', message: `The arXiv server responded with HTTP ${response.status} ${response.statusText}. Open the original PDF link again or choose a local PDF instead.` });
        return;
      }
      const bytes = await readPdfResponse(response, requestId, isCurrent);
      if (!isCurrent(requestId)) return;
      const responseKind = classifyUrlPdfResponse(bytes);
      if (responseKind !== 'pdf') {
        setState({ kind: 'error', message: urlPdfRejectionMessage(responseKind) });
        return;
      }
      await loadPdf(bytes, url.pathname.split('/').pop() || url.hostname, requestId);
    } catch (error) {
      if (!isCurrent(requestId)) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ kind: 'cancelled', message: 'Automatic arXiv PDF import cancelled.' });
        return;
      }
      const detail = error instanceof Error ? ` ${error.message}` : '';
      setState({ kind: 'error', message: `Could not download this arXiv PDF. Open the original link again or choose a local PDF instead.${detail}` });
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
    invalidateTranslation();
    setSelectionDraft(null);
    setActiveHighlightId(null);
    dismissCitationPopover(false);
    clearBrowserSelection();
    setState({ ...state, ...nextView });
    setPageInput(String(nextView.pageIndex + 1));
    void renderPage(documentRef.current, nextView, requestIdRef.current);
  }

  function goToPage(pageIndex: number) {
    if (state.kind !== 'ready' || pageIndex < 0 || pageIndex >= state.pageCount) return;
    changeView({ pageIndex, scale: state.scale, rotation: state.rotation });
  }

  function goToCitationReference(reference: PdfReferenceCandidate) {
    dismissCitationPopover(false);
    goToPage(reference.anchor.pageIndex);
  }

  function goToCitationReferences() {
    if (citationIndex.kind !== 'ready' || !citationIndex.index.referenceHeading) return;
    dismissCitationPopover(false);
    goToPage(citationIndex.index.referenceHeading.anchor.pageIndex);
  }

  function goToEvidenceCandidate(evidenceId: string) {
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    const candidate = evidenceLedger.ledger.candidates.find((item) => item.evidenceId === evidenceId);
    if (!candidate) return;
    const location = locateEvidenceCandidate(candidate, extraction.pages);
    if (location) goToPage(location.pageIndex);
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

  useEffect(() => {
    if (automaticArxivImportStartedRef.current) return;
    const urlValueFromNavigation = new URL(window.location.href).searchParams.get('arxivPdfUrl');
    if (!urlValueFromNavigation) return;
    automaticArxivImportStartedRef.current = true;
    setUrlValue(urlValueFromNavigation);
    void importAutomaticArxivPdf(urlValueFromNavigation);
  }, []);

  const activeHighlight = activeHighlightId ? sessionHighlights.find((highlight) => highlight.id === activeHighlightId) ?? null : null;
  const canProjectHighlights = state.kind === 'ready'
    && renderedHighlightViewport?.pageIndex === state.pageIndex;
  const visibleHighlights = canProjectHighlights
    ? sessionHighlights.filter((highlight) => highlight.pageIndex === state.pageIndex)
    : [];
  const highlightToolbarPosition = selectionDraft
    ? { left: selectionDraft.toolbarLeft, top: selectionDraft.toolbarTop }
    : activeHighlight && canProjectHighlights && renderedHighlightViewport
      ? (() => {
          const rect = activeHighlight.rects[0];
          const [firstX, firstY] = renderedHighlightViewport.viewport.convertToViewportPoint(rect.left, rect.bottom);
          const [secondX, secondY] = renderedHighlightViewport.viewport.convertToViewportPoint(rect.right, rect.top);
          const pageBounds = pdfPageRef.current?.getBoundingClientRect();
          return {
            left: (pageBounds?.left ?? 0) + (Math.min(firstX, secondX) + Math.max(firstX, secondX)) / 2,
            top: Math.max(8, (pageBounds?.top ?? 0) + Math.min(firstY, secondY) - 10),
          };
        })()
      : null;

  return (
    <main className="reader-page" aria-labelledby="page-title">
      <header className="reader-header">
        <div>
          <p className="eyebrow">Thesis Viewer · local PDF reader</p>
          <h1 id="page-title">{state.kind === 'ready' ? state.fileName : 'Open a PDF'}</h1>
        </div>
        <div className="reader-header-actions">
          <a className="reader-settings-link" href="options.html">Appearance, language &amp; settings</a>
          <button
            type="button"
            className="file-picker"
            aria-controls="local-pdf-input"
            onClick={() => fileInputRef.current?.click()}
          >
            <span>Choose PDF</span>
          </button>
          <input
            ref={fileInputRef}
            id="local-pdf-input"
            className="file-picker-input"
            aria-label="Choose a local PDF"
            type="file"
            accept="application/pdf,.pdf"
            onChange={onFileChange}
          />
        </div>
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
      <div className={`reader-workspace reader-workspace--${narrowPanel}`}>
        {state.kind === 'ready' && <div className="reader-layout-switch" role="group" aria-label="Narrow screen panels">
          <span>Workspace</span>
          <button type="button" aria-pressed={narrowPanel === 'reading'} onClick={() => setNarrowPanel('reading')}>Reading</button>
          <button type="button" aria-pressed={narrowPanel === 'information'} onClick={() => setNarrowPanel('information')}>Overview &amp; details</button>
        </div>}
        {state.kind === 'ready' && <aside className="reader-side-utilities" aria-label="Saved highlights and translations">
        <section className="highlight-storage-controls" aria-label="Saved highlights">
        <p role="status">{highlightStorageStatus || 'Highlights will be saved locally after this PDF is identified.'}</p>
        <button type="button" onClick={clearCurrentDocumentHighlights} disabled={!documentContentKey}>Clear saved highlights for this PDF</button>
        </section>
      {state.kind === 'ready' && <section className="translation-history" aria-labelledby="translation-history-title">
        <h2 id="translation-history-title">Completed translations</h2>
        <p role="status">{translationStorageStatus || (documentContentKey ? 'Checking this PDF for completed translations…' : 'Translations are not saved until this PDF has a stable content version.')}</p>
        {savedTranslations.length > 0 && <ul>
          {savedTranslations.map((job) => <li key={job.jobId}>
            <button type="button" onClick={() => openSavedTranslation(job)}>Open saved translation</button>
            <span>{job.selectedText.length > 100 ? `${job.selectedText.slice(0, 100)}…` : job.selectedText}</span>
          </li>)}
        </ul>}
      </section>}
        </aside>}
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
      {state.kind === 'ready' && <aside className="reader-information" aria-label="Paper overview and local diagnostics">
      <section className="extraction-diagnostics" aria-labelledby="extraction-diagnostics-title">
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
      </section>
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
      {state.kind === 'ready' && <section className="extraction-diagnostics paper-insights" aria-labelledby="evidence-ledger-title">
        <p className="panel-kicker">Paper insights</p>
        <h2 id="evidence-ledger-title">Overview &amp; local evidence</h2>
        {evidenceLedger.kind === 'idle' || evidenceLedger.kind === 'building'
          ? <p aria-live="polite">Preparing conservative local source excerpts after page extraction…</p>
          : evidenceLedger.kind === 'error'
            ? <p className="extraction-caution" role="status">{evidenceLedger.message}</p>
            : <>
              <p aria-live="polite">{evidenceLedger.ledger.candidates.length} local body excerpt candidate{evidenceLedger.ledger.candidates.length === 1 ? '' : 's'} with {evidenceLedger.ledger.coverage === 'full-text' ? 'full-text' : evidenceLedger.ledger.coverage} coverage. These excerpts are not facts, summaries, or model output.</p>
              {evidenceLedger.ledger.diagnostics.map((diagnostic) => <p key={diagnostic} className="extraction-caution">{diagnostic}</p>)}
              <p className="extraction-caution">A section-derived slot is only routing context, not semantic verification. References and Appendix are excluded from this initial body ledger; theoretical, review, and qualitative papers are not forced into experimental slots.</p>
              <section className="overview-panel" aria-labelledby="paper-overview-title">
                <h3 id="paper-overview-title">Paper overview</h3>
                <p>Generate only when you choose to send a compact, bounded set of local evidence excerpts and coverage to your configured model. No overview is generated automatically.</p>
                <button type="button" onClick={startThreeLineOverview} disabled={overview?.status === 'preparing' || overview?.status === 'generating'}>Generate paper overview</button>
                {overview?.status === 'preparing' && <p role="status">Requesting permission to contact the configured API…</p>}
                {overview?.status === 'generating' && <p role="status">Generating a three-line overview from compact local evidence excerpts… <button type="button" onClick={cancelThreeLineOverview}>Cancel</button></p>}
                {overview?.status === 'error' && <p className="overview-error" role="alert">{overview.message} <a href="options.html">Open Settings</a></p>}
                {overview?.status === 'success' && overview.result && <>
                  <ol className="overview-items">
                    {overview.result.items.map((item, index) => <li key={`${index}-${item.text}`}>
                      <p>{item.text}</p>
                      {item.status === 'unavailable' && <span className="overview-unavailable">Material insufficient to confirm an independent contribution.</span>}
                      {item.evidenceIds.length > 0 && <span className="overview-evidence">Evidence: {item.evidenceIds.map((evidenceId) => {
                        const candidate = evidenceLedger.ledger.candidates.find((entry) => entry.evidenceId === evidenceId);
                        const page = candidate && extraction.kind === 'ready' ? locateEvidenceCandidate(candidate, extraction.pages)?.pageIndex : undefined;
                        return <button type="button" className="evidence-chip" key={evidenceId} onClick={() => goToEvidenceCandidate(evidenceId)}>Page {page === undefined ? '?' : page + 1} · {candidate?.precision ?? 'local'}</button>;
                      })}</span>}
                    </li>)}
                  </ol>
                  {overview.result.uncertainties.length > 0 && <p className="overview-uncertainties">Uncertainties: {overview.result.uncertainties.map((item) => item.text).join(' ')}</p>}
                  <p className="extraction-caution">Each evidence chip was checked against this PDF’s current block ID, quote, and recorded location precision. This is model output grounded in local excerpts, not an independent fact check.</p>
                </>}
                <section className="detailed-overview-panel" aria-labelledby="detailed-overview-title">
                  <h4 id="detailed-overview-title">Detailed overview</h4>
                  <p>After the three-line overview succeeds, you may explicitly request a separate 800–1500 Chinese-character overview. It uses six small, section-specific local evidence packets in sequence and never replaces the successful three-line overview.</p>
                  <button type="button" onClick={startDetailedOverview} disabled={overview?.status !== 'success' || detailedOverview?.status === 'preparing' || detailedOverview?.status === 'generating'}>Generate detailed overview</button>
                  {detailedOverview?.status === 'preparing' && <p role="status">Requesting permission to contact the configured API…</p>}
                  {detailedOverview?.status === 'generating' && <p role="status">Generating six detailed-overview sections from progressive local evidence packets… <button type="button" onClick={cancelDetailedOverview}>Cancel</button></p>}
                  {detailedOverview?.status === 'error' && <p className="overview-error" role="alert">{detailedOverview.message} <a href="options.html">Open Settings</a></p>}
                  {detailedOverview?.status === 'success' && detailedOverview.result && <>
                    <p className="extraction-caution">Coverage remains {evidenceLedger.ledger.coverage}; this app-computed limit is not upgraded by the model. Each factual block below has a locally verified evidence chip.</p>
                    <div className="detailed-overview-sections">
                      {detailedOverview.result.sections.map((section) => <section key={section.id} className="detailed-overview-section">
                        <h5>{DETAILED_SECTION_LABELS[section.id]}</h5>
                        {section.status !== 'available' && <p className="overview-unavailable">{section.status === 'not_applicable' ? 'Not applicable to this paper type based on the available material.' : 'Material insufficient to support this section.'}</p>}
                        {section.blocks.map((block, index) => <div key={`${section.id}-${index}`} className="detailed-overview-block">
                          <p>{block.text}</p>
                          {section.id === 'limitations' && block.limitationKind && <span className="detailed-overview-kind">{block.limitationKind.replace('_', ' ')}</span>}
                          {block.evidenceIds.length > 0 && <span className="overview-evidence">Evidence: {block.evidenceIds.map((evidenceId) => {
                            const candidate = evidenceLedger.ledger.candidates.find((entry) => entry.evidenceId === evidenceId);
                            const page = candidate && extraction.kind === 'ready' ? locateEvidenceCandidate(candidate, extraction.pages)?.pageIndex : undefined;
                            return <button type="button" className="evidence-chip" key={evidenceId} onClick={() => goToEvidenceCandidate(evidenceId)}>Page {page === undefined ? '?' : page + 1} · {candidate?.precision ?? 'local'}</button>;
                          })}</span>}
                        </div>)}
                      </section>)}
                    </div>
                    {detailedOverview.result.uncertainties.length > 0 && <p className="overview-uncertainties">Uncertainties: {detailedOverview.result.uncertainties.map((item) => item.text).join(' ')}</p>}
                    {detailedOverview.diagnostics && <details className="detailed-overview-diagnostics">
                      <summary>Local request diagnostics</summary>
                      <p className="extraction-caution">These completed-request counters contain only source/alias counts and provider token usage; no PDF excerpts, prompts, responses, or API key are retained here.</p>
                      {totalCacheRateLabel(detailedOverview.diagnostics) && <p>{totalCacheRateLabel(detailedOverview.diagnostics)}</p>}
                      <ul>
                        {detailedOverview.diagnostics.sections.map((diagnostic) => {
                          const usageParts = [
                            tokenCountLabel(diagnostic.usage?.promptTokens) && `prompt ${tokenCountLabel(diagnostic.usage?.promptTokens)}`,
                            tokenCountLabel(diagnostic.usage?.completionTokens) && `completion ${tokenCountLabel(diagnostic.usage?.completionTokens)}`,
                            cacheRateLabel(diagnostic.usage),
                          ].filter((part): part is string => Boolean(part));
                          return <li key={diagnostic.id}>
                            {DETAILED_SECTION_LABELS[diagnostic.id]}: {diagnostic.newSourceCount} new local passage{diagnostic.newSourceCount === 1 ? '' : 's'}, {diagnostic.availableAliasCount} available alias{diagnostic.availableAliasCount === 1 ? '' : 'es'}
                            {usageParts.length > 0 ? `; ${usageParts.join(', ')}.` : '; provider usage unavailable.'}
                          </li>;
                        })}
                      </ul>
                    </details>}
                  </>}
                </section>
              </section>
              <details>
                <summary>Inspect local evidence candidates</summary>
                <ul className="extraction-page-list">
                  {evidenceLedger.ledger.candidates.slice(0, 100).map((candidate) => <li key={candidate.evidenceId}>
                    <button type="button" onClick={() => goToEvidenceCandidate(candidate.evidenceId)}>Go to Page {locateEvidenceCandidate(candidate, extraction.kind === 'ready' ? extraction.pages : [])?.pageIndex! + 1}</button>
                    {' '}{candidate.slot} · {candidate.section.title} · {candidate.precision} location · {candidate.quote.length > 180 ? `${candidate.quote.slice(0, 180)}…` : candidate.quote}
                  </li>)}
                  {evidenceLedger.ledger.candidates.length > 100 && <li>{evidenceLedger.ledger.candidates.length - 100} more candidates are not shown.</li>}
                  {evidenceLedger.ledger.candidates.length === 0 && <li>No reliable main-body text-item candidates were found. This does not establish that the paper lacks content.</li>}
                </ul>
              </details>
            </>}
        </section>}
        </aside>}
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
          <div ref={pdfPageRef} className="pdf-page" hidden={state.kind !== 'ready' && state.kind !== 'loading'} onClick={onPdfPageClick}>
            <canvas ref={canvasRef} aria-label="Rendered PDF page" />
            <div className="highlight-layer" aria-hidden="true">
              {visibleHighlights.flatMap((highlight) => highlight.rects.map((rect, index) => {
                if (!renderedHighlightViewport) return null;
                const [firstX, firstY] = renderedHighlightViewport.viewport.convertToViewportPoint(rect.left, rect.bottom);
                const [secondX, secondY] = renderedHighlightViewport.viewport.convertToViewportPoint(rect.right, rect.top);
                return <span
                  key={`${highlight.id}-${index}`}
                  className={`pdf-highlight pdf-highlight-${highlight.color}${highlight.id === activeHighlightId ? ' is-active' : ''}`}
                  style={{
                    left: `${Math.min(firstX, secondX)}px`,
                    top: `${Math.min(firstY, secondY)}px`,
                    width: `${Math.abs(secondX - firstX)}px`,
                    height: `${Math.abs(secondY - firstY)}px`,
                  }}
                />;
              }))}
            </div>
            <div ref={citationOverlayRef} className="citation-hit-layer" aria-label="Local numbered citations">
              {citationHitRegions.flatMap((region) => {
                const citation = citationForId(region.occurrenceId);
                if (!citation) return [];
                return region.rects.map((rect, index) => <button
                  type="button"
                  key={`${region.occurrenceId}-${index}`}
                  className="citation-hit-region"
                  data-citation-id={region.occurrenceId}
                  aria-label={`Open local citation ${citation.occurrence.displayMarker}; ${citation.occurrence.status}`}
                  title={`Open local citation ${citation.occurrence.displayMarker}`}
                  style={{ left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` }}
                  onClick={(clickEvent) => {
                    clickEvent.stopPropagation();
                    openCitation(region.occurrenceId, clickEvent.currentTarget);
                  }}
                />);
              })}
            </div>
            <div
              ref={textLayerRef}
              className="textLayer"
              aria-label="Selectable text from the rendered PDF page"
              onMouseUp={captureTextLayerSelection}
              onKeyUp={onTextLayerKeyUp}
            />
          </div>
        </section>
      </div>
      {activeCitation && <div
        ref={citationPopoverRef}
        className="citation-popover"
        role="dialog"
        aria-modal="false"
        aria-labelledby="citation-popover-title"
        tabIndex={-1}
        style={{ left: `${activeCitation.left}px`, top: `${activeCitation.top}px` }}
      >
        <div className="citation-popover-header">
          <h2 id="citation-popover-title">Local citation {activeCitation.occurrence.displayMarker}</h2>
          <button type="button" onClick={() => dismissCitationPopover()} aria-label="Close local citation">Close</button>
        </div>
        <p className={`citation-status citation-status-${activeCitation.occurrence.status}`}>{activeCitation.occurrence.status}</p>
        <p>{activeCitation.occurrence.caution}</p>
        <p className="citation-basis">Basis: {activeCitation.occurrence.basis.join(', ')}.</p>
        {activeCitation.references.length > 0
          ? <ol className="citation-reference-list">
            {activeCitation.references.map((reference) => <li key={reference.refId}>
              <p><strong>Reference [{reference.number}] candidate</strong> · Page {reference.anchor.pageIndex + 1}</p>
              <blockquote>{reference.rawText}</blockquote>
              <p className="citation-basis">Local candidate only: {reference.qualityWarnings.join(', ')}.</p>
              <div className="citation-actions">
                <button type="button" onClick={() => goToCitationReference(reference)}>Go to reference on Page {reference.anchor.pageIndex + 1}</button>
                {reference.sourceUrl
                  ? <a href={reference.sourceUrl} target="_blank" rel="noopener noreferrer">Open URL written in this entry</a>
                  : <span>No http(s) URL was found in this local entry.</span>}
              </div>
            </li>)}
          </ol>
          : <p className="citation-unresolved">No matching local Reference candidate was indexed for this marker. The marker remains {activeCitation.occurrence.status}; no bibliography fields were inferred.</p>}
        {citationIndex.kind === 'ready' && citationIndex.index.referenceHeading
          ? <button type="button" className="citation-references-button" onClick={goToCitationReferences}>Go to local References on Page {citationIndex.index.referenceHeading.anchor.pageIndex + 1}</button>
          : <p className="citation-unresolved">No local References heading is available to jump to.</p>}
      </div>}
      {translation && <section
        ref={translationPopoverRef}
        className="translation-popover"
        aria-labelledby="translation-popover-title"
        aria-live="polite"
        style={{ left: `${translation.left}px`, top: `${translation.top}px` }}
      >
        <div className="translation-popover-header">
          <h2 id="translation-popover-title">Translation to {translation.targetLanguage}</h2>
          <button type="button" onClick={closeTranslation} aria-label="Close translation">Close</button>
        </div>
        <p className="translation-source-label">Translation source</p>
        <blockquote className="translation-source">{translation.quote}</blockquote>
        {translation.sourceNotice && <p className="translation-source-notice" role="status">{translation.sourceNotice}</p>}
        {translation.status === 'preparing' && <p role="status">Requesting permission to contact the configured API…</p>}
        {translation.status === 'generating' && <p role="status">Translating the selected text… <button type="button" onClick={closeTranslation}>Cancel</button></p>}
        {translation.status === 'success' && translation.result && <>
          <p className="translation-source-label">Translation</p>
          <p className="translation-result">{translation.result.translation}</p>
          {translation.result.uncertainty && <p className="translation-uncertainty">Uncertainty: {translation.result.uncertainty}</p>}
          <div className="translation-actions"><button type="button" onClick={() => void copyTranslation()}>Copy translation</button></div>
        </>}
        {translation.status === 'error' && <p className="translation-error" role="alert">{translation.message} <a href="options.html">Open Settings</a></p>}
        {translation.message && translation.status === 'success' && <p role="status">{translation.message}</p>}
      </section>}
      {highlightToolbarPosition && (selectionDraft || activeHighlight) && <div
        ref={highlightToolbarRef}
        className="highlight-toolbar"
        role="toolbar"
        aria-label={selectionDraft ? 'Create text highlight' : 'Edit text highlight'}
        style={{ left: `${highlightToolbarPosition.left}px`, top: `${highlightToolbarPosition.top}px` }}
      >
        {selectionDraft ? <>
          <span className="highlight-toolbar-label">{selectionDraft.quote.length} selected characters</span>
          <label className="translation-target-label">Translate to
            <select value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value as 'Chinese' | 'English')} aria-label="Translation target language">
              <option value="Chinese">Chinese</option>
              <option value="English">English</option>
            </select>
          </label>
          <button type="button" className="translate-button" onMouseDown={(event) => event.preventDefault()} onClick={startTranslation}>Translate</button>
          <button type="button" className="highlight-create-button" onMouseDown={(event) => event.preventDefault()} onClick={() => createHighlight('yellow')}>Highlight</button>
          {HIGHLIGHT_COLORS.filter((color) => color.value !== 'yellow').map((color) => <button
            type="button"
            key={color.value}
            className={`highlight-color-button highlight-color-${color.value}`}
            aria-label={`Create ${color.label.toLowerCase()} highlight`}
            title={`Create ${color.label.toLowerCase()} highlight`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => createHighlight(color.value)}
          />)}
        </> : activeHighlight && <>
          <span className="highlight-toolbar-label">Edit highlight</span>
          {HIGHLIGHT_COLORS.map((color) => <button
            type="button"
            key={color.value}
            className={`highlight-color-button highlight-color-${color.value}${activeHighlight.color === color.value ? ' is-current' : ''}`}
            aria-label={`Change highlight to ${color.label.toLowerCase()}`}
            title={`Change highlight to ${color.label.toLowerCase()}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => updateActiveHighlightColor(color.value)}
          />)}
          <button type="button" className="highlight-delete-button" onMouseDown={(event) => event.preventDefault()} onClick={deleteActiveHighlight}>Delete</button>
        </>}
      </div>}
      <p className="reader-boundary">This reader accepts local or HTTPS PDFs up to 100 MiB and 500 pages, renders one page at a time, and searches PDF.js text only when text is available. It includes PDF-provided outlines, nearby-page thumbnails, and manual PDF-coordinate highlights saved locally by PDF content version. Highlights do not cross pages and do not add notes, citations, OCR, HTML import, AI features, cloud sync, PDF files, or extracted full text.</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
