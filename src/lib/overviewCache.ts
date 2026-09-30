import { DETAILED_SECTION_IDS, PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION, type DetailedOverview, type DetailedOverviewBlock } from './detailedOverview';
import { locateEvidenceCandidate, PDF_EVIDENCE_LEDGER_VERSION, type EvidenceLedger } from './evidenceLedger';
import type { VerifiedEvidenceRef } from './inlineEvidence';
import type { ModelConfig } from './modelConfig';
import { PDF_PAGE_BLOCK_EXTRACTION_VERSION, type PageExtraction } from './pdfPageBlocks';
import { THREE_LINE_OVERVIEW_PROMPT_VERSION, type ThreeLineOverview } from './threeLineOverview';

export type OverviewCacheKind = 'three-line' | 'detailed';
export type OverviewCacheInput = {
  documentContentKey: string;
  kind: OverviewCacheKind;
  config: ModelConfig;
};

const DATABASE_NAME = 'thesis-viewer-overviews';
const STORE_NAME = 'verified-overviews';
const CACHE_SCHEMA_VERSION = 'overview-cache-v1';

/** The key includes every non-secret model setting that can alter a request. */
export function overviewCacheKey(input: OverviewCacheInput): string {
  const { config } = input;
  return JSON.stringify([
    CACHE_SCHEMA_VERSION,
    input.kind,
    `sha256:${input.documentContentKey}`,
    PDF_PAGE_BLOCK_EXTRACTION_VERSION,
    PDF_EVIDENCE_LEDGER_VERSION,
    input.kind === 'three-line' ? THREE_LINE_OVERVIEW_PROMPT_VERSION : PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION,
    config.baseUrl,
    config.model,
    config.structuredOutput,
    config.contextLimit,
    config.outputLimit,
  ]);
}

type StoredOverview = { id: string; schema: typeof CACHE_SCHEMA_VERSION; result: ThreeLineOverview | DetailedOverview; createdAt: number };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function evidenceIds(value: unknown, ledger: EvidenceLedger, pages: PageExtraction[]): string[] | undefined {
  if (!Array.isArray(value) || !value.every(text)) return undefined;
  const candidates = new Map(ledger.candidates.map((candidate) => [candidate.evidenceId, candidate]));
  if (value.some((id) => !candidates.get(id) || !locateEvidenceCandidate(candidates.get(id)!, pages))) return undefined;
  return [...value];
}

function evidenceRefs(value: unknown, ids: readonly string[], ledger: EvidenceLedger, pages: PageExtraction[], aliasPattern: RegExp): VerifiedEvidenceRef[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const refs: VerifiedEvidenceRef[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const source = record(item);
    if (!source || !text(source.alias) || !aliasPattern.test(source.alias) || seen.has(source.alias)) return undefined;
    const sourceIds = evidenceIds(source.evidenceIds, ledger, pages);
    if (!sourceIds || sourceIds.length === 0 || sourceIds.some((id) => !ids.includes(id))) return undefined;
    seen.add(source.alias);
    refs.push({ alias: source.alias, evidenceIds: sourceIds });
  }
  if (new Set(refs.flatMap((ref) => ref.evidenceIds)).size !== new Set(ids).size || ids.some((id) => !refs.some((ref) => ref.evidenceIds.includes(id)))) return undefined;
  return refs;
}

/** Reconstructs only application-owned, verified fields; ignores any injected extras. */
export function verifiedCachedOverview(value: unknown, kind: 'three-line', ledger: EvidenceLedger, pages: PageExtraction[]): ThreeLineOverview | undefined;
export function verifiedCachedOverview(value: unknown, kind: 'detailed', ledger: EvidenceLedger, pages: PageExtraction[]): DetailedOverview | undefined;
export function verifiedCachedOverview(value: unknown, kind: OverviewCacheKind, ledger: EvidenceLedger, pages: PageExtraction[]): ThreeLineOverview | DetailedOverview | undefined;
export function verifiedCachedOverview(value: unknown, kind: OverviewCacheKind, ledger: EvidenceLedger, pages: PageExtraction[]): ThreeLineOverview | DetailedOverview | undefined {
  const source = record(value);
  if (!source || !Array.isArray(source.uncertainties) || source.uncertainties.length !== 0) return undefined;
  if (kind === 'three-line') {
    if (source.kind !== 'three_line' || !Array.isArray(source.items) || source.items.length !== 3) return undefined;
    const items = source.items.map((value) => {
      const item = record(value);
      if (!item || item.role !== 'contribution' || item.status !== 'available' || !text(item.text)) return undefined;
      const ids = evidenceIds(item.evidenceIds, ledger, pages);
      if (!ids || ids.length === 0) return undefined;
      const refs = evidenceRefs(item.evidenceRefs, ids, ledger, pages, /^S\d{2}$/);
      return refs ? { role: 'contribution' as const, status: 'available' as const, text: item.text, evidenceIds: ids, evidenceRefs: refs } : undefined;
    });
    if (items.some((item) => !item)) return undefined;
    return { kind: 'three_line', items: items as ThreeLineOverview['items'], uncertainties: [] };
  }
  if (source.kind !== 'detailed' || !Array.isArray(source.sections) || source.sections.length !== DETAILED_SECTION_IDS.length) return undefined;
  const sections = source.sections.map((value, index) => {
    const section = record(value);
    // A local fallback or incomplete model section is not a reusable success.
    if (!section || section.id !== DETAILED_SECTION_IDS[index] || section.status !== 'available' || !Array.isArray(section.blocks) || section.blocks.length === 0) return undefined;
    const blocks: DetailedOverviewBlock[] = [];
    for (const value of section.blocks) {
      const block = record(value);
      if (!block || !['paragraph', 'step', 'bullet', 'equation'].includes(String(block.type)) || !text(block.text)
        || !['author_claim', 'source_fact', 'observed_result', 'inference'].includes(String(block.claimKind))) return undefined;
      const ids = evidenceIds(block.evidenceIds, ledger, pages);
      if (!ids || ids.length === 0) return undefined;
      const refs = evidenceRefs(block.evidenceRefs, ids, ledger, pages, /^E\d{3}$/);
      if (!refs) return undefined;
      if (block.limitationKind !== undefined && !['author_stated', 'evidence_gap'].includes(String(block.limitationKind))) return undefined;
      blocks.push({
        type: block.type as DetailedOverviewBlock['type'], text: block.text, evidenceIds: ids,
        evidenceRefs: refs, claimKind: block.claimKind as DetailedOverviewBlock['claimKind'],
        ...(block.limitationKind ? { limitationKind: block.limitationKind as DetailedOverviewBlock['limitationKind'] } : {}),
      });
    }
    return { id: DETAILED_SECTION_IDS[index], status: 'available' as const, blocks };
  });
  if (sections.some((section) => !section)) return undefined;
  return { kind: 'detailed', sections: sections as DetailedOverview['sections'], uncertainties: [] };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE_NAME, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open overview cache.'));
  });
}

export function overviewCacheContextValid(input: OverviewCacheInput, ledger: EvidenceLedger, pages: PageExtraction[]): boolean {
  const version = `sha256:${input.documentContentKey}`;
  return /^[0-9a-f]{64}$/.test(input.documentContentKey)
    && ledger.version === PDF_EVIDENCE_LEDGER_VERSION && ledger.documentVersion === version
    && pages.length > 0 && pages.every((page, index) => page.pageIndex === index
      && page.blocks.every((block) => block.documentVersion === version && block.extractionVersion === PDF_PAGE_BLOCK_EXTRACTION_VERSION));
}

export async function loadCachedOverview(input: OverviewCacheInput, ledger: EvidenceLedger, pages: PageExtraction[]): Promise<ThreeLineOverview | DetailedOverview | undefined> {
  if (!overviewCacheContextValid(input, ledger, pages)) return undefined;
  const database = await openDatabase();
  try {
    const key = overviewCacheKey(input);
    const stored = await new Promise<unknown>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Could not read overview cache.'));
    });
    const entry = record(stored);
    if (!entry || entry.id !== key || entry.schema !== CACHE_SCHEMA_VERSION) return undefined;
    return verifiedCachedOverview(entry.result, input.kind, ledger, pages);
  } finally {
    database.close();
  }
}

export async function cacheVerifiedOverview(input: OverviewCacheInput, result: ThreeLineOverview | DetailedOverview, ledger: EvidenceLedger, pages: PageExtraction[]): Promise<void> {
  if (!overviewCacheContextValid(input, ledger, pages)) return;
  const safeResult = verifiedCachedOverview(result, input.kind, ledger, pages);
  if (!safeResult) return;
  const database = await openDatabase();
  try {
    const entry: StoredOverview = { id: overviewCacheKey(input), schema: CACHE_SCHEMA_VERSION, result: safeResult, createdAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(entry);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not write overview cache.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('Overview cache write aborted.'));
    });
  } finally {
    database.close();
  }
}
