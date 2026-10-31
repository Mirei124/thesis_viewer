import { extractPdfBibliography } from '../lib/pdfBibliography';
import { READER_BITMAP_BUDGET, bitmapBytes, selectReaderBitmaps, settleBitmapTask, releaseReaderBitmap, retireReaderBitmap } from '../lib/readerBitmap';
import { ReadingActivity, ReadingHistoryList } from '../components/ReadingHistory';
import { clearReadingHistory, readReadingHistory, recordReading, type ReadingHistoryEntry, type ReadingSnapshot, type ReadingSource } from '../lib/readingHistory';
import { extractPdfTitle } from '../lib/pdfTitle';
import { ReferenceCard } from '../components/ReferenceCard';
import { createRoot } from 'react-dom/client';
import { type ChangeEvent, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent as ReactPointerEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
import 'katex/dist/katex.min.css';
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
  type DetailedOverview,
  type DetailedOverviewSection,
  type DetailedSectionId,
} from '../lib/detailedOverview';
import { generateDetailedOverview } from '../lib/detailedOverviewPipeline';
import { createDetailedEvidenceLedger } from '../lib/structuredPaper';
import { inlineEvidenceLabel, inlineEvidenceParts, type VerifiedEvidenceRef } from '../lib/inlineEvidence';
import { buildInlineEvidenceExcerpts, type InlineExcerptGroup } from '../lib/inlineEvidenceExcerpts';
import { PdfLinkLayer } from '../components/PdfLinkLayer';
import { pdfDestinationPoint, resolvePdfLinkDestination } from '../lib/pdfLinks';
import { LimitedMath } from '../components/LimitedMath';
import {
  clearPdfHighlights,
  deletePdfHighlight,
  loadPdfHighlights,
  putPdfHighlight,
  type StoredPdfHighlight,
} from '../lib/pdfHighlightRepository';
import { DEFAULT_OVERVIEW_PREFERENCES, loadOverviewPreferences, type OverviewPreferences } from '../lib/overviewPreferences';
import { containsApiHostPermission, requestApiHostPermission } from '../lib/apiPermissions';
import { CompatibleProviderError, requestCompatibleCompletion, type CompatibleUsage } from '../lib/compatibleProvider';
import { summarizeInsightUsage } from '../lib/insightUsage';
import { loadApiKey, loadModelConfig, type ModelConfig } from '../lib/modelConfig';
import { parseTranslationResponse, translationMessages, type TranslationResult } from '../lib/translationResponse';
import { TRANSLATION_PROMPT_VERSION, translationSourceForSelection } from '../lib/translationContext';
import { cacheTranslation, loadCachedTranslation, type TranslationCacheInput } from '../lib/translationCache';
import { cacheVerifiedOverview, loadCachedOverview } from '../lib/overviewCache';
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
} from '../lib/urlPdfImport';
import { isArxivDirectPdfUrl } from '../lib/arxivPdfInterception';
import { parseReaderSourceFragment } from '../lib/readerSourceFragment';
import { replaceReaderSourceAddress } from '../lib/readerSourceAddress';
import { localPdfSourceKey, sha256Hex, type LocalPdfSourceKey } from '../lib/readerLocalSource';
import { useThemePreference } from '../components/ThemePreferenceControl';
import { useUiLocale } from '../components/LocalePreferenceControl';
import { message, type MessageKey } from '../lib/i18n';
import { readerFragmentErrorKey, readerModelErrorKey } from '../lib/readerUiErrors';
import { createReaderZoomPreferences, type ReaderZoomPreference } from '../lib/readerZoomPreferences';
import { bindPdfWheelZoom, type ZoomPointer, clampZoomScale, fittedZoomScale, manualZoomChoice, MAX_ZOOM_SCALE, MIN_ZOOM_SCALE, parseZoomPercentInput, shouldCommitZoomOnKeyDown, ZOOM_CHOICES, zoomChoiceMode, zoomChoiceScale, zoomPercentDisplay, type ZoomChoice, type ZoomMode } from '../lib/readerZoom';

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

type ReaderState =
  | { kind: 'idle' }
  | { kind: 'requesting-permission'; fileName: string }
  | { kind: 'loading'; fileName: string }
  | { kind: 'ready'; fileName: string; pageCount: number; pageIndex: number; scale: number; rotation: number }
  | { kind: 'cancelled'; message: ReaderUiText }
  | { kind: 'error'; message: ReaderUiText };

type ReaderUiText = string | { key: MessageKey; values?: Record<string, string | number> };
const uiText = (key: MessageKey, values?: Record<string, string | number>): ReaderUiText => ({ key, values });

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
  message?: ReaderUiText;
  sourceNotice?: ReaderUiText;
};

type OverviewState = {
  status: 'preparing' | 'generating' | 'success' | 'error';
  result?: ThreeLineOverview;
  message?: ReaderUiText;
};

type DetailedOverviewState = {
  status: 'preparing' | 'generating' | 'success' | 'error' | 'cancelled';
  completedSections?: readonly DetailedOverviewSection[];
  result?: DetailedOverview;
  /** Kept only for a completed click; never includes model/PDF text or secrets. */
  diagnostics?: DetailedOverviewDiagnostics;
  message?: ReaderUiText;
};

type DetailedOverviewSectionDiagnostic = {
  id: DetailedSectionId;
  /** Number of original paragraphs sent across this section’s batches. */
  newSourceCount: number;
  /** Number of paragraph aliases made available across this section’s batches. */
  availableAliasCount: number;
  batchCount?: number;
  semanticReviewEnabled?: boolean;
  formatRepairCount?: number;
  semanticReviewCount?: number;
  semanticReviewSkipped?: number;
  failures?: Array<{ reason: keyof typeof DETAILED_FAILURE_LABEL_KEYS; detail: string }>;
  warnings?: string[];
  usage?: CompatibleUsage;
};

type DetailedOverviewDiagnostics = {
  sections: DetailedOverviewSectionDiagnostic[];
};

type ReaderTranslate = (key: MessageKey, values?: Record<string, string | number>) => string;

function tokenCountLabel(value: number | undefined, t: ReaderTranslate): string | undefined {
  return value === undefined ? undefined : t('reader.tools.tokens', { count: value });
}

function insightTokenCount(value: number, complete: boolean, requestCount: number, locale: string): string {
  if (!complete && value === 0) return '—';
  const count = new Intl.NumberFormat(locale).format(value);
  return !complete && requestCount > 0 ? `≥${count}` : count;
}

function cacheRateLabel(usage: CompatibleUsage | undefined, t: ReaderTranslate): string | undefined {
  if (!usage) return undefined;
  const hit = usage.promptCacheHitTokens;
  const miss = usage.promptCacheMissTokens;
  if (hit === undefined && miss === undefined) return undefined;
  if (hit === undefined) return t('reader.tools.cacheMiss', { count: miss! });
  if (miss === undefined) return t('reader.tools.cacheHit', { count: hit });
  const total = hit + miss;
  return total === 0 ? t('reader.tools.cacheUnavailable') : t('reader.tools.cacheRate', { rate: Math.round((hit / total) * 100), hit, total });
}

function totalCacheRateLabel(diagnostics: DetailedOverviewDiagnostics, t: ReaderTranslate): string | undefined {
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
  return t('reader.tools.totalCacheRate', { rate: Math.round((hit / (hit + miss)) * 100), hit, total: hit + miss });
}

function evidenceCoverageLabel(coverage: EvidenceLedger['coverage'], t: ReaderTranslate): string {
  return t(coverage === 'full-text' ? 'reader.tools.fullText' : coverage === 'partial' ? 'reader.tools.partialText' : 'reader.tools.unreadableText');
}

function readerSessionId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `reader-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function translationJobId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `translation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const MAX_TRANSLATION_CHARACTERS = 4_000;
const UNGROUNDED_DETAILED_SECTION_FALLBACK = 'This section could not be safely grounded in the available PDF excerpts.';

function providerErrorMessage(error: CompatibleProviderError, subject: 'translation' | 'overview' | 'detailedOverview'): ReaderUiText {
  if (error.code === 'unauthorized') return uiText('reader.error.providerUnauthorized');
  if (error.code === 'not-found') return uiText('reader.error.providerNotFound');
  if (error.code === 'context-too-large') return uiText(subject === 'translation' ? 'reader.error.translationTooLarge' : 'reader.error.overviewTooLarge');
  if (error.code === 'rate-limited') return error.retryAfterSeconds === undefined
    ? uiText('reader.error.rateLimited')
    : uiText('reader.error.rateLimitedRetry', { seconds: error.retryAfterSeconds });
  if (error.code === 'network') return uiText('reader.error.providerNetwork');
  if (error.code === 'server-error') return uiText('reader.error.providerServer');
  if (error.code === 'invalid-response') return uiText(subject === 'translation' ? 'reader.error.translationInvalidResponse' : 'reader.error.overviewInvalidResponse');
  return uiText(subject === 'translation' ? 'reader.error.translationCancelled' : 'reader.error.overviewCancelled');
}

function translationErrorMessage(error: unknown): ReaderUiText {
  if (error instanceof CompatibleProviderError) {
    return providerErrorMessage(error, 'translation');
  }
  return uiText(readerModelErrorKey(error, 'translation'));
}

function sourceDegradationNotice(degradation: string | undefined): ReaderUiText | undefined {
  if (!degradation) return undefined;
  if (degradation.startsWith('Sentence expansion was unavailable')) return uiText('reader.translation.sourceNotReady');
  if (degradation.startsWith('Kept the original selection')) return uiText('reader.translation.sourceBoundaryUncertain');
  return uiText('reader.translation.sourceNotReady');
}

function overviewErrorMessage(error: unknown, subject: 'overview' | 'detailedOverview' = 'overview'): ReaderUiText {
  if (error instanceof CompatibleProviderError) {
    return providerErrorMessage(error, subject);
  }
  return uiText(readerModelErrorKey(error, 'overview'));
}

const DETAILED_FAILURE_LABEL_KEYS = {
  no_context: 'reader.insights.failureNoContext', model_unavailable: 'reader.insights.failureModelUnavailable',
  request: 'reader.insights.failureRequest', format: 'reader.insights.failureFormat',
  source: 'reader.insights.failureSource', budget: 'reader.insights.failureBudget',
} as const satisfies Record<string, MessageKey>;
const DETAILED_SECTION_LABEL_KEYS: Record<DetailedSectionId, MessageKey> = {
  problem_motivation: 'reader.insights.section.problem_motivation',
  method: 'reader.insights.section.method',
  contributions_novelty: 'reader.insights.section.contributions_novelty',
  experiments_ablations: 'reader.insights.section.experiments_ablations',
  limitations: 'reader.insights.section.limitations',
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

const HIGHLIGHT_COLORS: PdfHighlightColor[] = ['yellow', 'green', 'blue', 'pink'];

function readerError(error: unknown, stage: 'read' | 'open' | 'render'): ReaderUiText {
  if (error instanceof PasswordException || (error instanceof Error && error.name === 'PasswordException')) {
    return uiText('reader.error.passwordProtected');
  }
  if (error instanceof InvalidPDFException || (error instanceof Error && error.name === 'InvalidPDFException')) {
    return uiText('reader.error.invalidPdf');
  }
  return uiText(stage === 'read' ? 'reader.error.fileRead' : stage === 'render' ? 'reader.error.pdfRender' : 'reader.error.pdfLoad');
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

const MIN_SCALE = MIN_ZOOM_SCALE;
const MAX_SCALE = MAX_ZOOM_SCALE;
const SCALE_STEP = 0.25;
const THUMBNAIL_MAX_WIDTH = 144;
const THUMBNAIL_MAX_HEIGHT = 200;
const THUMBNAIL_SCALE = 0.24;
const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_PDF_PAGES = 500;
const VIEW_STORAGE_PREFIX = 'pdf-view:';
const VIEW_SAVE_DEBOUNCE_MS = 500;

type ViewState = Pick<Extract<ReaderState, { kind: 'ready' }>, 'pageIndex' | 'scale' | 'rotation'>;
type ReaderLocation = ViewState & { pageOffset: number; zoomMode: ZoomMode; zoomChoice: ZoomChoice };
type ReaderLocationHistory = { back: ReaderLocation[]; forward: ReaderLocation[] };
const LOCATION_HISTORY_LIMIT = 80;
const REMOTE_SOURCE_SCROLL_FALLBACK_MS = 180;
const PANEL_WIDTH_STORAGE_KEY = 'reader-panel-widths:v1';
type PanelSide = 'left' | 'right';
type PanelWidths = Record<PanelSide, number>;

function readPanelWidths(): PanelWidths {
  try {
    const value = JSON.parse(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY) || '{}') as Partial<PanelWidths>;
    const widths = {
      left: Number.isFinite(value.left) ? Math.min(520, Math.max(180, value.left!)) : 232,
      right: Number.isFinite(value.right) ? Math.min(560, Math.max(220, value.right!)) : 336,
    };
    if (window.innerWidth > 1100) {
      const available = window.innerWidth - 88 - 320;
      widths.left = Math.min(widths.left, available - 220);
      widths.right = Math.min(widths.right, available - widths.left);
    }
    return widths;
  } catch { return { left: 232, right: 336 }; }
}
type PdfOutlineItem = NonNullable<Awaited<ReturnType<PDFDocumentProxy['getOutline']>>>[number];
type OutlineState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; items: PdfOutlineItem[] }
  | { kind: 'unavailable'; message: ReaderUiText };
type AutoSectionState =
  | { kind: 'idle' }
  | { kind: 'identifying' }
  | { kind: 'ready'; candidates: PdfSectionCandidate[] }
  | { kind: 'error'; message: ReaderUiText };
type CitationIndexState =
  | { kind: 'idle' }
  | { kind: 'indexing' }
  | { kind: 'ready'; index: PdfLocalCitationIndex }
  | { kind: 'error'; message: ReaderUiText };
type EvidenceLedgerState =
  | { kind: 'idle' }
  | { kind: 'building' }
  | { kind: 'ready'; ledger: EvidenceLedger }
  | { kind: 'error'; message: ReaderUiText };
type Thumbnail = { kind: 'loading' } | { kind: 'ready'; src: string } | { kind: 'error' };
type SearchIndexState =
  | { kind: 'idle' }
  | { kind: 'indexing'; indexedPageCount: number; pageCount: number; failedPageCount: number; revision: number }
  | { kind: 'ready'; indexedPageCount: number; pageCount: number; failedPageCount: number; revision: number }
  | { kind: 'unavailable'; message: ReaderUiText }
  | { kind: 'error'; message: ReaderUiText };
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
  | { kind: 'error'; message: ReaderUiText };

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

function savedView(value: unknown, pageCount: number): SavedView | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as Partial<SavedView>;
  const { pageIndex, rotation } = candidate;
  if (typeof pageIndex !== 'number' || !Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pageCount) return undefined;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) return undefined;
  return { pageIndex, rotation };
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

function OutlineItems({ items, depth, onNavigate, label }: {
  items: PdfOutlineItem[];
  depth: number;
  onNavigate: (item: PdfOutlineItem) => void;
  label: (key: MessageKey, values?: Record<string, string | number>) => string;
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
            title={item.dest ? label('reader.outline.goTo', { title: item.title || label('reader.outline.untitled') }) : label('reader.outline.noDestinationTitle')}
          >
            {item.title || label('reader.outline.untitled')}
          </button>
          {item.items.length > 0 && <OutlineItems items={item.items} depth={depth + 1} onNavigate={onNavigate} label={label} />}
        </li>
      ))}
    </ul>
  );
}

type ReaderIconName = 'document' | 'search' | 'previous' | 'next' | 'minus' | 'plus' | 'generate' | 'rotate' | 'left' | 'right' | 'settings' | 'close' | 'more' | 'link' | 'outline' | 'pages' | 'insights' | 'tools' | 'historyBack' | 'historyForward' | 'reading';

function ReaderIcon({ name }: { name: ReaderIconName }) {
  const paths: Record<ReaderIconName, string> = {
    reading: 'M3 12a9 9 0 1 0 3-6.7M3 3v5h5M12 7v5l3 2',
    document: 'M6 3h8l4 4v14H6z M14 3v5h4 M9 12h6 M9 16h6',
    search: 'M20 20l-5-5 M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0',
    previous: 'M14 6l-6 6 6 6', next: 'M10 6l6 6-6 6',
    minus: 'M5 12h14', plus: 'M5 12h14 M12 5v14',
    generate: 'M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z',
    rotate: 'M19 8a8 8 0 1 0 1 8 M19 3v5h-5',
    left: 'M3 4h18v16H3z M8 4v16 M5 8h0 M5 12h0 M5 16h0',
    right: 'M3 4h18v16H3z M16 4v16 M19 8h0 M19 12h0 M19 16h0',
    settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
    close: 'M6 6l12 12 M18 6L6 18', more: 'M5 12h0 M12 12h0 M19 12h0',
    link: 'M10 14l4-4 M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0 M16 8l1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
    outline: 'M4 5h16 M4 10h10 M4 15h16 M4 20h10',
    pages: 'M8 3h12v15H8z M4 7v14h12',
    insights: 'M4 5h16 M4 10h16 M4 15h10 M4 20h13',
    tools: 'M14 5a5 5 0 0 0-6 6L3 16a3 3 0 0 0 5 5l5-5a5 5 0 0 0 6-6l-4 3-4-4z',
    historyBack: 'M8 5l-5 5 5 5 M3 10h10a6 6 0 0 1 0 12',
    historyForward: 'M16 5l5 5-5 5 M21 10H11a6 6 0 0 0 0 12',
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}

function ReaderPage() {
  // Theme changes apply only to CSS tokens and never reset PDF/AI state.
  useThemePreference();
  const [locale] = useUiLocale();
  const t = (key: MessageKey, values?: Record<string, string | number>) => message(locale, key, values);
  const display = (value: ReaderUiText | undefined) => value === undefined ? '' : typeof value === 'string' ? value : t(value.key, value.values);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const passivePageCanvasesRef = useRef(new Map<number, HTMLCanvasElement>());
  const pageRenderTasksRef = useRef(new Map<number, { cancel: () => void; promise: Promise<void> }>());
  const pageElementsRef = useRef(new Map<number, HTMLDivElement>());
  const stageRef = useRef<HTMLElement>(null);
  const activePageIndexRef = useRef(0);
  const zoomPreferencesRef = useRef(createReaderZoomPreferences(getLocalStorageArea));
  const zoomPreferenceRef = useRef<ReaderZoomPreference>({ mode: 'auto' });
  const zoomInteractionRef = useRef(0);
  const zoomModeRef = useRef<ZoomMode>('auto');
  const zoomChoiceRef = useRef<ZoomChoice>('auto');
  const zoomInputDirtyRef = useRef(false);
  const zoomMenuRef = useRef<HTMLDetailsElement>(null);
  const navigationScrollUntilRef = useRef(0);
  const locationHistoryRef = useRef<ReaderLocationHistory>({ back: [], forward: [] });
  const historyRestoreRef = useRef(0);
  const readerPageRef = useRef<HTMLElement>(null);
  const panelDragRef = useRef<{ side: PanelSide; pointerId: number; startX: number; startWidth: number } | null>(null);
  const [readingSnapshot, setReadingSnapshot] = useState<ReadingSnapshot>({ entries: [], activities: [] });
  const [readingLoading, setReadingLoading] = useState(true);
  const [readingError, setReadingError] = useState(false);
  const [readingNotice, setReadingNotice] = useState('');
  const readingEpochRef = useRef(0);
  const readingRefreshRef = useRef(0);
  const readingChannelRef = useRef<BroadcastChannel | null>(null);
  async function refreshReadingHistory() {
    const revision = ++readingRefreshRef.current;
    try { const snapshot = await readReadingHistory(); if (revision === readingRefreshRef.current) { setReadingSnapshot(snapshot); setReadingError(false); } } catch { if (revision === readingRefreshRef.current) setReadingError(true); } finally { if (revision === readingRefreshRef.current) setReadingLoading(false); }
  }
  useEffect(() => {
    void refreshReadingHistory();
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel('thesis-viewer-reading-history'); channel.onmessage = (event) => { if (event.data === 'clear') readingEpochRef.current += 1; void refreshReadingHistory(); }; readingChannelRef.current = channel; } catch { /* window focus fallback */ }
    const focus = () => { void refreshReadingHistory(); }; window.addEventListener('focus', focus);
    return () => { readingRefreshRef.current += 1; window.removeEventListener('focus', focus); channel?.close(); readingChannelRef.current = null; };
  }, []);
  async function clearSavedReadingHistory() {
    readingEpochRef.current += 1;
    try { await clearReadingHistory(); readingChannelRef.current?.postMessage('clear'); await refreshReadingHistory(); } catch { setReadingError(true); }
  }
  async function saveSuccessfulReading(pdf: PDFDocumentProxy, name: string, hash: string, source: ReadingSource, openedAt: number) {
    const epoch = readingEpochRef.current;
    const [title, bibliography] = await Promise.all([extractPdfTitle(pdf, name), extractPdfBibliography(pdf)]);
    if (epoch !== readingEpochRef.current) return;
    try { await recordReading({ hash, source, ...title, ...bibliography }, openedAt, () => epoch === readingEpochRef.current); readingChannelRef.current?.postMessage('record'); await refreshReadingHistory(); } catch { setReadingError(true); }
  }
  function openReadingEntry(entry: ReadingHistoryEntry) {
    if (entry.source.kind === 'local') { setReadingNotice(t('reader.reading.chooseAgain', { title: entry.title })); fileInputRef.current?.click(); return; }
    void importUrl({ preventDefault() {} } as FormEvent<HTMLFormElement>, entry.source.url);
  }
  function returnReaderHome() {
    const requestId = beginImport(); const address = new URL(window.location.href); address.hash = ''; address.searchParams.delete('arxivPdfUrl'); window.history.replaceState(null, '', address);
    setState({ kind: 'idle' }); setLeftRailOpen(false); setRightRailOpen(false); window.scrollTo(0, 0);
    void clearPreviousDocument().then(() => { if (isCurrent(requestId)) void refreshReadingHistory(); });
  }
  const readingListProps = { snapshot: readingSnapshot, loading: readingLoading, error: readingError, t, locale, onOpen: openReadingEntry, onClear: () => { void clearSavedReadingHistory(); } };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const pendingEvidenceRef = useRef<{ evidenceId: string; pageIndex: number; requestId: number } | null>(null);
  const evidenceVisualRef = useRef<{ element: HTMLElement; range: Range | null; timer: number } | null>(null);
  const pdfPageRef = useRef<HTMLDivElement>(null);
  const highlightToolbarRef = useRef<HTMLDivElement>(null);
  const translationPopoverRef = useRef<HTMLDivElement>(null);
  const citationPopoverRef = useRef<HTMLDivElement>(null);
  const citationOverlayRef = useRef<HTMLDivElement>(null);
  const citationTriggerRef = useRef<HTMLElement | null>(null);
  const loadingTaskRef = useRef<PDFDocumentLoadingTask | null>(null);
  const documentRef = useRef<PDFDocumentProxy | null>(null);
  const readerSourceRef = useRef<URL | LocalPdfSourceKey | null>(null);
  const pendingSourcePageRef = useRef<number | null>(null);
  const sourcePageSyncTimerRef = useRef<number | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<void> } | null>(null);
  const bitmapScheduleRef = useRef<() => void>(() => {});
  const [readerVisible, setReaderVisible] = useState(document.visibilityState !== 'hidden');
  const textLayerTaskRef = useRef<TextLayer | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationRequestRef = useRef(0);
  const automaticOverviewAttemptRef = useRef({ threeLine: false, detailed: false });
  const [overviewPreferences, setOverviewPreferences] = useState<OverviewPreferences | null>(null);
  const overviewAbortRef = useRef<AbortController | null>(null);
  const overviewRequestRef = useRef(0);
  const detailedOverviewAbortRef = useRef<AbortController | null>(null);
  const detailedOverviewRequestRef = useRef(0);
  const readerSessionIdRef = useRef(readerSessionId());
  const translationJobRef = useRef<{ jobId: string; documentVersion: string } | null>(null);
  const translationJobCreateRef = useRef<Promise<void> | null>(null);
  const modelConfigRef = useRef<ModelConfig | null>(null);
  const apiKeyRef = useRef<string | undefined>(undefined);
  const modelConfigLoadErrorRef = useRef<ReaderUiText | null>(null);
  const requestIdRef = useRef(0);
  const automaticArxivImportStartedRef = useRef(false);
  const renderIdRef = useRef(0);
  const thumbnailRequestIdRef = useRef(0);
  const thumbnailRenderTasksRef = useRef(new Set<{ cancel(): void; promise: Promise<void> }>());
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
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>('auto');
  const [zoomInputDraft, setZoomInputDraft] = useState('');
  const [zoomInputEditing, setZoomInputEditing] = useState(false);
  const [zoomInputInvalid, setZoomInputInvalid] = useState(false);
  const [historyRevision, setHistoryRevision] = useState(0);
  const [panelWidths, setPanelWidths] = useState(readPanelWidths);
  const [isRendering, setIsRendering] = useState(false);
  const [outline, setOutline] = useState<OutlineState>({ kind: 'idle' });
  const [outlineNotice, setOutlineNotice] = useState<ReaderUiText | ''>('');
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
  const detailedLedger = useMemo(() => evidenceLedger.kind === 'ready' && extraction.kind === 'ready'
    ? createDetailedEvidenceLedger(evidenceLedger.ledger, extraction.pages) : undefined, [evidenceLedger, extraction]);
  const [documentContentKey, setDocumentContentKey] = useState<string | null>(null);
  const [modelConfigEpoch, setModelConfigEpoch] = useState(0);
  const [viewStorageStatus, setViewStorageStatus] = useState<ReaderUiText | ''>('');
  const [viewRestoreEpoch, setViewRestoreEpoch] = useState(0);
  const [sessionHighlights, setSessionHighlights] = useState<SessionHighlight[]>([]);
  const [highlightStorageStatus, setHighlightStorageStatus] = useState<ReaderUiText | ''>('');
  const [selectionDraft, setSelectionDraft] = useState<SelectionDraft | null>(null);
  const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);
  const [renderedHighlightViewport, setRenderedHighlightViewport] = useState<RenderedHighlightViewport | null>(null);
  const [evidenceNavigationNotice, setEvidenceNavigationNotice] = useState<ReaderUiText | ''>('');
  const [activeCitation, setActiveCitation] = useState<ActiveCitation | null>(null);
  const [citationHitRegions, setCitationHitRegions] = useState<CitationHitRegion[]>([]);
  const [translation, setTranslation] = useState<TranslationState | null>(null);
  const [translationTarget, setTranslationTarget] = useState<'Chinese' | 'English'>('Chinese');
  const [savedTranslations, setSavedTranslations] = useState<StoredTranslationJob[]>([]);
  const [translationStorageStatus, setTranslationStorageStatus] = useState<ReaderUiText | ''>('');
  const [overview, setOverview] = useState<OverviewState | null>(null);
  const [detailedOverview, setDetailedOverview] = useState<DetailedOverviewState | null>(null);
  const evidenceDialogRef = useRef<HTMLDialogElement>(null);
  const evidenceTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [activeEvidence, setActiveEvidence] = useState<{ alias: string; category: string; count: number; groups: InlineExcerptGroup[] } | null>(null);
  useEffect(() => {
    const dialog = evidenceDialogRef.current;
    if (!activeEvidence || !dialog) return;
    dialog.showModal();
    return () => {
      dialog.close();
      if (evidenceTriggerRef.current?.isConnected) evidenceTriggerRef.current.focus();
    };
  }, [activeEvidence]);
  const [insightUsages, setInsightUsages] = useState<(CompatibleUsage | undefined)[]>([]);
  const insightUsage = summarizeInsightUsage(insightUsages);
  const [leftRailOpen, setLeftRailOpen] = useState(() => window.innerWidth > 1100);
  const [rightRailOpen, setRightRailOpen] = useState(() => window.innerWidth > 1100);
  const [leftRailTab, setLeftRailTab] = useState<'outline' | 'pages' | 'reading'>('outline');
  const [rightRailTab, setRightRailTab] = useState<'overview' | 'search' | 'tools'>('overview');

  useEffect(() => {
    const clampForViewport = () => {
      if (window.innerWidth <= 1100 || !leftRailOpen || !rightRailOpen) return;
      const available = window.innerWidth - 88 - 320;
      setPanelWidths((current) => {
        if (current.left + current.right <= available) return current;
        const left = Math.min(current.left, available - 220);
        return { left, right: Math.min(current.right, available - left) };
      });
    };
    clampForViewport();
    window.addEventListener('resize', clampForViewport);
    return () => window.removeEventListener('resize', clampForViewport);
  }, [leftRailOpen, rightRailOpen, panelWidths]);

  function toggleRail(side: 'left' | 'right', open: boolean) {
    if (side === 'left') setLeftRailOpen(open);
    else setRightRailOpen(open);
    if (open && window.innerWidth <= 1100) {
      if (side === 'left') setRightRailOpen(false);
      else setLeftRailOpen(false);
    }
  }

  function openRailTab(side: 'left' | 'right', tab: string, toggle = false) {
    if (side === 'left') {
      const nextTab = tab as typeof leftRailTab;
      toggleRail('left', !(toggle && leftRailOpen && leftRailTab === nextTab));
      setLeftRailTab(nextTab);
    } else {
      const nextTab = tab as typeof rightRailTab;
      toggleRail('right', !(toggle && rightRailOpen && rightRailTab === nextTab));
      setRightRailTab(nextTab);
    }
  }

  function closeRail(side: 'left' | 'right') {
    toggleRail(side, false);
    document.getElementById(`${side}-${side === 'left' ? leftRailTab : rightRailTab}-tab`)?.focus();
  }

  function onRailTabKeyDown(event: KeyboardEvent<HTMLElement>, side: 'left' | 'right') {
    const tabs = side === 'left' ? ['outline', 'pages', 'reading'] : ['overview', 'search', 'tools'];
    const current = side === 'left' ? leftRailTab : rightRailTab;
    if (event.key === 'Escape') { event.preventDefault(); closeRail(side); return; }
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(current) + (event.key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length;
    openRailTab(side, tabs[index]);
    document.getElementById(`${side}-${tabs[index]}-tab`)?.focus();
  }

  function panelWidthLimits(side: PanelSide) {
    const rail = window.innerWidth <= 660 ? 40 : 44;
    const minimum = side === 'left' ? 180 : 220;
    const maximum = side === 'left' ? 520 : 560;
    const overlay = window.innerWidth <= 1100;
    const other = side === 'left' ? (rightRailOpen ? panelWidths.right : 0) : (leftRailOpen ? panelWidths.left : 0);
    const room = overlay ? window.innerWidth - 2 * rail - 8 : window.innerWidth - 2 * rail - other - 320;
    return { min: Math.min(minimum, Math.max(120, room)), max: Math.max(120, Math.min(maximum, room)) };
  }

  function setPanelWidth(side: PanelSide, width: number) {
    const { min, max } = panelWidthLimits(side);
    const next = Math.max(min, Math.min(max, width));
    readerPageRef.current?.style.setProperty(`--${side}-panel-width`, `${next}px`);
    return next;
  }

  function startPanelResize(side: PanelSide, event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.currentTarget;
    handle.setPointerCapture(event.pointerId);
    panelDragRef.current = { side, pointerId: event.pointerId, startX: event.clientX, startWidth: panelWidths[side] };
    document.documentElement.classList.add('is-resizing-rail');
  }

  function movePanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = (event.clientX - drag.startX) * (drag.side === 'left' ? 1 : -1);
    const width = setPanelWidth(drag.side, drag.startWidth + delta);
    event.currentTarget.setAttribute('aria-valuenow', String(width));
  }

  function endPanelResize(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = panelDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    panelDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    document.documentElement.classList.remove('is-resizing-rail');
    const width = parseFloat(readerPageRef.current?.style.getPropertyValue(`--${drag.side}-panel-width`) || String(panelWidths[drag.side]));
    const next = { ...panelWidths, [drag.side]: width };
    setPanelWidths(next);
    try { window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(next)); } catch { /* A non-persistent resize remains usable. */ }
    if (zoomModeRef.current !== 'manual') window.requestAnimationFrame(() => recomputeFittedZoom());
  }

  function onPanelResizeKeyDown(side: PanelSide, event: KeyboardEvent<HTMLDivElement>) {
    const limits = panelWidthLimits(side);
    const direction = side === 'left' ? 1 : -1;
    const next = event.key === 'Home' ? limits.min : event.key === 'End' ? limits.max
      : event.key === 'ArrowRight' ? panelWidths[side] + 16 * direction
      : event.key === 'ArrowLeft' ? panelWidths[side] - 16 * direction : null;
    if (next === null) return;
    event.preventDefault();
    const width = setPanelWidth(side, next);
    const widths = { ...panelWidths, [side]: width };
    setPanelWidths(widths);
    try { window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, JSON.stringify(widths)); } catch { /* Keep the live width. */ }
  }

  useEffect(() => () => {
    document.documentElement.classList.remove('is-resizing-rail');
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
    void releaseDocumentResources();
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
    let active = true;
    let revision = 0;
    const refresh = () => {
      const current = ++revision;
      void Promise.all([loadModelConfig(), loadApiKey()]).then(([config, key]) => {
        if (!active || current !== revision) return;
        modelConfigRef.current = config;
        apiKeyRef.current = key.apiKey;
        modelConfigLoadErrorRef.current = null;
        setModelConfigEpoch((epoch) => epoch + 1);
      }).catch(() => {
        if (!active || current !== revision) return;
        modelConfigLoadErrorRef.current = uiText('reader.error.modelSettingsLoad');
        setModelConfigEpoch((epoch) => epoch + 1);
      });
    };
    refresh();
    // Returning from settings applies the review choice to the next generation.
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, []);

  useEffect(() => {
    refreshOverviewPreferences(requestIdRef.current);
  }, []);

  function refreshOverviewPreferences(documentToken: number) {
    setOverviewPreferences(null);
    void (async () => {
      let preferences: OverviewPreferences;
      try { preferences = await loadOverviewPreferences(); }
      catch { preferences = DEFAULT_OVERVIEW_PREFERENCES; }
      if (documentToken === requestIdRef.current) setOverviewPreferences(preferences);
    })();
  }

  // Each overview restores independently, including while the other is running or failed.
  useEffect(() => {
    const config = modelConfigRef.current;
    if (!modelConfigEpoch || overview || !documentContentKey || extraction.kind !== 'ready' || evidenceLedger.kind !== 'ready') return;
    if (evidenceLedger.ledger.documentVersion !== `sha256:${documentContentKey}`) return;
    const documentToken = requestIdRef.current;
    const requestToken = overviewRequestRef.current;
    let cancelled = false;
    void (async () => {
      const restored = config ? await loadCachedOverview({ documentContentKey, kind: 'three-line', config }, evidenceLedger.ledger, extraction.pages).catch(() => undefined) : undefined;
      if (cancelled || documentToken !== requestIdRef.current || requestToken !== overviewRequestRef.current) return;
      if (restored?.kind === 'three_line') {
        setOverview({ status: 'success', result: restored });
        return;
      }
      if (!overviewPreferences?.threeLine || automaticOverviewAttemptRef.current.threeLine) return;
      automaticOverviewAttemptRef.current.threeLine = true;
      startThreeLineOverview('automatic');
    })();
    return () => { cancelled = true; };
  }, [documentContentKey, extraction, evidenceLedger, modelConfigEpoch, overviewPreferences, overview]);

  useEffect(() => {
    const config = modelConfigRef.current;
    if (!modelConfigEpoch || detailedOverview || !documentContentKey || extraction.kind !== 'ready' || evidenceLedger.kind !== 'ready') return;
    if (evidenceLedger.ledger.documentVersion !== `sha256:${documentContentKey}`) return;
    const documentToken = requestIdRef.current;
    const requestToken = detailedOverviewRequestRef.current;
    let cancelled = false;
    void (async () => {
      const restored = config ? await loadCachedOverview({ documentContentKey, kind: 'detailed', config }, detailedLedger ?? evidenceLedger.ledger, extraction.pages).catch(() => undefined) : undefined;
      if (cancelled || documentToken !== requestIdRef.current || requestToken !== detailedOverviewRequestRef.current) return;
      if (restored?.kind === 'detailed') {
        setDetailedOverview({ status: 'success', result: restored });
        return;
      }
      if (!overviewPreferences?.detailed || automaticOverviewAttemptRef.current.detailed) return;
      automaticOverviewAttemptRef.current.detailed = true;
      startDetailedOverview('automatic');
    })();
    return () => { cancelled = true; };
  }, [documentContentKey, extraction, evidenceLedger, modelConfigEpoch, overviewPreferences, detailedOverview, detailedLedger]);

  useEffect(() => {
    if (state.kind !== 'ready' || !documentContentKey || !viewRestoreReadyRef.current) return;
    const storage = getLocalStorageArea();
    if (!storage) {
      setViewStorageStatus(uiText('reader.view.storageUnavailable'));
      return;
    }
    if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    const savedSession = viewSessionRef.current;
    const view: SavedView = { pageIndex: state.pageIndex, rotation: state.rotation };
    viewSaveTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          await storage.set({ [`${VIEW_STORAGE_PREFIX}${documentContentKey}`]: view });
          if (savedSession === viewSessionRef.current) setViewStorageStatus(uiText('reader.view.saved'));
        } catch {
          if (savedSession === viewSessionRef.current) {
            setViewStorageStatus(uiText('reader.view.saveFailed'));
          }
        }
      })();
    }, VIEW_SAVE_DEBOUNCE_MS);
    return () => {
      if (viewSaveTimerRef.current) clearTimeout(viewSaveTimerRef.current);
    };
  }, [documentContentKey, state, viewRestoreEpoch]);

  async function clearPreviousDocument() {
    pendingEvidenceRef.current = null;
    clearEvidenceVisual();
    setEvidenceNavigationNotice('');
    renderIdRef.current += 1;
    renderTaskRef.current?.cancel();
    renderTaskRef.current = null;
    textLayerTaskRef.current?.cancel();
    textLayerTaskRef.current = null;
    await releaseDocumentResources();
    textLayerRef.current?.replaceChildren();
    setRenderedHighlightViewport(null);
  }

  async function releaseDocumentResources() {
    renderIdRef.current += 1;
    textLayerTaskRef.current?.cancel();
    const loading = loadingTaskRef.current;
    const pdf = documentRef.current;
    loadingTaskRef.current = null;
    documentRef.current = null;
    thumbnailRequestIdRef.current += 1;
    const canvases = [...passivePageCanvasesRef.current.values()];
    await Promise.all([...thumbnailRenderTasksRef.current].map(settleBitmapTask));
    thumbnailRenderTasksRef.current.clear();
    const entries = [...pageRenderTasksRef.current.entries()];
    await Promise.all(entries.map(async ([index, task]) => {
      await settleBitmapTask(task);
      if (pageRenderTasksRef.current.get(index) === task) pageRenderTasksRef.current.delete(index);
    }));
    for (const canvas of canvases) releaseReaderBitmap(canvas);
    // LoadingTask.destroy owns its document/worker; cleanup must not race it.
    if (loading) await loading.destroy().catch(() => undefined);
    else if (pdf) await pdf.cleanup().catch(() => undefined);
  }

  function isCurrent(requestId: number) {
    return requestId === requestIdRef.current;
  }

  function clearBrowserSelection() {
    window.getSelection()?.removeAllRanges();
  }

  function clearEvidenceVisual() {
    const visual = evidenceVisualRef.current;
    if (!visual) return;
    window.clearTimeout(visual.timer);
    visual.element.classList.remove('evidence-source-block', 'evidence-source-page');
    const selection = window.getSelection();
    if (visual.range && selection?.rangeCount && selection.getRangeAt(0) === visual.range) selection.removeAllRanges();
    evidenceVisualRef.current = null;
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
    setTranslationStorageStatus(uiText('reader.translation.restoringSaved'));
    try {
      // An active checkpoint cannot safely survive a reader reload: do not
      // resume it or send another model request.
      await interruptActiveTranslationJobs(documentVersion);
      const restored = await loadSuccessfulTranslationJobs(documentVersion);
      if (session !== highlightStorageSessionRef.current || highlightDocumentKeyRef.current !== contentKey) return;
      setSavedTranslations(restored);
      setTranslationStorageStatus(restored.length === 0
        ? uiText('reader.translation.noneSaved')
        : uiText('reader.translation.restoredCount', { count: restored.length }));
    } catch {
      if (session === highlightStorageSessionRef.current) {
        setTranslationStorageStatus(uiText('reader.translation.restoreFailed'));
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
      sourceNotice: uiText('reader.translation.restoredNotice'),
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
    else setHighlightStorageStatus(uiText('reader.highlight.sessionOnly'));
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

  function queueHighlightMutation(session: number, operation: () => Promise<void>, success: ReaderUiText) {
    setHighlightStorageStatus(uiText('reader.highlight.saving'));
    const next = highlightMutationQueueRef.current.catch(() => undefined).then(operation);
    highlightMutationQueueRef.current = next;
    void next.then(() => {
      if (session === highlightStorageSessionRef.current) setHighlightStorageStatus(success);
    }).catch(() => {
      if (session === highlightStorageSessionRef.current) {
        setHighlightStorageStatus(uiText('reader.highlight.saveFailed'));
      }
    });
  }

  function saveHighlight(highlight: SessionHighlight, session: number) {
    queueHighlightMutation(session, () => putPdfHighlight(toStoredHighlight(highlight)), uiText('reader.highlight.saved'));
  }

  function removeHighlight(id: string, session: number) {
    queueHighlightMutation(session, () => deletePdfHighlight(id), uiText('reader.highlight.deleteSaved'));
  }

  function clearCurrentDocumentHighlights() {
    if (!documentContentKey) return;
    const session = highlightStorageSessionRef.current;
    highlightRevisionRef.current += 1;
    highlightClearRequestedRef.current = true;
    setSessionHighlights([]);
    setActiveHighlightId(null);
    setSelectionDraft(null);
    queueHighlightMutation(session, () => clearPdfHighlights(`sha256:${documentContentKey}`), uiText('reader.highlight.cleared'));
  }

  async function restoreSavedHighlights(contentKey: string, session: number) {
    const documentVersion = `sha256:${contentKey}`;
    const restoreRevision = highlightRevisionRef.current;
    setHighlightStorageStatus(uiText('reader.highlight.restoring'));
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
      setHighlightStorageStatus(restored.length === 0 ? uiText('reader.highlight.noneSaved') : uiText('reader.highlight.restoredCount', { count: restored.length }));
    } catch {
      if (session === highlightStorageSessionRef.current && highlightDocumentKeyRef.current === contentKey) {
        setHighlightStorageStatus(uiText('reader.highlight.restoreFailed'));
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
      if (translation && (!target || !translationPopoverRef.current?.contains(target))) closeTranslation();
      if (target && (citationPopoverRef.current?.contains(target) || (target instanceof Element && target.closest('[data-citation-id]')))) return;
      if (activeCitation) dismissCitationPopover();
      // The PDF page is outside the toolbar too. Clear the old selection before
      // native pointer handling starts a new one; mouseup can capture that new selection.
      if (target && (highlightToolbarRef.current?.contains(target) || translationPopoverRef.current?.contains(target))) return;
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
        message: uiText('reader.translation.tooManyCharacters', { count: characterCount, limit: MAX_TRANSLATION_CHARACTERS }),
        sourceNotice: sourceDegradationNotice(source.degradation),
      });
      setSelectionDraft(null);
      clearBrowserSelection();
      return;
    }
    const config = modelConfigRef.current;
    const generationApiKey = apiKeyRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setTranslation({
        quote: draft.quote,
        targetLanguage: translationTarget,
        ...position,
        status: 'error',
        message: modelConfigLoadErrorRef.current ?? uiText('reader.translation.configureModel'),
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
    const sourceNotice = sourceDegradationNotice(source.degradation) ?? (source.expanded ? uiText('reader.translation.expandedSource') : undefined);
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
        if (requestToken === translationRequestRef.current) setTranslationStorageStatus(uiText('reader.translation.saveUnavailable'));
      });
    } else {
      setTranslationStorageStatus(uiText('reader.translation.noVersion'));
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
          message: uiText(permission.reason === 'denied' ? 'reader.translation.permissionDenied' : 'reader.error.apiPermissionUnavailable'),
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
            setTranslation((current) => current && ({ ...current, status: 'success', result: cached, message: uiText('reader.translation.cached') }));
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
          apiKey: generationApiKey,
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
            if (requestToken === translationRequestRef.current) setTranslationStorageStatus(uiText('reader.translation.saveFailed'));
          });
          if (translationJobRef.current?.jobId === job.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
        }
        setTranslation((current) => current && ({ ...current, status: 'success', result }));
      } catch (error) {
        if (requestToken !== translationRequestRef.current || controller.signal.aborted) return;
        const message = translationErrorMessage(error);
        if (job) void persistJobUpdate('failed', { error: display(message) }).catch(() => undefined);
        if (translationJobRef.current?.jobId === job?.jobId) { translationJobRef.current = null; translationJobCreateRef.current = null; }
        setTranslation((current) => current && ({ ...current, status: 'error', message }));
      }
    })();
  }

  async function copyTranslation() {
    if (!translation?.result) return;
    try {
      await navigator.clipboard.writeText(translation.result.translation);
      setTranslation((current) => current?.result ? { ...current, message: uiText('reader.translation.copied') } : current);
    } catch {
      setTranslation((current) => current?.result ? { ...current, message: uiText('reader.translation.copyFailed') } : current);
    }
  }

  function startThreeLineOverview(trigger: 'manual' | 'automatic' = 'manual') {
    automaticOverviewAttemptRef.current.threeLine = true;
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    if (evidenceLedger.ledger.candidates.length === 0) {
      setOverview({ status: 'error', message: uiText('reader.insights.noEvidence') });
      return;
    }
    const config = modelConfigRef.current;
    const generationApiKey = apiKeyRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setOverview({ status: 'error', message: trigger === 'automatic' ? uiText('reader.insights.autoUnavailable') : modelConfigLoadErrorRef.current ?? uiText('reader.insights.configureModel') });
      return;
    }
    // Keep permission invocation in the click call stack so browsers retain
    // the user gesture. The ledger itself is the only source supplied later.
    const permissionRequest = trigger === 'automatic' ? containsApiHostPermission(config.baseUrl) : requestApiHostPermission(config.baseUrl);
    const requestToken = ++overviewRequestRef.current;
    overviewAbortRef.current?.abort();
    const controller = new AbortController();
    overviewAbortRef.current = controller;
    const ledger = evidenceLedger.ledger;
    const pages = extraction.pages;
    const contentKey = documentContentKey;
    const documentRequestId = requestIdRef.current;
    // The packet and its private alias mapping are request-local. Construct it
    // once for this user-triggered request so the response cannot be resolved
    // against a packet from another PDF or earlier attempt.
    const packet = threeLineEvidencePacket(ledger, pages);
    setOverview({ status: 'preparing' });
    void (async () => {
      const permission = await permissionRequest;
      if (requestToken !== overviewRequestRef.current) return;
      if (!permission.granted) {
        setOverview({ status: 'error', message: trigger === 'automatic' ? uiText('reader.insights.autoUnavailable') : uiText(permission.reason === 'denied' ? 'reader.insights.permissionDenied' : 'reader.error.apiPermissionUnavailable') });
        return;
      }
      setOverview({ status: 'generating' });
      try {
        const response = await requestCompatibleCompletion({
          config,
          apiKey: generationApiKey,
          messages: threeLineOverviewMessages(packet),
          signal: controller.signal,
        });
        if (requestToken !== overviewRequestRef.current || controller.signal.aborted) return;
        setInsightUsages((current) => [...current, response.usage]);
        const result = validateThreeLineOverview(parseThreeLineOverview(response.content), packet, ledger, pages);
        if (requestToken !== overviewRequestRef.current || controller.signal.aborted) return;
        setOverview({ status: 'success', result });
        if (contentKey && documentRequestId === requestIdRef.current) {
          void cacheVerifiedOverview({ documentContentKey: contentKey, kind: 'three-line', config }, result, ledger, pages).catch(() => undefined);
        }
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

  function startDetailedOverview(trigger: 'manual' | 'automatic' = 'manual') {
    automaticOverviewAttemptRef.current.detailed = true;
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    if (evidenceLedger.ledger.candidates.length === 0) {
      setDetailedOverview({ status: 'error', message: uiText('reader.insights.noDetailedEvidence') });
      return;
    }
    const config = modelConfigRef.current;
    const generationApiKey = apiKeyRef.current;
    if (!config || !config.baseUrl || !config.model) {
      setDetailedOverview({ status: 'error', message: trigger === 'automatic' ? uiText('reader.insights.autoUnavailable') : modelConfigLoadErrorRef.current ?? uiText('reader.insights.configureDetailedModel') });
      return;
    }
    const permissionRequest = trigger === 'automatic' ? containsApiHostPermission(config.baseUrl) : requestApiHostPermission(config.baseUrl);
    const requestToken = ++detailedOverviewRequestRef.current;
    detailedOverviewAbortRef.current?.abort();
    const controller = new AbortController();
    detailedOverviewAbortRef.current = controller;
    const ledger = detailedLedger ?? evidenceLedger.ledger;
    const pages = extraction.pages;
    const contentKey = documentContentKey;
    const documentRequestId = requestIdRef.current;
    const isCurrentGeneration = () => requestToken === detailedOverviewRequestRef.current && documentRequestId === requestIdRef.current && !controller.signal.aborted;
    setDetailedOverview({ status: 'preparing' });
    void (async () => {
      const permission = await permissionRequest;
      if (!isCurrentGeneration()) return;
      if (!permission.granted) {
        setDetailedOverview({ status: 'error', message: trigger === 'automatic' ? uiText('reader.insights.autoUnavailable') : uiText(permission.reason === 'denied' ? 'reader.insights.detailedPermissionDenied' : 'reader.error.apiPermissionUnavailable') });
        return;
      }
      setDetailedOverview({ status: 'generating' });
      try {
        // Give the browser a paint opportunity before rebuilding document structure.
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        const { result, diagnostics } = await generateDetailedOverview({
          ledger, pages, config, signal: controller.signal,
          request: (request) => requestCompatibleCompletion({ ...request, apiKey: generationApiKey }),
          onSectionComplete: (completedSections) => {
            if (isCurrentGeneration()) setDetailedOverview({ status: 'generating', completedSections });
          },
          onUsage: (usage) => {
            if (isCurrentGeneration()) {
              setInsightUsages((current) => [...current, usage]);
            }
          },
        });
        if (!isCurrentGeneration()) return;
        setDetailedOverview({ status: 'success', result, diagnostics: { sections: diagnostics } });
        if (contentKey && documentRequestId === requestIdRef.current) {
          void cacheVerifiedOverview({ documentContentKey: contentKey, kind: 'detailed', config }, result, ledger, pages).catch(() => undefined);
        }
      } catch (error) {
        if (!isCurrentGeneration()) return;
        setDetailedOverview((current) => ({ ...current, status: 'error', message: overviewErrorMessage(error) }));
      }
    })();
  }

  function cancelDetailedOverview() {
    detailedOverviewRequestRef.current += 1;
    detailedOverviewAbortRef.current?.abort();
    detailedOverviewAbortRef.current = null;
    setDetailedOverview((current) => current ? { ...current, status: 'cancelled' } : null);
  }

  function beginImport() {
    automaticOverviewAttemptRef.current = { threeLine: false, detailed: false };
    setInsightUsages([]);
    setCurrentZoomChoice('auto');
    historyRestoreRef.current += 1;
    locationHistoryRef.current = { back: [], forward: [] };
    setHistoryRevision((revision) => revision + 1);
    clearPendingSourcePageSync();
    readerSourceRef.current = null;
    invalidateTranslation();
    cancelThreeLineOverview();
    cancelDetailedOverview();
    setDetailedOverview(null);
    setActiveEvidence(null);
    requestIdRef.current += 1;
    refreshOverviewPreferences(requestIdRef.current);
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
        : { kind: 'unavailable', message: uiText('reader.outline.unavailable') });
    } catch {
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      setOutline({ kind: 'unavailable', message: uiText('reader.outline.readError') });
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
          message: uiText(failedPageCount > 0 ? 'reader.search.noExtractable' : 'reader.search.scan'),
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
              setEvidenceLedger({ kind: 'error', message: uiText('reader.evidence.prepareFailed') });
            }
          }
        } catch {
          if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
            setAutoSections({ kind: 'error', message: uiText('reader.outline.inspectionError') });
            setEvidenceLedger({ kind: 'error', message: uiText('reader.evidence.sectionFailed') });
          }
        }
        try {
          const index = pdfLocalCitationIndexFromPages(pages, documentVersion);
          if (extractionRequestId !== extractionRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
          setCitationIndex({ kind: 'ready', index });
        } catch {
          if (extractionRequestId === extractionRequestIdRef.current && isCurrent(requestId) && documentRef.current === pdf) {
            setCitationIndex({ kind: 'error', message: uiText('reader.citation.indexFailed') });
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
    setOutlineNotice(uiText('reader.outline.resolving'));
    try {
      const destination = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!destination?.[0] || typeof destination[0] !== 'object') {
        setOutlineNotice(uiText('reader.outline.noDestination', { title: item.title || t('reader.outline.thisEntry') }));
        return;
      }
      const pageIndex = await pdf.getPageIndex(destination[0]);
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) {
        setOutlineNotice(uiText('reader.outline.invalidDestination', { title: item.title || t('reader.outline.thisEntry') }));
        return;
      }
      setOutlineNotice('');
      goToPage(pageIndex);
    } catch {
      if (isCurrent(requestId) && documentRef.current === pdf) {
        setOutlineNotice(uiText('reader.outline.resolveError', { title: item.title || t('reader.outline.thisEntry') }));
      }
    }
  }

  function navigateAutoSection(candidate: PdfSectionCandidate) {
    if (state.kind !== 'ready') return;
    setOutlineNotice(uiText('reader.outline.automaticNotice', { title: candidate.title, page: candidate.pageIndex + 1 }));
    goToPage(candidate.pageIndex);
  }

  useEffect(() => {
    if (state.kind !== 'ready' || !documentRef.current || !readerVisible || !leftRailOpen || leftRailTab !== 'pages') return;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    const thumbnailRequestId = ++thumbnailRequestIdRef.current;
    // Pages rail is a complete, scrollable document index. Render each
    // preview sequentially so it remains usable without an arbitrary
    // three-page window.
    const indices = Array.from({ length: state.pageCount }, (_, pageIndex) => pageIndex);
    let cancelled = false;
    const renderTasks = new Set<{ cancel: () => void }>();

    setThumbnails((previous) => Object.fromEntries(indices.map((pageIndex) => [
      pageIndex,
      previous[pageIndex] ?? { kind: 'loading' },
    ])));

    async function renderThumbnail(pageIndex: number) {
      let canvas: HTMLCanvasElement | undefined;
      try {
        const page = await pdf.getPage(pageIndex + 1);
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const fullSize = page.getViewport({ scale: 1 });
        const scale = Math.min(THUMBNAIL_SCALE, THUMBNAIL_MAX_WIDTH / fullSize.width, THUMBNAIL_MAX_HEIGHT / fullSize.height);
        const viewport = page.getViewport({ scale });
        canvas = document.createElement('canvas');
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        const renderTask = page.render({ canvas, canvasContext: context, viewport });
        renderTasks.add(renderTask);
        thumbnailRenderTasksRef.current.add(renderTask);
        try { await renderTask.promise; }
        finally {
          renderTasks.delete(renderTask);
          thumbnailRenderTasksRef.current.delete(renderTask);
        }
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        const src = canvas.toDataURL('image/png');
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'ready', src } }));
      } catch {
        if (cancelled || thumbnailRequestId !== thumbnailRequestIdRef.current || !isCurrent(requestId) || documentRef.current !== pdf) return;
        setThumbnails((previous) => ({ ...previous, [pageIndex]: { kind: 'error' } }));
      } finally {
        if (canvas) releaseReaderBitmap(canvas);
      }
    }

    void (async () => {
      for (const pageIndex of indices) {
        if (cancelled) return;
        if (!thumbnails[pageIndex] || thumbnails[pageIndex].kind === 'loading') await renderThumbnail(pageIndex);
      }
    })();
    return () => {
      cancelled = true;
      renderTasks.forEach((task) => task.cancel());
    };
  // `thumbnailSession` changes after each successfully loaded document, even when its filename and first page match the prior document.
  }, [state.kind, thumbnailSession, readerVisible, leftRailOpen, leftRailTab]);

  // Retain lightweight page geometry, but allocate bitmaps only near the viewport.
  useEffect(() => {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const view = state;
    const isHidden = () => document.visibilityState === 'hidden';
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    let disposed = false;
    let revision = 0;
    let running = false;
    let frame = 0;
    let hiddenTimer: ReturnType<typeof setTimeout> | undefined;
    let wanted = new Set<number>();
    async function release(index: number, force = false, pageExiting = false) {
      const canvas = passivePageCanvasesRef.current.get(index);
      if (!canvas) return;
      const epoch = revision;
      const task = pageRenderTasksRef.current.get(index);
      const retired = await retireReaderBitmap(canvas, task, () => {
        if (documentRef.current !== pdf || passivePageCanvasesRef.current.get(index) !== canvas) return false;
        const currentTask = pageRenderTasksRef.current.get(index);
        if (currentTask && currentTask !== task) return false;
        if (force) return epoch === revision && (pageExiting || isHidden());
        return !disposed && !wanted.has(index) && index !== activePageIndexRef.current;
      });
      if (pageRenderTasksRef.current.get(index) === task) pageRenderTasksRef.current.delete(index);
      if (retired && !disposed && documentRef.current === pdf) void pdf.getPage(index + 1).then((page) => {
        if (!pageRenderTasksRef.current.has(index) && !wanted.has(index) && documentRef.current === pdf) page.cleanup();
      }).catch(() => undefined);
    }
    function candidates() {
      // Zero-sized, not-yet-measured canvases must never make every collapsed
      // page look visible during the initial React commit.
      const geometries = [...pageElementsRef.current].filter(([index]) => {
        const canvas = passivePageCanvasesRef.current.get(index);
        return !!canvas && parseFloat(canvas.style.width) > 0 && parseFloat(canvas.style.height) > 0;
      }).map(([index, element]) => {
        const rect = element.getBoundingClientRect();
        return { index, visible: rect.bottom > 0 && rect.top < window.innerHeight, distance: Math.max(0, -rect.bottom, rect.top - window.innerHeight) };
      });
      const visible = geometries.filter((page) => page.visible).map((page) => page.index);
      return geometries.filter((page) => page.visible || visible.some((index) => Math.abs(index - page.index) <= 1)).map((page) => {
        const canvas = passivePageCanvasesRef.current.get(page.index);
        const ratio = window.devicePixelRatio || 1;
        return { ...page, bytes: bitmapBytes(parseFloat(canvas?.style.width || '0') * ratio, parseFloat(canvas?.style.height || '0') * ratio) };
      });
    }
    async function pump() {
      if (running || disposed || isHidden()) return;
      running = true;
      try {
        let observed: number;
        do {
          observed = revision;
          const key = `${view.scale}:${view.rotation}:${window.devicePixelRatio || 1}`;
          const order = selectReaderBitmaps(candidates());
          wanted = new Set(order);
          for (const index of passivePageCanvasesRef.current.keys()) {
            if (!wanted.has(index)) await release(index);
          }
          for (const index of order) {
            if (disposed || observed !== revision || isHidden() || !isCurrent(requestId) || documentRef.current !== pdf) break;
            if (index === activePageIndexRef.current) continue;
            const canvas = passivePageCanvasesRef.current.get(index);
            if (!canvas || canvas.dataset.renderKey === key) continue;
            const previous = pageRenderTasksRef.current.get(index);
            if (previous) await previous.promise.catch(() => undefined);
            if (disposed || observed !== revision || index === activePageIndexRef.current) continue;
            const page = await pdf.getPage(index + 1);
            if (disposed || observed !== revision || documentRef.current !== pdf || isHidden()) continue;
            const viewport = page.getViewport({ scale: view.scale, rotation: (page.rotate + view.rotation) % 360 });
            const outputScale = window.devicePixelRatio || 1;
            const rect = pageElementsRef.current.get(index)?.getBoundingClientRect();
            const visible = !!rect && rect.bottom > 0 && rect.top < window.innerHeight;
            const cost = bitmapBytes(Math.floor(viewport.width * outputScale), Math.floor(viewport.height * outputScale));
            const retained = [...passivePageCanvasesRef.current.entries()].reduce((sum, [other, item]) => sum + (other === index ? 0 : bitmapBytes(item.width, item.height)), 0);
            if (!visible && retained + cost > READER_BITMAP_BUDGET) continue;
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;
            const context = canvas.getContext('2d');
            if (!context) continue;
            delete canvas.dataset.renderKey;
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            const task = page.render({ canvas, canvasContext: context, viewport, transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0] });
            pageRenderTasksRef.current.set(index, task);
            try {
              await task.promise;
              if (!disposed && observed === revision && wanted.has(index) && documentRef.current === pdf) canvas.dataset.renderKey = `${view.scale}:${view.rotation}:${outputScale}`;
            } catch { /* Cancellation is normal during fast scrolling. */ }
            finally { if (pageRenderTasksRef.current.get(index) === task) pageRenderTasksRef.current.delete(index); }
          }
        } while (!disposed && observed !== revision && !isHidden());
      } catch { /* A passive page must not disrupt the active text/annotation layer. */ }
      finally { running = false; }
    }
    function schedule() {
      revision += 1;
      // Invalidate work immediately; never resize its buffer until it settles.
      for (const [index, task] of pageRenderTasksRef.current) if (index !== activePageIndexRef.current) task.cancel();
      if (!frame) frame = window.requestAnimationFrame(() => { frame = 0; void pump(); });
    }
    function visibility() {
      const visible = !isHidden();
      setReaderVisible(visible);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      if (!visible) {
        revision += 1;
        for (const task of pageRenderTasksRef.current.values()) task.cancel();
        hiddenTimer = setTimeout(() => {
          wanted.clear();
          for (const index of passivePageCanvasesRef.current.keys()) void release(index, true);
        }, 15_000);
      } else {
        schedule();
        if (documentRef.current === pdf) void renderPage(pdf, { pageIndex: activePageIndexRef.current, scale: view.scale, rotation: view.rotation }, requestId);
      }
    }
    function pagehide(event: PageTransitionEvent) {
      renderIdRef.current += 1;
      textLayerTaskRef.current?.cancel();
      revision += 1;
      wanted.clear();
      for (const index of passivePageCanvasesRef.current.keys()) void release(index, true, true);
      if (!event.persisted) void releaseDocumentResources();
    }
    function pageshow(event: PageTransitionEvent) {
      if (event.persisted) visibility();
    }
    bitmapScheduleRef.current = schedule;
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('pagehide', pagehide);
    window.addEventListener('pageshow', pageshow);
    schedule();
    if (isHidden()) visibility();
    return () => {
      disposed = true;
      revision += 1;
      if (frame) window.cancelAnimationFrame(frame);
      if (hiddenTimer) clearTimeout(hiddenTimer);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('pagehide', pagehide);
      window.removeEventListener('pageshow', pageshow);
      for (const [index, task] of pageRenderTasksRef.current) if (index !== activePageIndexRef.current) task.cancel();
      bitmapScheduleRef.current = () => {};
    };
  }, [state.kind, thumbnailSession, state.kind === 'ready' ? state.scale : 0, state.kind === 'ready' ? state.rotation : 0]);

  async function renderPage(pdf: PDFDocumentProxy, view: ViewState, requestId: number): Promise<boolean> {
    // Indexing/restoration must continue for background imports without allocating a bitmap.
    const isHidden = () => document.visibilityState === 'hidden';
    if (isHidden()) return true;
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
      const passiveTask = pageRenderTasksRef.current.get(view.pageIndex);
      if (passiveTask) {
        passiveTask.cancel();
        await passiveTask.promise.catch(() => undefined);
        if (pageRenderTasksRef.current.get(view.pageIndex) === passiveTask) pageRenderTasksRef.current.delete(view.pageIndex);
      }
      if (!isCurrentRender(requestId, renderId)) return false;
      const viewport = page.getViewport({ scale: view.scale, rotation: (page.rotate + view.rotation) % 360 });
      let canvas = passivePageCanvasesRef.current.get(view.pageIndex);
      let textLayer = textLayerRef.current;
      // React can replace the active page node while an evidence/search jump
      // changes pages. A single frame retry keeps PDF.js tied to the newly
      // mounted active surface instead of turning that harmless commit into a
      // terminal document-load error.
      if (!canvas || !textLayer || textLayer.closest('[data-page-index]')?.getAttribute('data-page-index') !== String(view.pageIndex)) {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
        canvas = passivePageCanvasesRef.current.get(view.pageIndex);
        textLayer = textLayerRef.current;
      }
      if (!isCurrentRender(requestId, renderId)) return false;
      if (!canvas || !textLayer) throw new Error('The reader surface is no longer available.');
      if (isHidden()) return true;

      const outputScale = window.devicePixelRatio || 1;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser did not provide a canvas rendering context.');

      const bitmapKey = `${view.scale}:${view.rotation}:${outputScale}`;
      const reuseBitmap = canvas.dataset.renderKey === bitmapKey;
      if (!reuseBitmap) {
        delete canvas.dataset.renderKey;
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
      }
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

      if (!reuseBitmap) {
        const renderTask = page.render({
          canvas,
          canvasContext: context,
          viewport,
          transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        });
        renderTaskRef.current = renderTask;
        pageRenderTasksRef.current.set(view.pageIndex, renderTask);
        try { await renderTask.promise; }
        finally { if (pageRenderTasksRef.current.get(view.pageIndex) === renderTask) pageRenderTasksRef.current.delete(view.pageIndex); }
        if (!isCurrentRender(requestId, renderId) || documentRef.current !== pdf || isHidden()) return false;
        canvas.dataset.renderKey = bitmapKey;
      }
      if (!isCurrentRender(requestId, renderId)) return false;
      const textLayerTask = new TextLayer({ textContentSource: page.streamTextContent(), container: textLayer, viewport });
      textLayerTaskRef.current = textLayerTask;
      await textLayerTask.render();
      if (!isCurrentRender(requestId, renderId)) return false;
      setRenderedHighlightViewport({ pageIndex: view.pageIndex, viewport });
      bitmapScheduleRef.current();
      return true;
    } catch (error) {
      if (!isCurrentRender(requestId, renderId) || isHidden() || (error instanceof Error && error.name === 'RenderingCancelledException')) return false;
      setState({ kind: 'error', message: readerError(error, 'render') });
      return false;
    } finally {
      if (isCurrentRender(requestId, renderId)) {
        renderTaskRef.current = null;
        textLayerTaskRef.current = null;
        setIsRendering(false);
      }
    }
  }

  async function sizeAllPageCanvases(pdf: PDFDocumentProxy, view: ViewState, isStillCurrent: () => boolean = () => true) {
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, (_, index) => pdf.getPage(index + 1)));
    if (documentRef.current !== pdf || !isStillCurrent()) return;
    pages.forEach((page, index) => {
      const canvas = passivePageCanvasesRef.current.get(index);
      if (!canvas) return;
      const viewport = page.getViewport({ scale: view.scale, rotation: (page.rotate + view.rotation) % 360 });
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;
    });
    bitmapScheduleRef.current();
  }

  async function loadPdf(bytes: Uint8Array, fileName: string, requestId: number, requestedPageIndex?: number, localSource = false, onlineUrl?: string) {
    if (!isCurrent(requestId)) return;
    try {
      if (!isPdfSignature(bytes)) {
        setState({ kind: 'error', message: uiText('reader.error.noPdfSignature') });
        return;
      }

      const zoomPreferencePromise = zoomPreferencesRef.current.load();
      const hashPromise = sha256Hex(bytes).catch(() => undefined);
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
            message: uiText('reader.error.tooManyPages', { count: pdf.numPages }),
          });
        }
        return;
      }
      documentRef.current = pdf;
      const initialView: ViewState = { pageIndex: Math.min(requestedPageIndex ?? 0, pdf.numPages - 1), scale: 1.35, rotation: 0 };
      activePageIndexRef.current = initialView.pageIndex;
      const preference = await zoomPreferencePromise;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      zoomPreferenceRef.current = preference;
      setCurrentZoomChoice(preference.mode === 'manual' ? manualZoomChoice(preference.scale) : preference.mode);
      if (preference.mode === 'manual') initialView.scale = preference.scale;
      const initialZoomRevision = zoomInteractionRef.current;
      void loadOutline(pdf, requestId);
      // The continuous reader mounts its page canvases from ready state. Commit
      // that state before asking PDF.js to render, then wait for the canvas and
      // text-layer refs to exist. Rendering first used to race React's commit
      // and produced “reader surface is no longer available” on local imports.
      setPageInput(String(initialView.pageIndex + 1));
      setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...initialView });
      await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (preference.mode !== 'manual') initialView.scale = await fittedScale(pdf, initialView, preference.mode);
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (initialZoomRevision === zoomInteractionRef.current) setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...initialView });
      // A fit/resize update can replace this first render. Keep document
      // indexing independent of that render so a harmless cancellation cannot
      // leave Paper Insights waiting forever for extraction to start.
      const initialRenderId = renderIdRef.current + 1;
      const initialRenderPromise = initialZoomRevision === zoomInteractionRef.current ? renderPage(pdf, initialView, requestId) : Promise.resolve(true);
      // Establish all CSS placeholders, including saved manual zoom. Let the
      // active render finish first so whole-document metadata requests cannot
      // queue ahead of its operator list in the PDF worker. Unsized pages are
      // excluded from prefetch until this completes; no bitmaps are allocated.
      const initialGeometryPromise = initialRenderPromise.then(() =>
        sizeAllPageCanvases(pdf, initialView, () => isCurrent(requestId) && initialZoomRevision === zoomInteractionRef.current))
        .catch(() => undefined);
      setThumbnailSession(requestId);
      const contentKey = await hashPromise;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (localSource && contentKey) updateReaderSourceAddress(localPdfSourceKey(contentKey), activePageIndexRef.current);
      // The extraction uses the content hash in every block ID. If hashing is
      // unavailable, extraction remains inspectable for this session but is
      // explicitly not a stable cross-open document version.
      const documentVersion = contentKey ? `sha256:${contentKey}` : `unverified-session:${requestId}`;
      void extractPageBlocks(pdf, requestId, documentVersion);
      const initialRenderSucceeded = await initialRenderPromise;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      // A superseding render owns the active surface. A failure without a
      // successor is a real rendering error and must keep its error state.
      if (!initialRenderSucceeded && renderIdRef.current === initialRenderId) return;
      await initialGeometryPromise;
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      if (requestedPageIndex !== undefined && initialView.pageIndex > 0 && initialZoomRevision === zoomInteractionRef.current) {
        await initialGeometryPromise;
        if (!isCurrent(requestId) || documentRef.current !== pdf) return;
        pageElementsRef.current.get(initialView.pageIndex)?.scrollIntoView({ behavior: 'instant', block: 'start' });
      }
      if (!contentKey) {
        viewRestoreReadyRef.current = true;
        setViewStorageStatus(uiText('reader.view.noContentKey'));
        setViewRestoreEpoch((epoch) => epoch + 1);
        return;
      }
      void saveSuccessfulReading(pdf, fileName, contentKey, localSource ? { kind: 'local' } : { kind: 'online', url: onlineUrl! }, Date.now());
      setDocumentContentKey(contentKey);
      highlightDocumentKeyRef.current = contentKey;
      void restoreSavedHighlights(contentKey, highlightStorageSessionRef.current);
      void restoreSavedTranslations(contentKey, highlightStorageSessionRef.current);
      if (requestedPageIndex !== undefined) {
        viewRestoreReadyRef.current = true;
        setViewStorageStatus(uiText('reader.view.openedAtLinkedPage'));
        setViewRestoreEpoch((epoch) => epoch + 1);
        return;
      }
      const restoreSession = viewSessionRef.current;
      const restoreRevision = viewInteractionRevisionRef.current;
      const restoreZoomRevision = zoomInteractionRef.current;
      const storage = getLocalStorageArea();
      if (!storage) {
        viewRestoreReadyRef.current = true;
        setViewStorageStatus(uiText('reader.view.restoreStorageUnavailable'));
        setViewRestoreEpoch((epoch) => epoch + 1);
        return;
      }
      setViewStorageStatus(uiText('reader.view.restoring'));
      try {
        const values = await storage.get(`${VIEW_STORAGE_PREFIX}${contentKey}`);
        if (!isCurrent(requestId) || documentRef.current !== pdf || restoreSession !== viewSessionRef.current || restoreRevision !== viewInteractionRevisionRef.current || restoreZoomRevision !== zoomInteractionRef.current) return;
        const restoredPosition = savedView(values[`${VIEW_STORAGE_PREFIX}${contentKey}`], pdf.numPages);
        if (restoredPosition) {
          const currentPreference = zoomPreferenceRef.current;
          const restoredView: ViewState = { ...restoredPosition, scale: currentPreference.mode === 'manual' ? currentPreference.scale : initialView.scale };
          if (currentPreference.mode !== 'manual') restoredView.scale = await fittedScale(pdf, restoredView, currentPreference.mode);
          if (!isCurrent(requestId) || documentRef.current !== pdf || restoreSession !== viewSessionRef.current || restoreRevision !== viewInteractionRevisionRef.current || restoreZoomRevision !== zoomInteractionRef.current) return;
          // Restore only document position and rotation; zoom belongs to all PDFs.
          activePageIndexRef.current = restoredView.pageIndex;
          setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...restoredView });
          await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          if (!isCurrent(requestId) || documentRef.current !== pdf || restoreRevision !== viewInteractionRevisionRef.current || restoreZoomRevision !== zoomInteractionRef.current) return;
          if (!await renderPage(pdf, restoredView, requestId)) return;
          if (!isCurrent(requestId) || documentRef.current !== pdf || restoreSession !== viewSessionRef.current || restoreRevision !== viewInteractionRevisionRef.current || restoreZoomRevision !== zoomInteractionRef.current) return;
          setPageInput(String(restoredView.pageIndex + 1));
          setState({ kind: 'ready', fileName, pageCount: pdf.numPages, ...restoredView });
          pageElementsRef.current.get(restoredView.pageIndex)?.scrollIntoView({ block: 'start' });
          if (localSource && readerSourceRef.current) updateReaderSourceAddress(readerSourceRef.current, restoredView.pageIndex);
          setViewStorageStatus(uiText('reader.view.restored'));
        } else {
          setViewStorageStatus(uiText('reader.view.noneSaved'));
        }
      } catch {
        if (isCurrent(requestId) && documentRef.current === pdf && restoreSession === viewSessionRef.current) {
          setViewStorageStatus(uiText('reader.view.restoreFailed'));
        }
      } finally {
        if (isCurrent(requestId) && documentRef.current === pdf && restoreSession === viewSessionRef.current) {
          viewRestoreReadyRef.current = true;
          setViewRestoreEpoch((epoch) => epoch + 1);
        }
      }
    } catch (error) {
      if (!isCurrent(requestId)) return;
      setState({ kind: 'error', message: readerError(error, 'open') });
    }
  }

  async function importLocalFile(file: File) {
    const requestId = beginImport();
    const sourceAddress = new URL(window.location.href);
    sourceAddress.hash = '';
    sourceAddress.searchParams.delete('arxivPdfUrl');
    window.history.replaceState(null, '', sourceAddress);
    if (file.size > MAX_PDF_BYTES) {
      setState({ kind: 'error', message: uiText('reader.import.tooLargeReceived', { mib: (file.size / (1024 * 1024)).toFixed(1) }) });
      return;
    }
    if (!await prepareImport(file.name, requestId)) return;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!isCurrent(requestId)) return;
      await loadPdf(bytes, file.name, requestId, undefined, true);
    } catch (error) {
      if (isCurrent(requestId)) setState({ kind: 'error', message: readerError(error, 'read') });
    }
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    const [file] = Array.from(event.target.files ?? []);
    if (file) void importLocalFile(file);
    event.target.value = '';
  }

  function updateReaderSourceAddress(source: URL | LocalPdfSourceKey, pageIndex = 0) {
    readerSourceRef.current = source;
    replaceReaderSourceAddress(source, pageIndex, window.location.href, (address) => window.history.replaceState(null, '', address));
  }

  function clearPendingSourcePageSync() {
    pendingSourcePageRef.current = null;
    if (sourcePageSyncTimerRef.current !== null) {
      window.clearTimeout(sourcePageSyncTimerRef.current);
      sourcePageSyncTimerRef.current = null;
    }
  }

  function syncPendingSourcePage() {
    const pageIndex = pendingSourcePageRef.current;
    clearPendingSourcePageSync();
    if (pageIndex === null || pageIndex !== activePageIndexRef.current || !readerSourceRef.current) return;
    updateReaderSourceAddress(readerSourceRef.current, pageIndex);
  }

  function armSourcePageSyncFallback() {
    if (sourcePageSyncTimerRef.current !== null) window.clearTimeout(sourcePageSyncTimerRef.current);
    sourcePageSyncTimerRef.current = window.setTimeout(syncPendingSourcePage, REMOTE_SOURCE_SCROLL_FALLBACK_MS);
  }

  function markSourcePageActivity(pageIndex: number) {
    if (!readerSourceRef.current) return;
    pendingSourcePageRef.current = pageIndex;
    if (!('onscrollend' in document)) armSourcePageSyncFallback();
  }

  useEffect(() => () => clearPendingSourcePageSync(), []);

  async function downloadAuthorizedUrl(url: URL, requestId: number, source: 'manual' | 'arxiv' | 'fragment', requestedPageIndex?: number) {
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
        setState({ kind: 'error', message: uiText('reader.import.httpError', { status: response.status }) });
        return;
      }
      const bytes = await readPdfResponse(response, requestId, isCurrent);
      if (!isCurrent(requestId)) return;
      const responseKind = classifyUrlPdfResponse(bytes);
      if (responseKind !== 'pdf') {
        setState({ kind: 'error', message: uiText(responseKind === 'html' ? 'reader.import.htmlResponse' : 'reader.import.notPdfResponse') });
        return;
      }
      await loadPdf(bytes, url.pathname.split('/').pop() || url.hostname, requestId, requestedPageIndex, false, url.href);
      if (isCurrent(requestId) && documentRef.current) updateReaderSourceAddress(url, activePageIndexRef.current);
    } catch (error) {
      if (!isCurrent(requestId)) return;
      if (error instanceof DOMException && error.name === 'AbortError') {
        setState({ kind: 'cancelled', message: uiText(source === 'arxiv' ? 'reader.import.arxivCancelled' : 'reader.import.cancelled') });
        return;
      }
      if (error instanceof Error && error.message.startsWith('This PDF exceeds the 100 MiB reader limit')) {
        setState({ kind: 'error', message: uiText('reader.import.tooLarge') });
        return;
      }
      setState({ kind: 'error', message: uiText('reader.import.downloadFailed') });
    }
  }

  async function importUrl(event: FormEvent<HTMLFormElement>, historyUrl?: string) {
    event.preventDefault();
    let url: URL;
    try {
      url = new URL(historyUrl ?? urlValue);
    } catch {
      setState({ kind: 'error', message: uiText('reader.import.completeUrl') });
      return;
    }
    if (url.protocol !== 'https:' || url.username || url.password) {
      setState({ kind: 'error', message: uiText('reader.import.httpsOnly') });
      return;
    }

    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: uiText('reader.import.permissionApiUnavailable') });
      return;
    }
    const requestId = beginImport();
    const origin = permissionPattern(url);
    // This call must remain synchronous with the form-submit user gesture. In
    // particular, do not await document cleanup or permissions.contains() first.
    let permissionRequest: Promise<boolean>;
    try {
      permissionRequest = permissions.request({ origins: [origin] });
    } catch {
      setState({ kind: 'error', message: uiText('reader.import.permissionRequestFailed', { origin: url.origin }) });
      return;
    }
    setState({ kind: 'requesting-permission', fileName: url.href });
    try {
      const granted = await permissionRequest;
      if (!isCurrent(requestId)) return;
      if (!granted) {
        setState({ kind: 'error', message: uiText('reader.import.permissionDenied', { origin: url.origin }) });
        return;
      }
      await downloadAuthorizedUrl(url, requestId, 'manual');
    } catch {
      if (isCurrent(requestId)) setState({ kind: 'error', message: uiText('reader.import.sourcePermissionFailed') });
    }
  }

  async function importAutomaticArxivPdf(urlValueFromNavigation: string) {
    if (!isArxivDirectPdfUrl(urlValueFromNavigation)) {
      setState({ kind: 'error', message: uiText('reader.import.arxivDirectOnly') });
      return;
    }
    const url = new URL(urlValueFromNavigation);
    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: uiText('reader.import.permissionApiUnavailable') });
      return;
    }

    // The listener only redirects after it has checked this too. Repeat the
    // check because the extension page URL is editable, and never prompt for a
    // host permission without a user gesture.
    let granted = false;
    try {
      granted = await permissions.contains({ origins: [permissionPattern(url)] });
    } catch {
      setState({ kind: 'error', message: uiText('reader.import.verifyPermissionOpenForm', { origin: url.origin }) });
      return;
    }
    if (!granted) {
      setState({ kind: 'error', message: uiText('reader.import.permissionUnavailableOpenForm', { origin: url.origin }) });
      return;
    }

    const requestId = beginImport();
    await downloadAuthorizedUrl(url, requestId, 'arxiv');
  }

  async function importFragmentPdf(url: URL, pageIndex?: number) {
    setUrlValue(url.href);
    const permissions = getOptionalPermissionsApi();
    if (!permissions) {
      setState({ kind: 'error', message: uiText('reader.import.permissionApiUnavailableLocal') });
      return;
    }
    let granted = false;
    try { granted = await permissions.contains({ origins: [permissionPattern(url)] }); }
    catch {
      setState({ kind: 'error', message: uiText('reader.import.verifyPermissionClick', { origin: url.origin }) });
      return;
    }
    if (!granted) {
      setState({ kind: 'error', message: uiText('reader.import.permissionNotGranted', { origin: url.origin }) });
      return;
    }
    const requestId = beginImport();
    await downloadAuthorizedUrl(url, requestId, 'fragment', pageIndex);
  }

  function cancelImport() {
    if (state.kind !== 'loading' && state.kind !== 'requesting-permission') return;
    requestIdRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    if (state.kind === 'loading') void clearPreviousDocument();
    setState({ kind: 'cancelled', message: uiText('reader.import.cancelled') });
  }

  function changeView(nextView: ViewState, sourceAddressTiming: 'immediate' | 'scrollend' = 'immediate') {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const pageChanged = nextView.pageIndex !== activePageIndexRef.current;
    viewInteractionRevisionRef.current += 1;
    invalidateTranslation();
    setSelectionDraft(null);
    setActiveHighlightId(null);
    dismissCitationPopover(false);
    clearBrowserSelection();
    activePageIndexRef.current = nextView.pageIndex;
    if (readerSourceRef.current) {
      if (sourceAddressTiming === 'scrollend') {
        if (pageChanged) markSourcePageActivity(nextView.pageIndex);
      } else {
        clearPendingSourcePageSync();
        updateReaderSourceAddress(readerSourceRef.current, nextView.pageIndex);
      }
    }
    setState({ ...state, ...nextView });
    setPageInput(String(nextView.pageIndex + 1));
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    window.requestAnimationFrame(() => {
      if (isCurrent(requestId) && documentRef.current === pdf) void renderPage(pdf, nextView, requestId);
    });
  }

  function pageScrollTop(pageIndex: number): number | null {
    const element = pageElementsRef.current.get(pageIndex);
    if (!element) return null;
    return window.scrollY + element.getBoundingClientRect().top - (parseFloat(getComputedStyle(element).scrollMarginTop) || 0);
  }

  function captureLocation(): ReaderLocation | null {
    if (state.kind !== 'ready') return null;
    const pageTop = pageScrollTop(state.pageIndex);
    if (pageTop === null) return null;
    return { pageIndex: state.pageIndex, scale: state.scale, rotation: state.rotation, pageOffset: window.scrollY - pageTop, zoomMode: zoomModeRef.current, zoomChoice: zoomChoiceRef.current };
  }

  function locationsMatch(first: ReaderLocation, second: ReaderLocation) {
    return first.pageIndex === second.pageIndex && first.scale === second.scale && first.rotation === second.rotation && first.zoomMode === second.zoomMode && first.zoomChoice === second.zoomChoice && Math.abs(first.pageOffset - second.pageOffset) < 8;
  }

  function recordActiveJump(pageIndex: number, force = false) {
    const current = captureLocation();
    if (!current) return;
    const targetTop = pageScrollTop(pageIndex);
    if (targetTop === null) return;
    const target: ReaderLocation = { pageIndex, scale: current.scale, rotation: current.rotation, pageOffset: 0, zoomMode: current.zoomMode, zoomChoice: current.zoomChoice };
    if (!force && locationsMatch(current, target)) return;
    const history = locationHistoryRef.current;
    if (!history.back.length || !locationsMatch(history.back[history.back.length - 1], current)) history.back.push(current);
    if (history.back.length > LOCATION_HISTORY_LIMIT) history.back.shift();
    history.forward = [];
    setHistoryRevision((revision) => revision + 1);
  }

  async function restoreLocation(location: ReaderLocation) {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    const restoreId = ++historyRestoreRef.current;
    setCurrentZoomChoice(location.zoomChoice);
    navigationScrollUntilRef.current = performance.now() + 1200;
    const baseView: ViewState = { pageIndex: location.pageIndex, scale: location.scale, rotation: location.rotation };
    const view = location.zoomMode === 'manual' ? baseView : { ...baseView, scale: await fittedScale(pdf, baseView, location.zoomMode) };
    if (!isCurrent(requestId) || documentRef.current !== pdf || restoreId !== historyRestoreRef.current) return;
    changeView(view);
    await sizeAllPageCanvases(pdf, view);
    if (!isCurrent(requestId) || documentRef.current !== pdf || restoreId !== historyRestoreRef.current) return;
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    const pageTop = pageScrollTop(location.pageIndex);
    if (pageTop !== null) window.scrollTo({ top: Math.max(0, pageTop + location.pageOffset), behavior: 'instant' });
    if (window.innerWidth <= 1100) { setLeftRailOpen(false); setRightRailOpen(false); }
  }

  function navigateLocationHistory(direction: 'back' | 'forward') {
    const history = locationHistoryRef.current;
    const source = direction === 'back' ? history.back : history.forward;
    const destination = direction === 'back' ? history.forward : history.back;
    const target = source.pop();
    if (!target) return;
    const current = captureLocation();
    if (current && !locationsMatch(current, target)) destination.push(current);
    if (destination.length > LOCATION_HISTORY_LIMIT) destination.shift();
    setHistoryRevision((revision) => revision + 1);
    void restoreLocation(target);
  }

  async function navigatePdfLink(dest: string | unknown[]) {
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    if (!pdf || state.kind !== 'ready') return;
    try {
      const { pageIndex, destination } = await resolvePdfLinkDestination(pdf, dest);
      const page = await pdf.getPage(pageIndex + 1);
      if (!isCurrent(requestId) || documentRef.current !== pdf) return;
      const viewport = page.getViewport({ scale: state.scale, rotation: (page.rotate + state.rotation) % 360 });
      const point = pdfDestinationPoint(destination, viewport);
      goToPage(pageIndex, undefined, true);
      const navigationId = historyRestoreRef.current;
      window.requestAnimationFrame(() => {
        if (!isCurrent(requestId) || documentRef.current !== pdf || historyRestoreRef.current !== navigationId) return;
        const element = pageElementsRef.current.get(pageIndex);
        if (element && point) {
          const pageTop = pageScrollTop(pageIndex);
          if (pageTop !== null) window.scrollTo({ top: Math.max(0, pageTop + point[1]), behavior: 'instant' });
        }
        element?.focus({ preventScroll: true });
        const mode = (destination[1] as { name?: string } | undefined)?.name;
        if (!point && mode !== 'Fit' && mode !== 'FitB') setEvidenceNavigationNotice(uiText('reader.links.positionUnavailable'));
      });
    } catch {
      if (isCurrent(requestId) && documentRef.current === pdf) setEvidenceNavigationNotice(uiText('reader.links.unavailable'));
    }
  }

  function goToPage(pageIndex: number, evidenceId?: string, forceHistory = false) {
    if (state.kind !== 'ready' || pageIndex < 0 || pageIndex >= state.pageCount) return;
    historyRestoreRef.current += 1;
    recordActiveJump(pageIndex, Boolean(evidenceId) || forceHistory);
    clearEvidenceVisual();
    setEvidenceNavigationNotice('');
    pendingEvidenceRef.current = evidenceId ? { evidenceId, pageIndex, requestId: requestIdRef.current } : null;
    navigationScrollUntilRef.current = performance.now() + 900;
    changeView({ pageIndex, scale: state.scale, rotation: state.rotation });
    // Let React move the active interactive page into the continuous stream
    // before requesting the native scroll. This keeps evidence/search jumps
    // aligned with the page users can see.
    if (window.innerWidth <= 1100) { setLeftRailOpen(false); setRightRailOpen(false); }
    window.requestAnimationFrame(() => pageElementsRef.current.get(pageIndex)?.scrollIntoView({ behavior: 'instant', block: 'start' }));
  }

  function setCurrentZoomChoice(choice: ZoomChoice) {
    zoomChoiceRef.current = choice;
    zoomModeRef.current = zoomChoiceMode(choice);
    setZoomChoice(choice);
    setZoomInputInvalid(false);
  }

  async function fittedScale(pdf: PDFDocumentProxy, view: ViewState, mode: Exclude<ZoomMode, 'manual'>): Promise<number> {
    const page = await pdf.getPage(view.pageIndex + 1);
    const viewport = page.getViewport({ scale: 1, rotation: (page.rotate + view.rotation) % 360 });
    const stage = stageRef.current;
    const styles = stage && getComputedStyle(stage);
    const availableWidth = stage ? stage.clientWidth - parseFloat(styles!.paddingLeft) - parseFloat(styles!.paddingRight) : window.innerWidth - 32;
    const headerHeight = readerPageRef.current?.querySelector<HTMLElement>('.reader-header')?.offsetHeight ?? 56;
    const availableHeight = window.innerHeight - headerHeight - (styles ? parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom) : 32) - 8;
    return fittedZoomScale(mode, viewport.width, viewport.height, Math.max(1, availableWidth), Math.max(1, availableHeight));
  }

  async function applyZoomView(nextView: ViewState, pointer?: ZoomPointer) {
    if (state.kind !== 'ready' || !documentRef.current) return;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    const zoomChangeId = ++historyRestoreRef.current;
    const anchorElement = pointer ? [...pageElementsRef.current.values()].reduce<HTMLElement | undefined>((nearest, element) => {
      const rect = element.getBoundingClientRect();
      const distance = Math.max(rect.top - pointer.clientY, pointer.clientY - rect.bottom, 0);
      if (!nearest) return element;
      const previous = nearest.getBoundingClientRect();
      return distance < Math.max(previous.top - pointer.clientY, pointer.clientY - previous.bottom, 0) ? element : nearest;
    }, undefined) : undefined;
    const anchorRect = anchorElement?.getBoundingClientRect();
    const anchor = pointer && anchorRect && anchorRect.width && anchorRect.height ? {
      x: (pointer.clientX - anchorRect.left) / anchorRect.width,
      y: (pointer.clientY - anchorRect.top) / anchorRect.height,
    } : undefined;
    const pageOffset = window.scrollY - (pageScrollTop(state.pageIndex) ?? window.scrollY);
    const previousPageHeight = pageElementsRef.current.get(state.pageIndex)?.getBoundingClientRect().height ?? 0;
    navigationScrollUntilRef.current = performance.now() + 1200;
    changeView(nextView);
    await sizeAllPageCanvases(pdf, nextView, () => isCurrent(requestId) && zoomChangeId === historyRestoreRef.current);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
    if (!isCurrent(requestId) || documentRef.current !== pdf || zoomChangeId !== historyRestoreRef.current || activePageIndexRef.current !== nextView.pageIndex) return;
    if (pointer && anchor && anchorElement?.isConnected) {
      const rect = anchorElement.getBoundingClientRect();
      if (stageRef.current) stageRef.current.scrollLeft += rect.left + anchor.x * rect.width - pointer.clientX;
      window.scrollTo({ top: Math.max(0, window.scrollY + rect.top + anchor.y * rect.height - pointer.clientY), behavior: 'instant' });
      return;
    }
    const pageTop = pageScrollTop(nextView.pageIndex);
    const nextPageHeight = pageElementsRef.current.get(nextView.pageIndex)?.getBoundingClientRect().height ?? 0;
    const offsetRatio = previousPageHeight > 0 && nextPageHeight > 0 ? nextPageHeight / previousPageHeight : nextView.scale / state.scale;
    if (pageTop !== null) window.scrollTo({ top: Math.max(0, pageTop + pageOffset * offsetRatio), behavior: 'instant' });
  }

  function recomputeFittedZoom() {
    if (state.kind !== 'ready' || !documentRef.current || zoomModeRef.current === 'manual' || panelDragRef.current) return;
    const mode = zoomModeRef.current;
    const view = state;
    const pdf = documentRef.current;
    const requestId = requestIdRef.current;
    void fittedScale(pdf, view, mode).then((scale) => {
      if (isCurrent(requestId) && documentRef.current === pdf && zoomModeRef.current === mode && activePageIndexRef.current === view.pageIndex && scale !== view.scale) void applyZoomView({ pageIndex: view.pageIndex, scale, rotation: view.rotation });
    });
  }

  function persistUserZoom(choice: ZoomChoice, scale: number) {
    zoomInteractionRef.current += 1;
    const mode = zoomChoiceMode(choice);
    const preference: ReaderZoomPreference = mode === 'manual' ? { mode, scale } : { mode };
    zoomPreferenceRef.current = preference;
    void zoomPreferencesRef.current.save(preference);
  }

  function changeZoomChoice(choice: ZoomChoice) {
    if (state.kind !== 'ready' || !ZOOM_CHOICES.includes(choice)) return;
    setCurrentZoomChoice(choice);
    setZoomInputEditing(false);
    zoomInputDirtyRef.current = false;
    if (zoomMenuRef.current) {
      zoomMenuRef.current.open = false;
      zoomMenuRef.current.querySelector('summary')?.focus();
    }
    const fixedScale = zoomChoiceScale(choice);
    persistUserZoom(choice, fixedScale ?? state.scale);
    if (fixedScale !== undefined) {
      if (fixedScale !== state.scale) void applyZoomView({ pageIndex: state.pageIndex, scale: fixedScale, rotation: state.rotation });
    } else recomputeFittedZoom();
  }

  function commitZoomInput() {
    if (state.kind !== 'ready' || !zoomInputEditing) return;
    setZoomInputEditing(false);
    if (!zoomInputDirtyRef.current) return;
    zoomInputDirtyRef.current = false;
    const percentage = parseZoomPercentInput(zoomInputDraft);
    if (percentage === null) {
      setZoomInputInvalid(true);
      return;
    }
    setZoomInputInvalid(false);
    const scale = percentage / 100;
    setCurrentZoomChoice(manualZoomChoice(scale));
    persistUserZoom(manualZoomChoice(scale), scale);
    if (scale !== state.scale) void applyZoomView({ pageIndex: state.pageIndex, scale, rotation: state.rotation });
  }

  const wheelZoomViewRef = useRef({ scale: 1, apply: async (_scale: number, _pointer: ZoomPointer) => {} });
  useLayoutEffect(() => {
    wheelZoomViewRef.current = {
      scale: state.kind === 'ready' ? state.scale : 1,
      apply: async (scale, pointer) => {
        if (state.kind !== 'ready' || !documentRef.current) return;
        setCurrentZoomChoice(manualZoomChoice(scale));
        setZoomInputEditing(false);
        zoomInputDirtyRef.current = false;
        persistUserZoom(manualZoomChoice(scale), scale);
        await applyZoomView({ pageIndex: state.pageIndex, scale, rotation: state.rotation }, pointer);
      },
    };
  });

  useEffect(() => {
    if (state.kind !== 'ready' || !stageRef.current) return;
    const requestId = requestIdRef.current;
    const pdf = documentRef.current;
    return bindPdfWheelZoom(stageRef.current, {
      getScale: () => wheelZoomViewRef.current.scale,
      apply: async (scale, pointer) => {
        if (isCurrent(requestId) && documentRef.current === pdf) await wheelZoomViewRef.current.apply(scale, pointer);
      },
      requestFrame: (callback) => window.requestAnimationFrame(callback),
      cancelFrame: (id) => window.cancelAnimationFrame(id),
    });
  }, [state.kind, thumbnailSession]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    const closeZoomMenu = (event: PointerEvent) => {
      if (zoomMenuRef.current?.open && !zoomMenuRef.current.contains(event.target as Node)) zoomMenuRef.current.open = false;
    };
    document.addEventListener('pointerdown', closeZoomMenu);
    return () => document.removeEventListener('pointerdown', closeZoomMenu);
  }, [state.kind]);

  useEffect(() => {
    if (state.kind !== 'ready' || !stageRef.current) return;
    let frame = 0;
    let lastWidth = stageRef.current.clientWidth;
    let lastHeight = window.innerHeight;
    const onResize = () => {
      const width = stageRef.current?.clientWidth ?? 0;
      const height = window.innerHeight;
      const mode = zoomModeRef.current;
      if (panelDragRef.current || mode === 'manual' || (width === lastWidth && (mode !== 'fit-page' || height === lastHeight))) return;
      lastWidth = width;
      lastHeight = height;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => recomputeFittedZoom());
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(stageRef.current);
    window.addEventListener('resize', onResize);
    return () => { observer.disconnect(); window.removeEventListener('resize', onResize); cancelAnimationFrame(frame); };
  }, [state.kind, state.kind === 'ready' ? state.pageIndex : -1, state.kind === 'ready' ? state.scale : 0, state.kind === 'ready' ? state.rotation : 0]);

  useEffect(() => {
    if (state.kind === 'ready' && zoomModeRef.current !== 'manual') recomputeFittedZoom();
  }, [state.kind, state.kind === 'ready' ? state.pageIndex : -1]);

  useEffect(() => {
    if (state.kind !== 'ready') return;
    let frame = 0;
    const supportsScrollEnd = 'onscrollend' in document;
    let deferredScroll: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (!supportsScrollEnd && pendingSourcePageRef.current !== null) armSourcePageSyncFallback();
      if (frame || selectionDraft) return;
      const navigationDelay = navigationScrollUntilRef.current - performance.now();
      if (navigationDelay > 0) {
        if (deferredScroll) clearTimeout(deferredScroll);
        deferredScroll = setTimeout(onScroll, Math.ceil(navigationDelay) + 1);
        return;
      }
      frame = requestAnimationFrame(() => {
        frame = 0;
        const readingLine = Math.min(window.innerHeight * 0.35, 300);
        let nearest = state.pageIndex;
        let distance = Infinity;
        pageElementsRef.current.forEach((element, pageIndex) => {
          const rect = element.getBoundingClientRect();
          const nextDistance = rect.top <= readingLine && rect.bottom >= readingLine ? 0 : Math.min(Math.abs(rect.top - readingLine), Math.abs(rect.bottom - readingLine));
          if (nextDistance < distance) { distance = nextDistance; nearest = pageIndex; }
        });
        if (nearest !== activePageIndexRef.current) changeView({ pageIndex: nearest, scale: state.scale, rotation: state.rotation }, 'scrollend');
      });
    };
    const onScrollEnd = () => {
      if (frame) window.requestAnimationFrame(syncPendingSourcePage);
      else syncPendingSourcePage();
    };
    const interruptNavigationScroll = () => { navigationScrollUntilRef.current = 0; };
    window.addEventListener('scroll', onScroll, { passive: true });
    if (supportsScrollEnd) document.addEventListener('scrollend', onScrollEnd);
    window.addEventListener('wheel', interruptNavigationScroll, { passive: true });
    window.addEventListener('touchstart', interruptNavigationScroll, { passive: true });
    return () => {
      if (deferredScroll) clearTimeout(deferredScroll);
      window.removeEventListener('scroll', onScroll);
      if (supportsScrollEnd) document.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('wheel', interruptNavigationScroll);
      window.removeEventListener('touchstart', interruptNavigationScroll);
      cancelAnimationFrame(frame);
    };
  }, [state.kind, state.kind === 'ready' ? state.pageIndex : -1, state.kind === 'ready' ? state.scale : 0, state.kind === 'ready' ? state.rotation : 0, selectionDraft]);

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || evidenceDialogRef.current?.open) return;
      const focused = document.activeElement;
      if (focused?.closest('.reader-navigation')) {
        setLeftRailOpen(false);
        document.querySelector<HTMLButtonElement>('.edge-rail-left [aria-selected="true"]')?.focus();
      } else if (focused?.closest('.reader-information')) {
        setRightRailOpen(false);
        document.querySelector<HTMLButtonElement>('.edge-rail-right [aria-selected="true"]')?.focus();
      } else if (window.innerWidth <= 1100) { setLeftRailOpen(false); setRightRailOpen(false); }
    };
    const narrowViewport = window.matchMedia('(max-width: 1100px)');
    const onNarrowChange = () => { if (narrowViewport.matches) { setLeftRailOpen(false); setRightRailOpen(false); } };
    document.addEventListener('keydown', onEscape);
    narrowViewport.addEventListener('change', onNarrowChange);
    return () => { document.removeEventListener('keydown', onEscape); narrowViewport.removeEventListener('change', onNarrowChange); };
  }, []);

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
    const candidate = (detailedLedger ?? evidenceLedger.ledger).candidates.find((item) => item.evidenceId === evidenceId);
    if (!candidate) return;
    const location = locateEvidenceCandidate(candidate, extraction.pages);
    if (!location) return;
    goToPage(location.pageIndex, evidenceId);
  }

  useEffect(() => {
    const pending = pendingEvidenceRef.current;
    if (!pending || renderedHighlightViewport?.pageIndex !== pending.pageIndex || pending.requestId !== requestIdRef.current) return;
    if (evidenceLedger.kind !== 'ready' || extraction.kind !== 'ready') return;
    const candidate = (detailedLedger ?? evidenceLedger.ledger).candidates.find((item) => item.evidenceId === pending.evidenceId);
    const location = candidate && locateEvidenceCandidate(candidate, extraction.pages);
    const pageElement = pdfPageRef.current;
    const textLayer = textLayerRef.current;
    if (!location || !pageElement || !textLayer || location.pageIndex !== pending.pageIndex) return;
    pendingEvidenceRef.current = null;
    const block = location.blockId ? extraction.pages[location.pageIndex]?.blocks.find((item) => item.blockId === location.blockId) : undefined;
    const spans = Array.from(textLayer.children).filter((item): item is HTMLSpanElement => item instanceof HTMLSpanElement);
    const indexedSpan = block ? spans[block.sourceOrder] : undefined;
    const sameTextSpans = block ? spans.filter((item) => item.textContent === block.rawText) : [];
    const span = indexedSpan?.textContent === block?.rawText ? indexedSpan : sameTextSpans.length === 1 ? sameTextSpans[0] : null;
    pageElement.focus({ preventScroll: true });
    let range: Range | null = null;
    if (location.precision === 'exact' && block && span && location.normalizedStart !== undefined && location.normalizedEnd !== undefined) {
      const offsets = locateNormalizedRange(block, location.normalizedStart, location.normalizedEnd);
      if (offsets.precision === 'exact') {
        const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let total = 0;
        let start: { node: Text; offset: number } | null = null;
        let end: { node: Text; offset: number } | null = null;
        while (node) {
          const textNode = node as Text;
          const next = total + textNode.data.length;
          if (!start && offsets.rawStart >= total && offsets.rawStart < next) start = { node: textNode, offset: offsets.rawStart - total };
          if (!end && offsets.rawEnd > total && offsets.rawEnd <= next) end = { node: textNode, offset: offsets.rawEnd - total };
          total = next;
          node = walker.nextNode();
        }
        if (start && end && span.textContent?.slice(offsets.rawStart, offsets.rawEnd) === block.rawText.slice(offsets.rawStart, offsets.rawEnd)) {
          range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const selection = window.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(range);
        }
      }
    }
    const visualElement = range ? span! : span ?? pageElement;
    if (!range) visualElement.classList.add(span ? 'evidence-source-block' : 'evidence-source-page');
    (span ?? pageElement).scrollIntoView({ behavior: 'instant', block: span ? 'center' : 'start' });
    setEvidenceNavigationNotice(uiText(range ? 'reader.evidence.exact' : span ? 'reader.evidence.block' : 'reader.evidence.page', { page: location.pageIndex + 1 }));
    const timer = window.setTimeout(() => { clearEvidenceVisual(); setEvidenceNavigationNotice(''); }, 4500);
    evidenceVisualRef.current = { element: visualElement, range, timer };
  }, [renderedHighlightViewport, evidenceLedger, extraction, detailedLedger]);

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
    const pendingPercentage = zoomInputEditing && zoomInputDirtyRef.current ? parseZoomPercentInput(zoomInputDraft) : null;
    const scale = clampZoomScale((pendingPercentage === null ? state.scale : pendingPercentage / 100) + direction * SCALE_STEP);
    setZoomInputEditing(false);
    zoomInputDirtyRef.current = false;
    setCurrentZoomChoice(manualZoomChoice(scale));
    persistUserZoom(manualZoomChoice(scale), scale);
    if (scale !== state.scale) void applyZoomView({ pageIndex: state.pageIndex, scale, rotation: state.rotation });
  }

  function rotate(direction: -1 | 1) {
    if (state.kind !== 'ready') return;
    const rotation = (state.rotation + direction * 90 + 360) % 360;
    const nextView = { pageIndex: state.pageIndex, scale: state.scale, rotation };
    if (zoomModeRef.current !== 'manual' && documentRef.current) {
      const pdf = documentRef.current;
      const requestId = requestIdRef.current;
      const mode = zoomModeRef.current;
      void fittedScale(pdf, nextView, mode).then((scale) => {
        if (isCurrent(requestId) && documentRef.current === pdf && zoomModeRef.current === mode) void applyZoomView({ ...nextView, scale });
      });
    } else void applyZoomView(nextView);
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
    if (searchIndex.kind === 'idle') return t('reader.search.afterLoad');
    if (searchIndex.kind === 'unavailable' || searchIndex.kind === 'error') return display(searchIndex.message);
    const progress = t('reader.search.progress', { count: searchIndex.indexedPageCount, total: searchIndex.pageCount });
    const extractionWarning = searchIndex.failedPageCount > 0
      ? t('reader.search.extractionWarning', { count: searchIndex.failedPageCount })
      : '';
    if (!query) {
      return searchIndex.kind === 'indexing'
        ? t('reader.search.indexingProgress', { progress })
        : t('reader.search.indexedProgress', { progress, warning: extractionWarning });
    }
    const resultSummary = searchMatches.length === 0
      ? t('reader.search.noMatches')
      : t('reader.search.matchesOnPages', { matches: searchMatches.length, pages: new Set(searchMatches.map((match) => match.pageIndex)).size });
    const activeMatch = searchMatches[activeSearchMatch];
    const activeSummary = activeMatch
      ? t('reader.search.viewingMatch', { match: activeSearchMatch + 1, page: activeMatch.pageIndex + 1, detail: activeMatch.precision === 'exact'
        ? t('reader.search.exactDetail', { start: activeMatch.rawStart ?? 0, end: activeMatch.rawEnd ?? 0 })
        : t(activeMatch.precision === 'block' ? 'reader.search.blockDetail' : 'reader.search.pageDetail') })
      : '';
    return searchIndex.kind === 'indexing'
      ? t('reader.search.summaryIndexing', { result: resultSummary, progress, active: activeSummary })
      : t('reader.search.summaryReady', { result: resultSummary, warning: extractionWarning, active: activeSummary });
  }

  function extractionStatus(): string {
    if (extraction.kind === 'idle') return t('reader.tools.extractionAfterLoad');
    if (extraction.kind === 'error') return display(extraction.message);
    if (extraction.kind === 'extracting') {
      return t('reader.tools.extracting', { count: extraction.extractedPageCount, total: extraction.pageCount, text: extraction.textPageCount, empty: extraction.emptyPageCount, failed: extraction.failedPageCount });
    }
    const coverage = t(extraction.coverage === 'full' ? 'reader.tools.coverageFull' : extraction.coverage === 'partial' ? 'reader.tools.coveragePartial' : 'reader.tools.coverageUnreadable');
    const transformedBlocks = pageBlocksRef.current.filter((block) => block.qualityFlags.some((flag) => flag.startsWith('normalized-') || flag === 'offset-map-ambiguous')).length;
    return t('reader.tools.extractionSummary', { coverage, text: extraction.textPageCount, total: extraction.pageCount, empty: extraction.emptyPageCount, failed: extraction.failedPageCount, blocks: extraction.blockCount, version: PDF_PAGE_BLOCK_EXTRACTION_VERSION, transformed: transformedBlocks });
  }

  useEffect(() => {
    if (automaticArxivImportStartedRef.current) return;
    const fragment = parseReaderSourceFragment(window.location.hash);
    if (fragment.kind === 'invalid') {
      automaticArxivImportStartedRef.current = true;
      setState({ kind: 'error', message: uiText(readerFragmentErrorKey(fragment.message)) });
      return;
    }
    if (fragment.kind === 'pdf') {
      automaticArxivImportStartedRef.current = true;
      void importFragmentPdf(fragment.url, fragment.pageIndex);
      return;
    }
    if (fragment.kind === 'local') {
      // A digest identifies a previously imported File but cannot grant access to its bytes.
      automaticArxivImportStartedRef.current = true;
      return;
    }
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

  const pdfImportForm = (
        <form className="url-import" onSubmit={importUrl}>
          <label htmlFor="pdf-url">{t(state.kind === 'ready' ? 'reader.directPdfUrl' : 'reader.welcome.link')}</label>
          <div className="url-import-controls">
            <input id="pdf-url" type="url" value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://example.org/paper.pdf" inputMode="url" required />
            <button type="submit" disabled={state.kind === 'loading' || state.kind === 'requesting-permission'} aria-label={t('reader.importPdfUrl')}>{state.kind === 'ready' ? t('reader.import') : <ReaderIcon name="next" />}</button>
          </div>
          {state.kind !== 'ready' && <p>{t('reader.welcome.importHint')}</p>}
        </form>
  );

  const canGoBack = historyRevision >= 0 && locationHistoryRef.current.back.length > 0;
  const canGoForward = historyRevision >= 0 && locationHistoryRef.current.forward.length > 0;
  const panelStyle = { '--left-panel-width': `${panelWidths.left}px`, '--right-panel-width': `${panelWidths.right}px` } as CSSProperties;

  function renderInlineEvidence(text: string, refs: readonly VerifiedEvidenceRef[], renderMath = false) {
    return inlineEvidenceParts(text, refs).map((part, index) => {
      if (part.kind === 'text') return renderMath ? <LimitedMath key={`text-${index}`} text={part.value} /> : part.value;
      const category = t(part.alias.startsWith('E') ? 'reader.evidence.sourceDetailed' : 'reader.evidence.sourceThreeLine');
      const groups = buildInlineEvidenceExcerpts(
        part.evidenceIds,
        detailedLedger?.candidates ?? (evidenceLedger.kind === 'ready' ? evidenceLedger.ledger.candidates : []),
        extraction.kind === 'ready' ? extraction.pages : [],
      );
      return <button type="button" className="inline-evidence-button" key={`${part.alias}-${index}`} aria-haspopup="dialog"
        aria-label={t('reader.evidence.showMembers', { category, alias: part.alias, count: part.evidenceIds.length })}
        onClick={(event) => {
          evidenceTriggerRef.current = event.currentTarget;
          setActiveEvidence({ alias: part.alias, category, count: part.evidenceIds.length, groups });
        }}>{inlineEvidenceLabel(part)}</button>;
    });
  }

  return (
    <main ref={readerPageRef} style={panelStyle} className={`reader-page reader-page--${state.kind === 'ready' ? 'loaded' : 'empty'}${leftRailOpen ? ' has-left-rail' : ''}${rightRailOpen ? ' has-right-rail' : ''}`} aria-labelledby="page-title" data-reader-shell="B053" data-reader-layout="edge-tabs">
      {activeEvidence && <dialog ref={evidenceDialogRef} className="inline-evidence-dialog" aria-labelledby="inline-evidence-title"
        onCancel={() => setActiveEvidence(null)} onClose={() => setActiveEvidence(null)}
        onClick={(event) => {
          if (event.target !== event.currentTarget) return;
          const rect = event.currentTarget.getBoundingClientRect();
          if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) setActiveEvidence(null);
        }}>
        <header className="inline-evidence-dialog-header">
          <h2 id="inline-evidence-title">{activeEvidence.category} {activeEvidence.alias}</h2>
          <button type="button" autoFocus aria-label={t('reader.evidence.close')} onClick={() => setActiveEvidence(null)}>×</button>
        </header>
        <div className="inline-evidence-excerpts">
          {activeEvidence.groups.map((group, groupIndex) => <p className="inline-evidence-excerpt" key={groupIndex}>
            {groupIndex > 0 && <span className="inline-evidence-break">{t('reader.evidence.separateExcerpt')}</span>}
            {group.members.map((item) => {
              const member = t('reader.evidence.member', { index: item.index, count: activeEvidence.count });
              const description = item.location && t('reader.evidence.goTo', { category: activeEvidence.category, alias: activeEvidence.alias, member, page: item.location.pageIndex + 1, precision: t(`reader.evidence.precision.${item.location.precision}` as MessageKey) });
              return <span key={item.evidenceId}>{item.separatorBefore}{description
                ? <button type="button" className="inline-evidence-quote" aria-label={`${item.quote}; ${description}`} title={description} onClick={() => { setActiveEvidence(null); goToEvidenceCandidate(item.evidenceId); }}>{item.displayQuote}</button>
                : <span className="inline-evidence-unlocated">{item.displayQuote || t('reader.evidence.unavailable')} <small>({t('reader.evidence.unlocated')})</small></span>}</span>;
            })}
          </p>)}
        </div>
      </dialog>}
      <div className={state.kind === 'ready' ? 'reader-loaded-header' : 'reader-first-screen'}>
      <input ref={fileInputRef} id="local-pdf-input" className="file-picker-input" aria-label={t('reader.chooseLocalPdf')} tabIndex={-1} type="file" accept="application/pdf,.pdf" onChange={onFileChange} />
      {state.kind === 'ready' ? <header className="reader-header" aria-label={t('reader.toolbar')}>
        <div className="toolbar-document">
          <h1 id="page-title" title={state.fileName}>{state.fileName}</h1>
        </div>
        <div className="toolbar-reading-controls">
          <div className="toolbar-group toolbar-history" role="group" aria-label={t('reader.history.group')}>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.history.previous')} title={t('reader.history.previous')} onClick={() => navigateLocationHistory('back')} disabled={!canGoBack}><ReaderIcon name="historyBack" /></button>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.history.next')} title={t('reader.history.next')} onClick={() => navigateLocationHistory('forward')} disabled={!canGoForward}><ReaderIcon name="historyForward" /></button>
          </div>
          <div className="toolbar-group" role="group" aria-label={t('reader.page.navigation')}>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.page.previous')} title={t('reader.page.previous')} onClick={() => goToPage(state.pageIndex - 1)} disabled={isRendering || state.pageIndex === 0}><ReaderIcon name="previous" /></button>
            <form className="toolbar-page-position" onSubmit={submitPage}>
              <label className="visually-hidden" htmlFor="page-number">{t('reader.page.label')}</label>
              <input id="page-number" type="text" inputMode="numeric" pattern="[0-9]*" value={pageInput} onChange={(event) => setPageInput(event.target.value)} aria-describedby="page-count" disabled={isRendering} />
              <span id="page-count">/ {state.pageCount}</span>
            </form>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.page.next')} title={t('reader.page.next')} onClick={() => goToPage(state.pageIndex + 1)} disabled={isRendering || state.pageIndex === state.pageCount - 1}><ReaderIcon name="next" /></button>
          </div>
          <div className="toolbar-group toolbar-view" role="group" aria-label={t('reader.view.group')}>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.view.zoomOut')} title={t('reader.view.zoomOut')} onClick={() => adjustScale(-1)} disabled={isRendering || state.scale <= MIN_SCALE}><ReaderIcon name="minus" /></button>
            <label className="visually-hidden" htmlFor="toolbar-zoom-input">{t('reader.view.zoomInput')}</label>
            <div className="toolbar-zoom-control">
              <input id="toolbar-zoom-input" className="toolbar-zoom-input" name="zoomPercent" type="text" inputMode="numeric" pattern="[0-9]*" enterKeyHint="done" value={zoomInputEditing ? zoomInputDraft : zoomPercentDisplay(state.scale, false)} onFocus={(event) => { const input = event.currentTarget; zoomInputDirtyRef.current = false; setZoomInputDraft(zoomPercentDisplay(state.scale, true)); setZoomInputEditing(true); window.requestAnimationFrame(() => { if (document.activeElement === input) input.select(); }); }} onChange={(event) => { zoomInputDirtyRef.current = true; setZoomInputDraft(event.target.value); setZoomInputInvalid(false); }} onBlur={commitZoomInput} onKeyDown={(event) => { if (shouldCommitZoomOnKeyDown(event.key, event.nativeEvent.isComposing)) { event.preventDefault(); commitZoomInput(); event.currentTarget.blur(); } else if (event.key === 'Escape') { zoomInputDirtyRef.current = false; setZoomInputEditing(false); setZoomInputInvalid(false); event.currentTarget.blur(); } }} aria-invalid={zoomInputInvalid} aria-describedby={zoomInputInvalid ? 'toolbar-zoom-status' : undefined} disabled={isRendering} />
              <details ref={zoomMenuRef} className="toolbar-zoom-presets" onKeyDown={(event) => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
                <summary aria-label={t('reader.view.zoomPresets')} title={t('reader.view.zoomPresets')} aria-disabled={isRendering} onClick={(event) => { if (isRendering) event.preventDefault(); }}><span aria-hidden="true">▾</span></summary>
                <div className="toolbar-zoom-presets-menu" role="group" aria-label={t('reader.view.zoomPresets')}>
                  {ZOOM_CHOICES.map((choice) => <button key={choice} type="button" aria-current={zoomChoice === choice ? 'true' : undefined} onClick={() => changeZoomChoice(choice)} disabled={isRendering}>{choice === 'auto' ? t('reader.view.zoomAuto') : choice === 'actual' ? t('reader.view.zoomActual') : choice === 'fit-page' ? t('reader.view.zoomFitPage') : choice === 'fit-width' ? t('reader.view.zoomFitWidth') : `${choice}%`}</button>)}
                </div>
              </details>
              <span id="toolbar-zoom-status" className="toolbar-zoom-status" role="status" aria-live="polite">{zoomInputInvalid ? t('reader.view.zoomRangeError') : ''}</span>
            </div>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.view.zoomIn')} title={t('reader.view.zoomIn')} onClick={() => adjustScale(1)} disabled={isRendering || state.scale >= MAX_SCALE}><ReaderIcon name="plus" /></button>
            <button type="button" className="toolbar-icon-button toolbar-rotate-ccw" aria-label={t('reader.view.rotateCounterclockwise')} title={t('reader.view.rotateCounterclockwise')} onClick={() => rotate(-1)} disabled={isRendering}><ReaderIcon name="rotate" /></button>
            <button type="button" className="toolbar-icon-button" aria-label={t('reader.view.rotateClockwise')} title={t('reader.view.rotateClockwise')} onClick={() => rotate(1)} disabled={isRendering}><ReaderIcon name="rotate" /></button>
          </div>
        </div>
        <div className="toolbar-end-actions" role="group" aria-label={t('reader.toolbar.openConfigure')}>
          <form className="toolbar-url-import" onSubmit={importUrl}>
            <label className="visually-hidden" htmlFor="toolbar-pdf-url">{t('reader.directHttpsPdfUrl')}</label>
            <input id="toolbar-pdf-url" type="url" value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder={t('reader.httpsPdfUrl')} inputMode="url" required />
            <button type="submit" className="toolbar-icon-button" aria-label={t('reader.importPdfUrl')} title={t('reader.importPdfUrl')}><ReaderIcon name="next" /></button>
          </form>
          <details className="toolbar-overflow">
            <summary className="toolbar-icon-button" aria-label={t('reader.toolbar.more')} title={t('reader.toolbar.more')}><ReaderIcon name="more" /></summary>
            <div className="toolbar-overflow-content">
              {(canGoBack || canGoForward) && <div className="toolbar-overflow-history" role="group" aria-label={t('reader.history.group')}>
                <button type="button" className="reader-tools-action" onClick={() => navigateLocationHistory('back')} disabled={!canGoBack}>{t('reader.history.previousShort')}</button>
                <button type="button" className="reader-tools-action" onClick={() => navigateLocationHistory('forward')} disabled={!canGoForward}>{t('reader.history.nextShort')}</button>
              </div>}
              {pdfImportForm}
            </div>
          </details>
          <button type="button" className="toolbar-icon-button" aria-label={t('reader.choosePdf')} title={t('reader.choosePdf')} aria-controls="local-pdf-input" onClick={() => fileInputRef.current?.click()}><ReaderIcon name="document" /></button>
          <button type="button" className="toolbar-icon-button" aria-label={t('reader.reading.home')} title={t('reader.reading.home')} onClick={returnReaderHome}><ReaderIcon name="reading" /></button>
          <a className="toolbar-icon-button" href="options.html" aria-label={t('reader.settings')} title={t('reader.settings')}><ReaderIcon name="settings" /></a>
        </div>
      </header> : state.kind === 'loading' || state.kind === 'requesting-permission' ? <section className="reader-loading" aria-labelledby="page-title">
        <div className="reader-loading-document" aria-hidden="true">
          <ReaderIcon name="document" />
          <span className="reader-loading-lines"><span /><span /><span /></span>
        </div>
        <h1 id="page-title">{t('reader.loading.title')}</h1>
        <p id="reader-loading-copy" className="reader-loading-copy" role="status" aria-live="polite">
          {t(state.kind === 'requesting-permission' ? 'reader.loading.requestingPermission' : 'reader.loading.opening')}
        </p>
        <p className="reader-loading-file" title={state.fileName}>{state.fileName}</p>
        <div className="reader-loading-track" aria-hidden="true" />
        <progress className="reader-loading-progress" aria-labelledby="reader-loading-copy" />
        <button type="button" className="reader-loading-cancel" onClick={cancelImport}>{t('reader.cancel')}</button>
      </section> : <section className="reader-welcome" aria-label={t('reader.welcome.open')}>
        <div className="welcome-mark"><ReaderIcon name="document" /></div>
        <p className="welcome-kicker">{t('reader.appName')}</p>
        <h1 id="page-title">{t('reader.welcome.title')}</h1>
        <p className="welcome-description">{t('reader.welcome.description')}</p>
        <button type="button" className="file-picker" aria-controls="local-pdf-input" onClick={() => fileInputRef.current?.click()}><ReaderIcon name="document" /> {t('reader.choosePdf')}</button>
        <p className="welcome-local-note">{t('reader.welcome.localNote')}</p>
      </section>}
      {state.kind !== 'ready' && state.kind !== 'loading' && state.kind !== 'requesting-permission' && <section className="reader-import" aria-label={t('reader.welcome.import')}>{pdfImportForm}</section>}
      {state.kind !== 'ready' && state.kind !== 'loading' && state.kind !== 'requesting-permission' && <a className="welcome-settings" href="options.html"><ReaderIcon name="settings" /> {t('reader.settings')}</a>}
      <section className={`reader-status${state.kind === 'ready' || state.kind === 'idle' || state.kind === 'loading' || state.kind === 'requesting-permission' ? ' visually-hidden' : ''}`} aria-live="polite" role="status">
        {state.kind === 'ready' && t('reader.status.ready', { page: state.pageIndex + 1, count: state.pageCount, zoom: Math.round(state.scale * 100) })}
        {(state.kind === 'cancelled' || state.kind === 'error') && display(state.message)}
      </section>
      {readingNotice && <p className="reading-reopen-notice" role="status">{readingNotice}</p>}
      </div>
      {state.kind !== 'ready' && state.kind !== 'loading' && state.kind !== 'requesting-permission' && <section className="reading-dashboard" aria-label={t('reader.reading.title')}><ReadingActivity snapshot={readingSnapshot} t={t} locale={locale} /><h2>{t('reader.reading.title')}</h2><ReadingHistoryList {...readingListProps} /></section>}
      <div className="reader-workspace">
        {state.kind === 'ready' && (leftRailOpen || rightRailOpen) && <button type="button" className="rail-backdrop" aria-label={t('reader.rail.closeSide')} tabIndex={-1} onClick={() => { setLeftRailOpen(false); setRightRailOpen(false); }} />}
        {state.kind === 'ready' && <>
          <nav className="edge-rail edge-rail-left" aria-label={t('reader.rail.documentPanels')} onKeyDown={(event) => onRailTabKeyDown(event, 'left')}>
            <div role="tablist" aria-label={t('reader.rail.documentPanels')} aria-orientation="vertical">
              {([{ id: 'outline', label: 'reader.rail.outline', icon: 'outline' }, { id: 'pages', label: 'reader.rail.pages', icon: 'pages' }, { id: 'reading', label: 'reader.reading.title', icon: 'reading' }] as const).map((tab) => <button type="button" role="tab" id={`left-${tab.id}-tab`} key={tab.id} aria-label={t(tab.label)} title={t(tab.label)} aria-selected={leftRailOpen && leftRailTab === tab.id} aria-expanded={leftRailOpen && leftRailTab === tab.id} aria-controls={`left-${tab.id}-panel`} tabIndex={leftRailTab === tab.id ? 0 : -1} onClick={() => openRailTab('left', tab.id, true)}><ReaderIcon name={tab.icon} /></button>)}
            </div>
          </nav>
          <nav className="edge-rail edge-rail-right" aria-label={t('reader.rail.researchPanels')} onKeyDown={(event) => onRailTabKeyDown(event, 'right')}>
            <div role="tablist" aria-label={t('reader.rail.researchPanels')} aria-orientation="vertical">
              {([{ id: 'overview', label: 'reader.rail.overview', icon: 'insights' }, { id: 'search', label: 'reader.rail.search', icon: 'search' }, { id: 'tools', label: 'reader.rail.tools', icon: 'tools' }] as const).map((tab) => <button type="button" role="tab" id={`right-${tab.id}-tab`} key={tab.id} aria-label={t(tab.label)} title={t(tab.label)} aria-selected={rightRailOpen && rightRailTab === tab.id} aria-expanded={rightRailOpen && rightRailTab === tab.id} aria-controls={`right-${tab.id}-panel`} tabIndex={rightRailTab === tab.id ? 0 : -1} onClick={() => openRailTab('right', tab.id, true)}><ReaderIcon name={tab.icon} /></button>)}
            </div>
          </nav>
        </>}
      {state.kind === 'ready' && rightRailOpen && <aside className="reader-information" aria-label={t('reader.rail.researchPanel')}>
        <div className="rail-resize-handle rail-resize-handle--right" role="separator" tabIndex={0} aria-label={t('reader.rail.resizeResearch')} aria-orientation="vertical" aria-valuemin={panelWidthLimits('right').min} aria-valuemax={panelWidthLimits('right').max} aria-valuenow={panelWidths.right} onPointerDown={(event) => startPanelResize('right', event)} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize} onKeyDown={(event) => onPanelResizeKeyDown('right', event)} />
        <button type="button" className="rail-dismiss" aria-label={t('reader.rail.closeResearch')} onClick={() => closeRail('right')}><ReaderIcon name="close" /></button>
      {rightRailTab === 'overview' && <section className="extraction-diagnostics paper-insights" id="right-overview-panel" role="tabpanel" aria-labelledby="right-overview-tab">
        <h2 id="evidence-ledger-title" className="paper-insights-title">{t('reader.insights.kicker')}</h2>
        {evidenceLedger.kind === 'idle' || evidenceLedger.kind === 'building'
          ? <p aria-live="polite">{t('reader.insights.preparingEvidence')}</p>
          : evidenceLedger.kind === 'error'
            ? <p className="extraction-caution" role="status">{display(evidenceLedger.message)}</p>
            : <>
              <section className="overview-panel" aria-labelledby="paper-overview-title">
                <div className="insight-heading-row">
                  <h3 id="paper-overview-title">{t('reader.insights.threeLine')}</h3>
                  <button type="button" className="insight-generate-button" aria-label={t('reader.insights.generateThreeLine')} title={t('reader.insights.generateThreeLine')} onClick={() => startThreeLineOverview()} disabled={overview?.status === 'preparing' || overview?.status === 'generating'}><ReaderIcon name="generate" /></button>
                </div>
                {overview?.status === 'preparing' && <p role="status">{t('reader.insights.requestingPermission')}</p>}
                {overview?.status === 'generating' && <p role="status">{t('reader.insights.generatingThreeLine')} <button type="button" onClick={cancelThreeLineOverview}>{t('reader.cancel')}</button></p>}
                {overview?.status === 'error' && <p className="overview-error" role="alert">{display(overview.message)} <a href="options.html">{t('reader.insights.openSettings')}</a></p>}
                {overview?.status === 'success' && overview.result && <>
                  <ol className="overview-items">
                    {overview.result.items.map((item, index) => <li key={`${index}-${item.text}`}>
                      <div className="insight-text">{renderInlineEvidence(item.text, item.evidenceRefs)}</div>
                      {item.status === 'unavailable' && <span className="overview-unavailable">{t('reader.insights.unavailableContribution')}</span>}
                    </li>)}
                  </ol>
                  {overview.result.uncertainties.length > 0 && <p className="overview-uncertainties">{t('reader.insights.uncertainties', { text: overview.result.uncertainties.map((item) => item.text).join(' ') })}</p>}
                </>}
                <section className="detailed-overview-panel" aria-labelledby="detailed-overview-title">
                  <div className="insight-heading-row">
                    <h4 id="detailed-overview-title">{t('reader.insights.detailed')}</h4>
                    <button type="button" className="insight-generate-button" aria-label={t('reader.insights.generateDetailed')} title={t('reader.insights.generateDetailed')} onClick={() => startDetailedOverview()} disabled={detailedOverview?.status === 'preparing' || detailedOverview?.status === 'generating'}><ReaderIcon name="generate" /></button>
                  </div>
                  {detailedOverview?.status === 'preparing' && <p role="status">{t('reader.insights.requestingPermission')}</p>}
                  {detailedOverview?.status === 'generating' && <p role="status">{t('reader.insights.generatingDetailed')} <button type="button" onClick={cancelDetailedOverview}>{t('reader.cancel')}</button></p>}
                  {detailedOverview?.status === 'error' && <p className="overview-error" role="alert">{display(detailedOverview.message)} <a href="options.html">{t('reader.insights.openSettings')}</a></p>}
                  {detailedOverview?.status === 'cancelled' && <p role="status">{t('reader.error.overviewCancelled')}</p>}
                  {(detailedOverview?.result || detailedOverview?.completedSections?.length) ? <>
                    <div className="detailed-overview-sections">
                      {(detailedOverview.result?.sections ?? detailedOverview.completedSections ?? []).map((section) => <section key={section.id} className="detailed-overview-section">
                        <h5>{t(DETAILED_SECTION_LABEL_KEYS[section.id])}</h5>
                        {section.status !== 'available' && (section.failureReasons ?? (section.failureReason ? [section.failureReason] : [undefined])).map((reason, index) => <p key={index} className="overview-unavailable">{t(section.status === 'not_applicable' ? 'reader.insights.notApplicable' : reason ? DETAILED_FAILURE_LABEL_KEYS[reason] : 'reader.insights.insufficient')}</p>)}
                        {section.blocks.filter(block => block.text.trim()).map((block, index) => <div key={`${section.id}-${index}`} className="detailed-overview-block">
                          <div className="insight-text">{renderInlineEvidence(section.status !== 'available' && block.text === UNGROUNDED_DETAILED_SECTION_FALLBACK ? t('reader.insights.ungroundedFallback') : block.text, block.evidenceRefs ?? [], true)}</div>
                        </div>)}
                      </section>)}
                    </div>
                    {!!detailedOverview.result?.uncertainties.length && <p className="overview-uncertainties">{t('reader.insights.uncertainties', { text: detailedOverview.result.uncertainties.map((item) => item.text).join(' ') })}</p>}
                  </> : null}
                </section>
              </section>
              {(overview?.status === 'success' || detailedOverview?.status === 'success' || insightUsage.requestCount > 0) && <p className="insight-usage">
                {t('reader.insights.usageLabel')}: {t('reader.insights.usageInput', { count: insightTokenCount(insightUsage.inputTokens, insightUsage.inputComplete, insightUsage.requestCount, locale) })}
                {' · '}{t('reader.insights.usageOutput', { count: insightTokenCount(insightUsage.outputTokens, insightUsage.outputComplete, insightUsage.requestCount, locale) })}
                {' · '}{t('reader.insights.usageCacheRate', { rate: insightUsage.cacheHitRate === undefined ? '—' : `${insightUsage.cacheHitRate}%` })}
                {(!insightUsage.inputComplete || !insightUsage.outputComplete) && <span className="insight-usage-note">{t('reader.insights.usagePartial')}</span>}
              </p>}
            </>}
        </section>}

        {rightRailTab === 'search' && <section className="rail-tool-panel" id="right-search-panel" role="tabpanel" aria-labelledby="right-search-tab">
          <h2>{t('reader.rail.search')}</h2>
      <section className="search-controls" aria-label={t('reader.search.fullDocument')}>
        <div className="search-input">
          <label className="visually-hidden" htmlFor="document-search">{t('reader.search.find')}</label>
          <input id="document-search" type="search" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder={t('reader.search.find')} autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter') navigateSearchMatch(event.shiftKey ? -1 : 1); }} disabled={searchIndex.kind === 'unavailable' || searchIndex.kind === 'error'} />
        </div>
        <div className="search-navigation" role="group" aria-label={t('reader.search.navigation')}>
          <output aria-live="polite" aria-label={t('reader.search.statusLabel')} title={searchStatus()}>{searchQuery.trim() ? `${activeSearchMatch < 0 ? 0 : activeSearchMatch + 1} / ${searchMatches.length}` : t('reader.search.allPages')}</output>
          <button type="button" className="toolbar-icon-button" aria-label={t('reader.search.previousMatch')} title={t('reader.search.previousMatch')} onClick={() => navigateSearchMatch(-1)} disabled={isRendering || searchMatches.length === 0}><ReaderIcon name="previous" /></button>
          <button type="button" className="toolbar-icon-button" aria-label={t('reader.search.nextMatch')} title={t('reader.search.nextMatch')} onClick={() => navigateSearchMatch(1)} disabled={isRendering || searchMatches.length === 0}><ReaderIcon name="next" /></button>
        </div>
        {(searchIndex.kind === 'unavailable' || searchIndex.kind === 'error') && <p role="status">{display(searchIndex.message)}</p>}
      </section>

          <p className="search-detail-status" role="status">{searchStatus()}</p>
        </section>}
        {rightRailTab === 'tools' && <section className="rail-tool-panel" id="right-tools-panel" role="tabpanel" aria-labelledby="right-tools-tab">
          <h2>{t('reader.rail.tools')}</h2>
              <section className="highlight-storage-controls" aria-label={t('reader.tools.savedHighlights')}>
                <p role="status">{highlightStorageStatus ? display(highlightStorageStatus) : t('reader.tools.highlightsPending')}</p>
                <button type="button" onClick={clearCurrentDocumentHighlights} disabled={!documentContentKey}>{t('reader.tools.clearHighlights')}</button>
              </section>
              <section className="translation-history" aria-labelledby="translation-history-title">
                <h2 id="translation-history-title">{t('reader.tools.completedTranslations')}</h2>
                <p role="status">{translationStorageStatus ? display(translationStorageStatus) : t(documentContentKey ? 'reader.tools.checkingTranslations' : 'reader.tools.translationsNoVersion')}</p>
                {savedTranslations.length > 0 && <ul>
                  {savedTranslations.map((job) => <li key={job.jobId}>
                    <button type="button" onClick={() => openSavedTranslation(job)}>{t('reader.tools.openSavedTranslation')}</button>
                    <span>{job.selectedText.length > 100 ? `${job.selectedText.slice(0, 100)}…` : job.selectedText}</span>
                  </li>)}
                </ul>}
              </section>

          <details className="reader-diagnostics"><summary>{t('reader.tools.debug')}</summary>
            {overview?.status === 'success' && overview.result && <p>{t('reader.tools.evidenceExplainer')}</p>}
            {evidenceLedger.kind === 'ready' && detailedOverview?.status === 'success' && <p>{t('reader.tools.coverage', { coverage: evidenceCoverageLabel(evidenceLedger.ledger.coverage, t) })}</p>}
            {detailedOverview?.status === 'success' && detailedOverview.diagnostics && <details className="detailed-overview-diagnostics">
              <summary>{t('reader.tools.requestDiagnostics')}</summary>
              <p className="extraction-caution">{t('reader.tools.requestPrivacy')}</p>
              {totalCacheRateLabel(detailedOverview.diagnostics, t) && <p>{totalCacheRateLabel(detailedOverview.diagnostics, t)}</p>}
              <ul>
                {detailedOverview.diagnostics.sections.map((diagnostic) => {
                  const usageParts = [
                    tokenCountLabel(diagnostic.usage?.promptTokens, t) && t('reader.tools.promptTokens', { count: tokenCountLabel(diagnostic.usage?.promptTokens, t)! }),
                    tokenCountLabel(diagnostic.usage?.completionTokens, t) && t('reader.tools.completionTokens', { count: tokenCountLabel(diagnostic.usage?.completionTokens, t)! }),
                    cacheRateLabel(diagnostic.usage, t),
                  ].filter((part): part is string => Boolean(part));
                  return <li key={diagnostic.id}>
                    {diagnostic.id === 'method' && diagnostic.semanticReviewEnabled === false && <p>{t('reader.tools.methodReviewOff')}</p>}
                    {diagnostic.failures?.map((failure, index) => <p key={index}>{t(DETAILED_FAILURE_LABEL_KEYS[failure.reason])} <small>{failure.detail}</small></p>)}
                    {!!diagnostic.formatRepairCount && <p>{t('reader.tools.formatRepair', { count: diagnostic.formatRepairCount })}</p>}
                    {diagnostic.id === 'method' && diagnostic.semanticReviewEnabled && diagnostic.semanticReviewCount !== undefined && <p>{t('reader.tools.methodReview', { count: diagnostic.semanticReviewCount, skipped: diagnostic.semanticReviewSkipped ?? 0 })}</p>}
                    {diagnostic.batchCount && diagnostic.batchCount > 1 && <p>{t('reader.tools.chapterBatches', { count: diagnostic.batchCount })}</p>}
                    {t('reader.tools.newPassages', { section: t(DETAILED_SECTION_LABEL_KEYS[diagnostic.id]), newCount: diagnostic.newSourceCount, aliasCount: diagnostic.availableAliasCount, usage: usageParts.length > 0 ? `; ${usageParts.join(', ')}.` : t('reader.tools.usageUnavailable') })}
                  </li>;
                })}
              </ul>
            </details>}
              <section className="extraction-diagnostics" aria-labelledby="extraction-diagnostics-title">
        <h2 id="extraction-diagnostics-title">{t('reader.tools.textDiagnostics')}</h2>
        <p aria-live="polite">{extractionStatus()}</p>
        <p className="extraction-caution">{t('reader.tools.textOrderCaution')}</p>
        <p className="extraction-caution">{t('reader.tools.offsetCaution')}</p>
        {extraction.kind === 'ready' && <details>
          <summary>{t('reader.tools.inspectCoverage')}</summary>
          <ul className="extraction-page-list">
            {extraction.pages.map((page) => <li key={page.pageIndex}>
              {t(page.status === 'text' ? 'reader.tools.pageTextBlocks' : page.status === 'empty' ? 'reader.tools.pageNoText' : 'reader.tools.pageExtractionFailed', { page: page.pageIndex + 1, count: page.blocks.length, detail: page.error ? ` (${page.error})` : '' })}
            </li>)}
          </ul>
        </details>}
      </section>
      {state.kind === 'ready' && <section className="extraction-diagnostics" aria-labelledby="citation-diagnostics-title">
        <h2 id="citation-diagnostics-title">{t('reader.tools.citationDiagnostics')}</h2>
        {citationIndex.kind === 'idle' || citationIndex.kind === 'indexing'
          ? <p aria-live="polite">{t('reader.tools.indexingCitations')}</p>
          : citationIndex.kind === 'error'
            ? <p className="extraction-caution" role="status">{display(citationIndex.message)}</p>
            : <>
              <p aria-live="polite">{t('reader.tools.citationCounts', { references: citationIndex.index.references.length, markers: citationIndex.index.occurrences.length, matched: citationIndex.index.matchedOccurrenceCount, ambiguous: citationIndex.index.ambiguousOccurrenceCount, unresolved: citationIndex.index.unresolvedOccurrenceCount })}</p>
              <p className="extraction-caution">{citationIndex.index.referenceHeading
                ? t('reader.citation.diagnosticHeading', { page: citationIndex.index.referenceHeading.anchor.pageIndex + 1 })
                : t('reader.citation.diagnosticNoHeading')}</p>
              <p className="extraction-caution">{t('reader.citation.diagnosticOrder')}</p>
              <p className="extraction-caution">{t('reader.citation.diagnosticMatched')}</p>
              <details>
                <summary>{t('reader.tools.inspectCitations')}</summary>
                <ul className="extraction-page-list">
                  {citationIndex.index.referenceHeading && <li>{t('reader.tools.heuristicHeading', { page: citationIndex.index.referenceHeading.anchor.pageIndex + 1, text: citationIndex.index.referenceHeading.rawText })}</li>}
                  {citationIndex.index.references.slice(0, 50).map((reference) => <li key={reference.refId}>{t('reader.tools.referenceCandidate', { number: reference.number, page: reference.anchor.pageIndex + 1, text: reference.rawText })}</li>)}
                  {citationIndex.index.references.length > 50 && <li>{t('reader.tools.moreReferences', { count: citationIndex.index.references.length - 50 })}</li>}
                  {citationIndex.index.occurrences.slice(0, 100).map((occurrence) => <li key={occurrence.occurrenceId}>{t('reader.tools.markerCandidate', { marker: occurrence.displayMarker, page: occurrence.anchor.pageIndex + 1, status: t(`reader.citation.status.${occurrence.status}` as MessageKey), basis: occurrence.basis.map((item) => t(`reader.citation.basis.${item}` as MessageKey)).join(', ') })}</li>)}
                  {citationIndex.index.occurrences.length > 100 && <li>{t('reader.tools.moreMarkers', { count: citationIndex.index.occurrences.length - 100 })}</li>}
                  {citationIndex.index.references.length === 0 && citationIndex.index.occurrences.length === 0 && <li>{t('reader.tools.noCitations')}</li>}
                </ul>
              </details>
            </>}
      </section>}

        {viewStorageStatus && <p role="status">{display(viewStorageStatus)}</p>}
          {evidenceLedger.kind === 'ready' && <details className="overview-source-details">
                <summary>{t('reader.tools.sourceCoverage')}</summary>
                <p aria-live="polite">{t('reader.tools.sourceCounts', { count: evidenceLedger.ledger.candidates.length, coverage: evidenceCoverageLabel(evidenceLedger.ledger.coverage, t) })}</p>
                <p className="extraction-caution">{t('reader.evidence.diagnosticCandidateCount', { count: evidenceLedger.ledger.candidates.length })}</p>
                <p className="extraction-caution">{t('reader.evidence.diagnosticExcluded', { references: evidenceLedger.ledger.excluded.referencesBlockCount, unreliable: evidenceLedger.ledger.excluded.unreliableBlockCount })}</p>
                <p className="extraction-caution">{t(evidenceLedger.ledger.coverage === 'full-text' ? 'reader.evidence.diagnosticFull' : 'reader.evidence.diagnosticPartial')}</p>
                <p className="extraction-caution">{t('reader.tools.sourceCaution')}</p>
                <ul className="extraction-page-list">
                  {evidenceLedger.ledger.candidates.slice(0, 100).map((candidate) => <li key={candidate.evidenceId}>
                    <button type="button" onClick={() => goToEvidenceCandidate(candidate.evidenceId)}>{t('reader.tools.goToPage', { page: locateEvidenceCandidate(candidate, extraction.kind === 'ready' ? extraction.pages : [])?.pageIndex! + 1 })}</button>
                    {' '}{t('reader.tools.candidateLocation', { slot: t(`reader.evidence.slot.${candidate.slot}` as MessageKey), section: candidate.section.confidence === 'unknown' ? t('reader.tools.unknownSection') : candidate.section.title, precision: t(`reader.evidence.precision.${candidate.precision}` as MessageKey), quote: candidate.quote.length > 180 ? `${candidate.quote.slice(0, 180)}…` : candidate.quote })}
                  </li>)}
                  {evidenceLedger.ledger.candidates.length > 100 && <li>{t('reader.tools.moreCandidates', { count: evidenceLedger.ledger.candidates.length - 100 })}</li>}
                  {evidenceLedger.ledger.candidates.length === 0 && <li>{t('reader.tools.noCandidates')}</li>}
                </ul>
              </details>}
        </details>
        </section>}
      </aside>}
        {state.kind === 'ready' && leftRailOpen && <aside className="reader-navigation" aria-label={t('reader.rail.documentPanel')}>
          <div className="rail-resize-handle rail-resize-handle--left" role="separator" tabIndex={0} aria-label={t('reader.rail.resizeDocument')} aria-orientation="vertical" aria-valuemin={panelWidthLimits('left').min} aria-valuemax={panelWidthLimits('left').max} aria-valuenow={panelWidths.left} onPointerDown={(event) => startPanelResize('left', event)} onPointerMove={movePanelResize} onPointerUp={endPanelResize} onPointerCancel={endPanelResize} onKeyDown={(event) => onPanelResizeKeyDown('left', event)} />
          <button type="button" className="rail-dismiss" aria-label={t('reader.rail.closeDocument')} onClick={() => closeRail('left')}><ReaderIcon name="close" /></button>

          {leftRailTab === 'reading' && <section className="navigation-panel" id="left-reading-panel" role="tabpanel" aria-labelledby="left-reading-tab"><h2>{t('reader.reading.title')}</h2><ReadingHistoryList {...readingListProps} /></section>}
          {leftRailTab === 'outline' &&
          <section className="navigation-panel" id="left-outline-panel" role="tabpanel" aria-labelledby="left-outline-tab">
            <h2 id="outline-title">{t('reader.rail.outline')}</h2>
            {outline.kind === 'idle' || outline.kind === 'loading'
              ? <p>{t('reader.outline.reading')}</p>
              : outline.kind === 'ready'
                ? <nav aria-label={t('reader.outline.pdf')}><OutlineItems items={outline.items} depth={0} onNavigate={navigateOutline} label={t} /></nav>
                : <>
                  <p>{display(outline.message)}</p>
                  {autoSections.kind === 'idle' || autoSections.kind === 'identifying'
                    ? <p>{t('reader.outline.identifying')}</p>
                    : autoSections.kind === 'error'
                      ? <p className="navigation-notice">{display(autoSections.message)}</p>
                      : autoSections.candidates.length === 0
                        ? <p>{t('reader.outline.none')}</p>
                        : <nav aria-label={t('reader.outline.automaticNav')}>
                          <details className="outline-source-note"><summary>{t('reader.outline.automaticTitle')}</summary><p>{t('reader.outline.automaticHelp')}</p></details>
                          <ul className="outline-list automatic-outline-list">
                            {autoSections.candidates.map((candidate) => <li key={candidate.candidateId}>
                              <button
                                type="button"
                                className="outline-item"
                                onClick={() => navigateAutoSection(candidate)}
                                title={t('reader.outline.automaticTooltip', { confidence: t(`reader.outline.confidence.${candidate.confidence}` as MessageKey), page: candidate.pageIndex + 1 })}
                              >
                                {candidate.title} <span className="automatic-outline-meta">{candidate.pageIndex + 1}</span>
                              </button>
                            </li>)}
                          </ul>
                        </nav>}
                </>}
            {outlineNotice && <p className="navigation-notice" role="status">{display(outlineNotice)}</p>}
          </section>
          }
          {leftRailTab === 'pages' &&
          <section className="navigation-panel" id="left-pages-panel" role="tabpanel" aria-labelledby="left-pages-tab">
            <h2 id="thumbnails-title">{t('reader.rail.pages')}</h2>
            <p className="thumbnail-hint">{t('reader.page.count', { count: state.pageCount })}</p>
            <div className="thumbnail-list" aria-label={t('reader.page.thumbnails')}>
              {Array.from({ length: state.pageCount }, (_, pageIndex) => pageIndex)
                .map((pageIndex) => {
                  const thumbnail = thumbnails[pageIndex];
                  return <button
                    type="button"
                    className="thumbnail-button"
                    key={pageIndex}
                    onClick={() => goToPage(pageIndex)}
                    aria-current={pageIndex === state.pageIndex ? 'page' : undefined}
                    aria-label={t(pageIndex === state.pageIndex ? 'reader.page.goToCurrent' : 'reader.page.goTo', { page: pageIndex + 1 })}
                  >
                    {thumbnail?.kind === 'ready' && readerVisible
                      ? <img loading="lazy" decoding="async" src={thumbnail.src} alt={t('reader.page.thumbnail', { page: pageIndex + 1 })} />
                      : <span className="thumbnail-placeholder">{t(thumbnail?.kind === 'error' ? 'reader.page.previewUnavailable' : 'reader.page.previewRendering')}</span>}
                    <span>{t('reader.page.label')} {pageIndex + 1}</span>
                  </button>;
                })}
            </div>
          </section>
          }
        </aside>}
        <section ref={stageRef} className="reader-stage" aria-label={t('reader.page.continuous')}>
          {evidenceNavigationNotice && <p className="evidence-jump-notice" role="status">{display(evidenceNavigationNotice)}</p>}
          {state.kind === 'ready' && Array.from({ length: state.pageCount }, (_, pageIndex) => <div
            key={pageIndex}
            ref={(element) => {
              if (element) pageElementsRef.current.set(pageIndex, element);
              else pageElementsRef.current.delete(pageIndex);
              if (pageIndex === state.pageIndex) pdfPageRef.current = element;
            }}
            className={`pdf-page${pageIndex === state.pageIndex ? ' is-active-page' : ''}`}
            data-page-index={pageIndex}
            tabIndex={-1}
            role="group"
            aria-label={t('reader.page.pdfPage', { page: pageIndex + 1 })}
            onClick={pageIndex === state.pageIndex ? onPdfPageClick : () => changeView({ pageIndex, scale: state.scale, rotation: state.rotation })}
          >
          <canvas
            width={0}
            height={0}
            ref={(canvas) => {
              if (canvas) passivePageCanvasesRef.current.set(pageIndex, canvas);
              else passivePageCanvasesRef.current.delete(pageIndex);
              if (pageIndex === state.pageIndex) canvasRef.current = canvas;
            }}
            aria-label={t('reader.page.renderedPage', { page: pageIndex + 1 })}
          />
          {documentRef.current && <PdfLinkLayer pdf={documentRef.current} pageIndex={pageIndex} scale={state.scale} rotation={state.rotation} internalLabel={t('reader.links.internal')} interceptClick={(event) => {
            if (pageIndex !== state.pageIndex) return false;
            const bounds = pdfPageRef.current?.getBoundingClientRect();
            if (!bounds) return false;
            const linkBounds = event.currentTarget.getBoundingClientRect();
            const x = event.detail === 0 ? linkBounds.left + linkBounds.width / 2 : event.clientX;
            const y = event.detail === 0 ? linkBounds.top + linkBounds.height / 2 : event.clientY;
            const hit = citationHitRegions.find((region) => region.rects.some((rect) => x - bounds.left >= rect.left && x - bounds.left <= rect.left + rect.width && y - bounds.top >= rect.top && y - bounds.top <= rect.top + rect.height));
            if (!hit) return false;
            openCitation(hit.occurrenceId, event.currentTarget);
            return true;
          }} onDestination={(dest) => { void navigatePdfLink(dest); }} />}
          {pageIndex === state.pageIndex ? <>
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
            <div ref={citationOverlayRef} className="citation-hit-layer" aria-label={t('reader.citation.hitLayer')}>
              {citationHitRegions.flatMap((region) => {
                const citation = citationForId(region.occurrenceId);
                if (!citation) return [];
                return region.rects.map((rect, index) => <button
                  type="button"
                  key={`${region.occurrenceId}-${index}`}
                  className="citation-hit-region"
                  data-citation-id={region.occurrenceId}
                  aria-label={t('reader.citation.open', { marker: citation.occurrence.displayMarker, status: t(`reader.citation.status.${citation.occurrence.status}` as MessageKey) })}
                  title={t('reader.citation.openTitle', { marker: citation.occurrence.displayMarker })}
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
              aria-label={t('reader.text.selectable')}
              onMouseUp={captureTextLayerSelection}
              onKeyUp={onTextLayerKeyUp}
            />
          </> : null}
          </div>)}
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
          <h2 id="citation-popover-title">{t('reader.citation.title', { marker: activeCitation.occurrence.displayMarker })}</h2>
          <button type="button" onClick={() => dismissCitationPopover()} aria-label={t('reader.citation.close')}>{t('reader.citation.close')}</button>
        </div>
        {activeCitation.references.length > 0
          ? <ol className="citation-reference-list" role="list">
            {activeCitation.references.map((reference) => <ReferenceCard
              key={reference.refId}
              reference={reference}
              label={t('reader.citation.referenceCandidate', { number: reference.number, page: reference.anchor.pageIndex + 1 })}
              rawLabel={t('reader.citation.originalEntry')}
              goLabel={t('reader.citation.goToReference', { page: reference.anchor.pageIndex + 1 })}
              urlLabel={t('reader.citation.openUrl')}
              onNavigate={() => goToCitationReference(reference)}
            />)}
          </ol>
          : <p className="citation-unresolved">{t('reader.citation.unresolved')}</p>}
        {activeCitation.references.length === 0 && (citationIndex.kind === 'ready' && citationIndex.index.referenceHeading
          ? <button type="button" className="citation-references-button" onClick={goToCitationReferences}>{t('reader.citation.goToReferences', { page: citationIndex.index.referenceHeading.anchor.pageIndex + 1 })}</button>
          : <p className="citation-unresolved">{t('reader.citation.noHeading')}</p>)}
      </div>}
      {translation && <section
        ref={translationPopoverRef}
        className="translation-popover"
        aria-labelledby="translation-popover-title"
        aria-live="polite"
        style={{ left: `${translation.left}px`, top: `${translation.top}px` }}
      >
        <div className="translation-popover-header">
          <h2 id="translation-popover-title">{t('reader.translation.to', { language: t(translation.targetLanguage === 'Chinese' ? 'reader.translation.chinese' : 'reader.translation.english') })}</h2>
          <button type="button" onClick={closeTranslation} aria-label={t('reader.translation.close')}>{t('reader.translation.close')}</button>
        </div>
        <p className="translation-source-label">{t('reader.translation.source')}</p>
        <blockquote className="translation-source">{translation.quote}</blockquote>
        {translation.sourceNotice && <p className="translation-source-notice" role="status">{display(translation.sourceNotice)}</p>}
        {translation.status === 'preparing' && <p role="status">{t('reader.insights.requestingPermission')}</p>}
        {translation.status === 'generating' && <p role="status">{t('reader.translation.generating')} <button type="button" onClick={closeTranslation}>{t('reader.cancel')}</button></p>}
        {translation.status === 'success' && translation.result && <>
          <p className="translation-source-label">{t('reader.translation.title')}</p>
          <p className="translation-result">{translation.result.translation}</p>
          {translation.result.uncertainty && <p className="translation-uncertainty">{t('reader.translation.uncertainty', { text: translation.result.uncertainty })}</p>}
          <div className="translation-actions"><button type="button" onClick={() => void copyTranslation()}>{t('reader.translation.copy')}</button></div>
        </>}
        {translation.status === 'error' && <p className="translation-error" role="alert">{display(translation.message)} <a href="options.html">{t('reader.insights.openSettings')}</a></p>}
        {translation.message && translation.status === 'success' && <p role="status">{display(translation.message)}</p>}
      </section>}
      {highlightToolbarPosition && (selectionDraft || activeHighlight) && <div
        ref={highlightToolbarRef}
        className="highlight-toolbar"
        role="toolbar"
        aria-label={t(selectionDraft ? 'reader.highlight.create' : 'reader.highlight.edit')}
        style={{ left: `${highlightToolbarPosition.left}px`, top: `${highlightToolbarPosition.top}px` }}
      >
        {selectionDraft ? <>
          <span className="highlight-toolbar-label">{t('reader.highlight.selectedCount', { count: selectionDraft.quote.length })}</span>
          <label className="translation-target-label">{t('reader.translation.target')}
            <select value={translationTarget} onChange={(event) => setTranslationTarget(event.target.value as 'Chinese' | 'English')} aria-label={t('reader.translation.targetLabel')}>
              <option value="Chinese">{t('reader.translation.chinese')}</option>
              <option value="English">{t('reader.translation.english')}</option>
            </select>
          </label>
          <button type="button" className="translate-button" onMouseDown={(event) => event.preventDefault()} onClick={startTranslation}>{t('reader.translation.action')}</button>
          <button type="button" className="highlight-create-button" onMouseDown={(event) => event.preventDefault()} onClick={() => createHighlight('yellow')}>{t('reader.highlight.action')}</button>
          {HIGHLIGHT_COLORS.filter((color) => color !== 'yellow').map((color) => <button
            type="button"
            key={color}
            className={`highlight-color-button highlight-color-${color}`}
            aria-label={t('reader.highlight.createColor', { color: t(`reader.highlight.color.${color}` as MessageKey) })}
            title={t('reader.highlight.createColor', { color: t(`reader.highlight.color.${color}` as MessageKey) })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => createHighlight(color)}
          />)}
        </> : activeHighlight && <>
          <span className="highlight-toolbar-label">{t('reader.highlight.edit')}</span>
          {HIGHLIGHT_COLORS.map((color) => <button
            type="button"
            key={color}
            className={`highlight-color-button highlight-color-${color}${activeHighlight.color === color ? ' is-current' : ''}`}
            aria-label={t('reader.highlight.changeColor', { color: t(`reader.highlight.color.${color}` as MessageKey) })}
            title={t('reader.highlight.changeColor', { color: t(`reader.highlight.color.${color}` as MessageKey) })}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => updateActiveHighlightColor(color)}
          />)}
          <button type="button" className="highlight-delete-button" onMouseDown={(event) => event.preventDefault()} onClick={deleteActiveHighlight}>{t('reader.highlight.delete')}</button>
        </>}
      </div>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<ReaderPage />);
