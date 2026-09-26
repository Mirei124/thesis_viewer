import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages, locateEvidenceCandidate } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import type { PdfSectionCandidate } from './pdfSectionCandidates';

function block(pageIndex: number, sourceOrder: number, rawText: string, flags?: PdfPageTextBlock['qualityFlags']): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return { blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false, anchor: { pageIndex, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: flags ?? ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
}
function page(pageIndex: number, blocks: PdfPageTextBlock[], status: PageExtraction['status'] = 'text'): PageExtraction {
  return { pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status };
}
function section(title: string, source: PdfPageTextBlock): PdfSectionCandidate {
  return { candidateId: `section-${source.blockId}`, title, pageIndex: source.pageIndex, anchor: source.anchor, confidence: 'high', signals: ['numbered-title'], caution: 'Automatic candidate only; multi-column pages, tables, and formulas can produce false headings.' };
}

describe('pdf evidence ledger', () => {
  it('keeps inspectable body excerpts, coverage, and only section-derived slots', () => {
    const heading = block(0, 0, '3. Methods');
    const body = block(0, 1, 'We use a local encoder for each input.');
    const ledger = pdfEvidenceLedgerFromPages([page(0, [heading, body]), page(1, [], 'empty')], 'doc', [section('3. Methods', heading)]);
    const candidate = ledger.candidates.find((item) => item.blockId === body.blockId)!;
    expect(candidate.slot).toBe('method_overview');
    expect(candidate.coverage).toBe('partial');
    expect(candidate.qualityWarnings).toContain('section-derived-slot-not-semantic-verification');
    expect(candidate.qualityWarnings).toContain('partial-text-coverage');
  });

  it('excludes References and later blocks without treating them as body evidence', () => {
    const intro = block(0, 0, '1. Introduction');
    const body = block(0, 1, 'The problem is difficult.');
    const refs = block(1, 0, 'References');
    const ref = block(1, 1, '[1] A reference entry.');
    const ledger = pdfEvidenceLedgerFromPages([page(0, [intro, body]), page(1, [refs, ref])], 'doc', [section('1. Introduction', intro)]);
    expect(ledger.candidates.map((item) => item.blockId)).toContain(body.blockId);
    expect(ledger.candidates.map((item) => item.blockId)).not.toContain(ref.blockId);
    expect(ledger.excluded.referencesBlockCount).toBe(2);
  });

  it('uses exact offsets when current block mapping permits it and degrades on a stale id', () => {
    const body = block(0, 0, 'Reliable local evidence.');
    const ledger = pdfEvidenceLedgerFromPages([page(0, [body])], 'doc', []);
    const exact = locateEvidenceCandidate(ledger.candidates[0], [page(0, [body])])!;
    expect(exact.precision).toBe('exact');
    const stale = locateEvidenceCandidate({ ...ledger.candidates[0], blockId: 'missing' }, [page(0, [body])])!;
    expect(stale.precision).toBe('block');
    expect(stale.qualityWarnings).toContain('quote-fallback-used');
  });

  it('does not claim an exact location when normalization makes interior offsets uncertain', () => {
    const body = block(0, 0, 'A  spaced value');
    const ledger = pdfEvidenceLedgerFromPages([page(0, [body])], 'doc', []);
    expect(ledger.candidates[0].precision).toBe('block');
    expect(locateEvidenceCandidate(ledger.candidates[0], [page(0, [body])])?.precision).toBe('block');
  });
});
