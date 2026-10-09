import { describe, expect, it } from 'vitest';
import { DETAILED_SECTION_IDS, PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION, type DetailedOverview } from './detailedOverview';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import type { ModelConfig } from './modelConfig';
import { normalizePdfTextItem, PDF_PAGE_BLOCK_EXTRACTION_VERSION, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { overviewCacheContextValid, overviewCacheKey, verifiedCachedOverview } from './overviewCache';
import { THREE_LINE_OVERVIEW_PROMPT_VERSION, type ThreeLineOverview } from './threeLineOverview';

const documentContentKey = 'a'.repeat(64);
const documentVersion = `sha256:${documentContentKey}`;
const config: ModelConfig = {
  baseUrl: 'https://example.test/v1', model: 'scholar-model',
  structuredOutput: true, contextLimit: 32000, outputLimit: 4000,
};

function source() {
  const normalized = normalizePdfTextItem('A locally verifiable contribution.');
  const block: PdfPageTextBlock = {
    blockId: `${documentVersion}:p0:i0`, documentVersion, extractionVersion: PDF_PAGE_BLOCK_EXTRACTION_VERSION,
    pageIndex: 0, sourceOrder: 0, rawText: 'A locally verifiable contribution.', normalizedText: normalized.normalizedText,
    offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 100, rawHeight: 12, hasEol: false,
    anchor: { pageIndex: 0, quote: 'A locally verifiable contribution.', rects: [{ x: 0, y: 0, width: 100, height: 12 }], coordinateSpace: 'pdfjs-text-item' },
    qualityFlags: ['pdfjs-source-order-not-reading-order'],
  };
  const pages: PageExtraction[] = [{ pageIndex: 0, blocks: [block], searchableText: block.normalizedText, textItemCount: 1, status: 'text' }];
  const ledger = pdfEvidenceLedgerFromPages(pages, documentVersion, []);
  return { pages, ledger, evidenceId: ledger.candidates[0].evidenceId };
}

describe('verified overview cache', () => {
  it('isolates document bytes, versions, overview kind, and every non-secret model setting', () => {
    const input = { documentContentKey, kind: 'three-line' as const, config };
    const key = overviewCacheKey(input);
    expect(key).toContain(documentVersion);
    expect(key).toContain(PDF_PAGE_BLOCK_EXTRACTION_VERSION);
    expect(key).not.toContain('top-secret');
    expect(overviewCacheKey({ ...input, config: { ...config, apiKey: 'top-secret' } as ModelConfig })).toBe(key);
    expect(overviewCacheKey({ ...input, documentContentKey: 'b'.repeat(64) })).not.toBe(key);
    expect(overviewCacheKey({ ...input, kind: 'detailed' })).not.toBe(key);
    for (const field of ['baseUrl', 'model', 'structuredOutput', 'contextLimit', 'outputLimit'] as const) {
      const changed = { ...config, [field]: typeof config[field] === 'boolean' ? !config[field] : typeof config[field] === 'number' ? config[field] + 1 : `${config[field]}-other` };
      expect(overviewCacheKey({ ...input, config: changed })).not.toBe(key);
    }
  });

  it('invalidates both prior language-policy generations without changing other cache dimensions', () => {
    for (const [kind, currentVersion, previousVersion] of [
      ['three-line', THREE_LINE_OVERVIEW_PROMPT_VERSION, 'research-overview-zh-v7'],
      ['detailed', PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION, 'research-detailed-overview-zh-v14'],
    ] as const) {
      const key = overviewCacheKey({ documentContentKey, kind, config });
      const previousParts: unknown[] = JSON.parse(key);
      expect(previousParts[5]).toBe(currentVersion);
      previousParts[5] = previousVersion;
      expect(JSON.stringify(previousParts)).not.toBe(key);
      expect(key).not.toContain(previousVersion);
    }
  });

  it('isolates detailed review and selection policy while leaving three-line keys unchanged', () => {
    const input = { documentContentKey, config, kind: 'detailed' as const };
    const disabled = overviewCacheKey(input);
    expect(overviewCacheKey({ ...input, config: { ...config, semanticReview: false } })).toBe(disabled);
    expect(overviewCacheKey({ ...input, config: { ...config, semanticReview: true } })).not.toBe(disabled);
    expect(disabled).toContain('detailed-context-selection-v2');
    expect(overviewCacheKey({ ...input, kind: 'three-line', config: { ...config, semanticReview: true } }))
      .toBe(overviewCacheKey({ ...input, kind: 'three-line' }));
    expect(JSON.parse(overviewCacheKey({ ...input, kind: 'three-line' }))).toHaveLength(11);
    expect(JSON.parse(disabled)).toHaveLength(13);
  });

  it('requires matching document, ledger and page extraction before reading or writing', () => {
    const { pages, ledger } = source();
    const input = { documentContentKey, kind: 'three-line' as const, config };
    expect(overviewCacheContextValid(input, ledger, pages)).toBe(true);
    expect(overviewCacheContextValid({ ...input, documentContentKey: 'b'.repeat(64) }, ledger, pages)).toBe(false);
    expect(overviewCacheContextValid(input, { ...ledger, version: 'old' as typeof ledger.version }, pages)).toBe(false);
    expect(overviewCacheContextValid(input, ledger, [{ ...pages[0], blocks: [{ ...pages[0].blocks[0], extractionVersion: 'old' as PdfPageTextBlock['extractionVersion'] }] }])).toBe(false);
  });

  it('whitelists the three-line result and rechecks every evidence anchor', () => {
    const { pages, ledger, evidenceId } = source();
    const item = { role: 'contribution' as const, status: 'available' as const, text: 'Verified claim', evidenceIds: [evidenceId], evidenceRefs: [{ alias: 'S01', evidenceIds: [evidenceId] }] };
    const result: ThreeLineOverview = { kind: 'three_line', items: [item, { ...item, evidenceRefs: [{ alias: 'S02', evidenceIds: [evidenceId] }] }, { ...item, evidenceRefs: [{ alias: 'S03', evidenceIds: [evidenceId] }] }], uncertainties: [] };
    const restored = verifiedCachedOverview({ ...result, apiKey: 'top-secret', rawProviderResponse: 'private' }, 'three-line', ledger, pages);
    expect(restored).toEqual(result);
    expect(JSON.stringify(restored)).not.toContain('top-secret');
    expect(verifiedCachedOverview(result, 'three-line', { ...ledger, candidates: [] }, pages)).toBeUndefined();
    expect(verifiedCachedOverview(result, 'three-line', ledger, [{ ...pages[0], blocks: [] }])).toBeUndefined();
    expect(verifiedCachedOverview({ ...result, items: [{ ...item, evidenceRefs: [{ alias: 'S01', evidenceIds: ['unknown'] }] }, result.items[1], result.items[2]] }, 'three-line', ledger, pages)).toBeUndefined();
  });

  it('restores only complete, evidence-backed detailed sections, without diagnostics or raw data', () => {
    const { pages, ledger, evidenceId } = source();
    const block = { type: 'paragraph' as const, text: 'Supported method', evidenceIds: [evidenceId], evidenceRefs: [{ alias: 'E001', evidenceIds: [evidenceId] }], claimKind: 'source_fact' as const };
    const result: DetailedOverview = { kind: 'detailed', sections: DETAILED_SECTION_IDS.map((id) => ({ id, status: 'available' as const, blocks: [block] })) as DetailedOverview['sections'], uncertainties: [] };
    const restored = verifiedCachedOverview({ ...result, diagnostics: { raw: 'private' }, requestHistory: ['private'] }, 'detailed', ledger, pages);
    expect(restored).toEqual(result);
    const oldSix = ['problem_motivation', 'method', 'contributions', 'relative_novelty', 'experiments_ablations', 'limitations'].map((id) => ({ id, status: 'available', blocks: [block] }));
    expect(verifiedCachedOverview({ ...result, sections: oldSix }, 'detailed', ledger, pages)).toBeUndefined();
    expect(JSON.stringify(restored)).not.toContain('private');
    expect(verifiedCachedOverview({ ...result, sections: [{ ...result.sections[0], status: 'unavailable' }, ...result.sections.slice(1)] }, 'detailed', ledger, pages)).toBeUndefined();
    expect(verifiedCachedOverview({ ...result, sections: [{ ...result.sections[0], blocks: [{ ...block, evidenceIds: ['stale'] }] }, ...result.sections.slice(1)] }, 'detailed', ledger, pages)).toBeUndefined();
    expect(verifiedCachedOverview({ ...result, sections: result.sections.map((section) => ({ ...section, blocks: [{ ...block, text: 'Unbound E999' }] })) }, 'detailed', ledger, pages)).toBeUndefined();
    const legacySections = result.sections.map((section) => section.id === 'limitations'
      ? { ...section, blocks: [{ ...block, limitationKind: 'author_stated' }] }
      : section);
    const restoredLegacy = verifiedCachedOverview({ ...result, sections: legacySections }, 'detailed', ledger, pages);
    expect(restoredLegacy).toEqual(result);
    expect(restoredLegacy?.sections[4].blocks[0]).not.toHaveProperty('limitationKind');
  });
});
