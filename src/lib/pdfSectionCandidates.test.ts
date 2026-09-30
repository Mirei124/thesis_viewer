import { describe, expect, it } from 'vitest';
import { pdfSectionCandidatesFromPages } from './pdfSectionCandidates';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';

function block(pageIndex: number, sourceOrder: number, rawText: string, size = 1): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return {
    blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2',
    pageIndex, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
    rawTransform: [size, 0, 0, size, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false,
    anchor: { pageIndex, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
    qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags],
  };
}

function page(pageIndex: number, title: string): PageExtraction {
  const blocks = [block(pageIndex, 0, title, 2),
    block(pageIndex, 1, 'The body describes the input and measured output.'),
    block(pageIndex, 2, 'A second full sentence supplies ordinary prose.'),
    block(pageIndex, 3, 'Further analysis belongs to the body text.')];
  return { pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
}

describe('section candidates for model evidence and reader outline', () => {
  it('does not promote all-caps title-page author names into a body section', () => {
    const front = page(0, 'GEORGIOS KOPANAS');
    const found = pdfSectionCandidatesFromPages([front, page(1, 'Evaluation Results')], 'doc').map((item) => item.title);
    expect(found).not.toContain('GEORGIOS KOPANAS');
    expect(found).toContain('Evaluation Results');
  });

  it('retains common single-word and title-case headings while rejecting sentence fragments', () => {
    const titles = ['Introduction', 'Methods', 'Conclusion', 'Evaluation Results', 'Comparison with Baselines',
      '1.5 Evaluation Results', '1.5 Pro achieves 75% accuracy', 'input modalities in the evaluation', 'Recent'];
    const found = pdfSectionCandidatesFromPages(titles.map((title, index) => page(index, title)), 'doc').map((item) => item.title);
    expect(found).toEqual(expect.arrayContaining(titles.slice(0, 6)));
    expect(found).not.toContain('1.5 Pro achieves 75% accuracy');
    expect(found).not.toContain('input modalities in the evaluation');
    expect(found).not.toContain('Recent');
  });
});
