import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { buildInlineEvidenceExcerpts } from './inlineEvidenceExcerpts';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';

function block(pageIndex: number, sourceOrder: number, quote: string, x: number, y: number): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(quote);
  return {
    blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2',
    pageIndex, sourceOrder, rawText: quote, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
    rawTransform: [1, 0, 0, 1, x, y], rawWidth: 100, rawHeight: 10, hasEol: true,
    anchor: { pageIndex, quote, rects: [{ x, y, width: 100, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
    qualityFlags: ['pdfjs-source-order-not-reading-order'],
  };
}
function page(pageIndex: number, blocks: PdfPageTextBlock[]): PageExtraction {
  return { pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
}
function excerpts(pages: PageExtraction[]) {
  const candidates = pdfEvidenceLedgerFromPages(pages, 'doc', []).candidates;
  return buildInlineEvidenceExcerpts(candidates.map((candidate) => candidate.evidenceId), candidates, pages);
}

describe('inline source excerpts', () => {
  it('joins adjacent fragments while retaining an independent verified target for each', () => {
    const groups = excerpts([page(0, [block(0, 0, 'The model uses', 40, 500), block(0, 1, 'local evidence.', 40, 488)])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((member) => member.quote)).toEqual(['The model uses', 'local evidence.']);
    expect(groups[0].members.map((member) => member.separatorBefore)).toEqual(['', ' ']);
    expect(groups[0].members.every((member) => member.location?.precision === 'exact')).toBe(true);
  });

  it('separates page, column, source-order and geometry breaks', () => {
    const groups = excerpts([
      page(0, [block(0, 0, 'Left column.', 40, 500), block(0, 1, 'Right column.', 340, 500), block(0, 3, 'Later item.', 340, 488)]),
      page(1, [block(1, 0, 'Next page.', 40, 500)]),
    ]);
    expect(groups).toHaveLength(4);
  });

  it('joins a same-column line that starts after an equation and wraps to the column margin', () => {
    const pages = [page(2, [
      block(2, 0, 'Left column context.', 52, 517),
      block(2, 296, '[Yifan et al. 2019] multiplied with a', 432, 517),
      block(2, 297, 'learned per-point opacity.', 318, 506),
    ])];
    pages[0].blocks[1].anchor.rects[0].width = 127;
    const candidates = pdfEvidenceLedgerFromPages(pages, 'doc', []).candidates;
    const selected = candidates.filter((item) => /:i29[67]$/.test(item.evidenceId));
    const groups = buildInlineEvidenceExcerpts(selected.map((item) => item.evidenceId), candidates, pages);
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((member) => `${member.separatorBefore}${member.displayQuote}`).join(''))
      .toBe('[Yifan et al. 2019] multiplied with a learned per-point opacity.');
  });

  it('normalizes a verified line-end hyphen without changing either original quote', () => {
    const groups = excerpts([page(0, [block(0, 0, 'ren-', 40, 500), block(0, 1, 'der,', 40, 488)])]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members[1].separatorBefore).toBe('');
    expect(groups[0].members.map((member) => member.quote)).toEqual(['ren-', 'der,']);
    expect(groups[0].members.map((member) => member.displayQuote).join('')).toBe('render,');
  });

  it('keeps a nine-line same-column excerpt together and preserves its unfinished ending', () => {
    const lines = ['A method', 'uses local', 'source text', 'for ren-', 'der, and', 'shows its', 'measured', 'quality in', 'real-time ('];
    const groups = excerpts([page(0, lines.map((quote, index) => block(0, 53 + index, quote, 51.8, 431.3 - index * 9.9)))]);
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(9);
    expect(groups[0].members.map((member) => `${member.separatorBefore}${member.displayQuote}`).join(''))
      .toBe('A method uses local source text for render, and shows its measured quality in real-time (');
    expect(groups[0].members[8].quote).toBe('real-time (');
  });

  it('does not remove a printed hyphen between same-row fragments', () => {
    const groups = excerpts([page(0, [block(0, 0, 'real-', 40, 500), block(0, 1, 'time', 142, 500)])]);
    expect(groups[0].members.map((member) => member.displayQuote)).toEqual(['real-', 'time']);
  });

  it('shows an unlocatable original quote as a separate noninteractive excerpt', () => {
    const pages = [page(0, [block(0, 0, 'Current text.', 40, 500)])];
    const candidates = pdfEvidenceLedgerFromPages(pages, 'doc', []).candidates;
    const stale = { ...candidates[0], quote: 'Original verified quote', blockId: 'missing' };
    const groups = buildInlineEvidenceExcerpts([stale.evidenceId], [stale], pages);
    expect(groups[0].members[0]).toMatchObject({ quote: 'Original verified quote', location: undefined });
  });
});
