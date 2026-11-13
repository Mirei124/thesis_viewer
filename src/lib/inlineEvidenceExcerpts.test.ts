import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { buildInlineEvidenceExcerpts } from './inlineEvidenceExcerpts';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';

function block(pageIndex: number, sourceOrder: number, quote: string, x: number, y: number): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(quote);
  return {
    blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2',
    pageIndex, sourceOrder, rawText: quote, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
    rawTransform: [10, 0, 0, 10, x, y], rawWidth: 100, rawHeight: 10, hasEol: true,
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

function glyph(order: number, text: string, x: number, y: number, width = 6, fontSize = 10): PdfPageTextBlock {
  const result = block(0, order, text, x, y);
  result.rawTransform = [fontSize, 0, 0, fontSize, x, y];
  result.rawWidth = width; result.rawHeight = fontSize; result.hasEol = false;
  result.anchor.rects[0] = { x, y, width, height: fontSize };
  return result;
}
function selectedExcerpts(pages: PageExtraction[], orders?: number[]) {
  const candidates = pdfEvidenceLedgerFromPages(pages, 'doc', []).candidates;
  const selected = orders ? orders.flatMap(order => candidates.filter(candidate => candidate.blockId.endsWith(`:i${order}`))) : candidates;
  return { candidates, groups: buildInlineEvidenceExcerpts(selected.map(candidate => candidate.evidenceId), candidates, pages) };
}

describe('paragraph and formula reading units', () => {
  it('groups inline variables and small subscripts across known empty PDF items, preserving all original anchors', () => {
    const p = page(0, [glyph(0, 'The representation is', 40, 500, 90), glyph(1, ' ', 130, 500, 3), glyph(2, 'x', 133, 500),
      glyph(3, '1', 139, 498.5, 4, 7), glyph(5, ', followed by decoding.', 143, 500, 100)]);
    p.textItemCount = 6; // index 4 was an empty-string PDF.js item
    const { groups } = selectedExcerpts([p]);
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe('The representation is x1, followed by decoding.');
    expect(groups[0].members.map(member => member.quote)).toEqual(['The representation is', 'x', '1', ', followed by decoding.']);
    expect(groups[0].members.every(member => member.location?.precision === 'exact')).toBe(true);
    expect(groups[0].target).toBe(groups[0].members[0]);
    expect(groups[0].mathLayout).toBe(true);
  });

  it('does not bridge an uncited substantive item, including one with zero-size geometry', () => {
    const hidden = glyph(1, 'NOT', 90, 500, 0); hidden.qualityFlags.push('empty-or-zero-size-rect');
    const p = page(0, [glyph(0, 'First part', 40, 500, 50), hidden, glyph(2, 'last part.', 93, 500, 50)]);
    const { groups } = selectedExcerpts([p], [0, 2]);
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.text)).toEqual(['First part', 'last part.']);
  });

  it('honours real paragraph indentation instead of treating all wrapped lines as one passage', () => {
    const p = page(0, [glyph(0, 'The first paragraph ends here.', 40, 500, 200), glyph(1, 'A new indented paragraph starts.', 52, 488, 210)]);
    const { groups } = selectedExcerpts([p]);
    expect(groups).toHaveLength(2);
  });

  it('recovers a raised radical in original item order, not in the preceding line', () => {
    const p = page(0, [glyph(0, 'Values of dimension', 40, 500, 90), glyph(1, 'd', 132, 500), glyph(2, 'v', 138, 498.5, 4, 7),
      glyph(3, '. Divide by', 143, 500, 55), glyph(4, 'the scale', 40, 488, 40), glyph(5, '√', 82, 495.7, 8),
      glyph(6, 'd', 90, 488), glyph(7, 'k', 96, 486.5, 4, 7), glyph(8, 'and normalize.', 103, 488, 65)]);
    const { groups } = selectedExcerpts([p], [0, 1, 2, 5, 3, 4, 6, 7, 8]);
    expect(groups).toHaveLength(1);
    expect(groups[0].text.indexOf('√')).toBeGreaterThan(groups[0].text.indexOf('the scale'));
    expect(groups[0].members.map(member => member.quote)).toEqual(['Values of dimension', 'd', 'v', '. Divide by', 'the scale', '√', 'd', 'k', 'and normalize.']);
  });

  it('groups a complete local numerator, superscript, baseline and denominator as one formula without inventing LaTeX', () => {
    const p = page(0, [glyph(0, 'Attention(Q,K,V) = softmax(', 40, 500, 130), glyph(1, 'QK', 172, 510, 12), glyph(2, 'T', 184, 514, 4, 7),
      glyph(3, '√', 172, 500, 8), glyph(4, 'd', 180, 493), glyph(5, 'k', 186, 491.5, 4, 7), glyph(6, ') V', 193, 500, 15), glyph(7, '(1)', 280, 500, 15)]);
    const { groups } = selectedExcerpts([p], [2, 1, 0, 3, 6, 7, 4, 5]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mathLayout).toBe(true);
    expect(groups[0].members).toHaveLength(8);
    expect(groups[0].members.map(member => member.evidenceId)).toEqual(Array.from({ length: 8 }, (_, i) => `doc:pdf-evidence-ledger-v1:p0:i${i}`));
    expect(groups[0].text).not.toContain('\\frac');
    expect(groups[0].text).not.toContain('^');
  });

  it('keeps a legacy alias containing only T limited to that cited glyph', () => {
    const p = page(0, [glyph(0, 'QK', 40, 500, 12), glyph(1, 'T', 52, 504, 4, 7), glyph(2, '= output', 60, 500, 50)]);
    const { groups } = selectedExcerpts([p], [1]);
    expect(groups).toHaveLength(1);
    expect(groups[0].text).toBe('T');
    expect(groups[0].members).toHaveLength(1);
  });

  it('does not merge two nearby-height formulas across columns', () => {
    const p = page(0, [glyph(0, 'x = y', 40, 500, 35), glyph(1, 'a = b', 340, 501, 35)]);
    const { groups } = selectedExcerpts([p]);
    expect(groups).toHaveLength(2);
    expect(groups.map(group => group.text)).toEqual(['x = y', 'a = b']);
  });

  it('splits long prose at complete sentences, keeping scientific abbreviations and decimal values together', () => {
    const sentence = 'We measure 3.14 units, e.g. using the baseline in Fig. 2, and preserve the complete scientific comparison. ';
    const text = sentence.repeat(18);
    const p = page(0, [glyph(0, text, 40, 500, 200)]);
    const { groups } = selectedExcerpts([p]);
    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every(group => group.text.endsWith('comparison.'))).toBe(true);
    expect(groups.map(group => group.text).join(' ')).toBe(text.trim());
    expect(groups.every(group => group.target?.evidenceId === 'doc:pdf-evidence-ledger-v1:p0:i0')).toBe(true);
  });
});
