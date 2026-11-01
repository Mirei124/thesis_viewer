import { describe, expect, it } from 'vitest';
import { prepareThreeLineCandidate } from './overview-three-line';
import { pdfEvidenceLedgerFromPages, locateEvidenceCandidate } from '../../src/lib/evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from '../../src/lib/pdfPageBlocks';
import { pdfSectionCandidatesFromPages } from '../../src/lib/pdfSectionCandidates';

function fixture(parts: Array<[string, string]>) {
  const pages: PageExtraction[] = parts.map(([heading, body], pageIndex) => {
    const blocks = [heading, body].map((rawText, sourceOrder): PdfPageTextBlock => {
      const normalized = normalizePdfTextItem(rawText);
      return {
        blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder,
        rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
        rawTransform: [10, 0, 0, 10, 50, 780 - sourceOrder * 40], rawWidth: 500, rawHeight: 10, hasEol: true,
        anchor: { pageIndex, quote: rawText, rects: [{ x: 50, y: 780 - sourceOrder * 40, width: 500, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
        qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags],
      };
    });
    return { pageIndex, blocks, searchableText: blocks.map(b => b.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
  });
  return { pages, ledger: pdfEvidenceLedgerFromPages(pages, 'doc', pdfSectionCandidatesFromPages(pages, 'doc')) };
}
const longDefinition = 'We propose a learned model that maps an input sequence to an output sequence through a shared representation. ' +
  'The decoder conditions on the encoder representation, retaining the stated input and output correspondence. '.repeat(7) + 'The final definition is preserved at the end of this complete paragraph.';

describe('experimental whole-paragraph three-line input', () => {
  it('retains the end of a complete paragraph beyond the previous 600-character cutoff and its anchored members', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition], ['2 Method', longDefinition.replace('We propose', 'The authors define')]]);
    const candidate = prepareThreeLineCandidate(ledger, pages);
    const source = candidate.sources.find(source => source.excerpt === longDefinition);
    expect(source).toBeDefined();
    expect(source!.excerpt.length).toBeGreaterThan(600);
    expect(source!.excerpt).toContain('The final definition is preserved');
    expect(candidate.paragraphs.every(paragraph => paragraph.members.every(member => locateEvidenceCandidate(member.candidate, pages)))).toBe(true);
    expect(candidate.sources).toHaveLength(candidate.paragraphs.length);
  });
  it('excludes supplementary descendants and references and never serializes opaque anchors', () => {
    const { ledger, pages } = fixture([
      ['1 Introduction', longDefinition],
      ['2 Method', longDefinition.replace('We propose', 'We construct')],
      ['Appendix A', 'Appendix-only secret mechanism. '.repeat(10)],
      ['A.1 Training', 'Supplementary-only training fact. '.repeat(10)],
      ['References', 'Reference-only bibliographic content. '.repeat(10)],
    ]);
    const candidate = prepareThreeLineCandidate(ledger, pages);
    expect(candidate.sources.some(source => /Appendix-only|Supplementary-only|Reference-only/.test(source.excerpt))).toBe(false);
    const serialized = JSON.stringify(candidate.messages);
    expect(serialized).not.toContain('blockId'); expect(serialized).not.toContain('normalizedStart');
    expect(candidate.sources.map(source => source.alias)).toEqual(candidate.sources.map((_, i) => `S${String(i + 1).padStart(2, '0')}`));
  });
  it('keeps the established compact three-item response instruction without imposing fixed contribution categories', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition]]);
    const candidate = prepareThreeLineCandidate(ledger, pages);
    expect(candidate.messages[0].content).toContain('exactly three complementary');
    expect(candidate.messages[1].content).toContain('do not impose three fixed categories');
    expect(JSON.parse(candidate.messages[1].content).sources[0]).toEqual(expect.objectContaining({ alias: 'S01', excerpt: longDefinition }));
  });
});


describe('experimental abstract and enumeration safeguards', () => {
  it('recognizes research abstract prose on the first page without an Abstract heading', () => {
    const abstract = 'We investigate the optimal allocation of a fixed training budget between model parameters and training tokens. ' +
      'We study several compute budgets and compare the resulting models with previously trained baselines. ' +
      'The validation model uses seventy billion parameters and more training tokens under the same computational budget, and this complete definition must remain available.';
    const { ledger, pages } = fixture([['Training Compute Optimal Language Models', abstract], ['1 Introduction', longDefinition]]);
    const candidate = prepareThreeLineCandidate(ledger, pages);
    expect(candidate.sources.some(source => source.excerpt === abstract)).toBe(true);
    expect(candidate.paragraphs.find(p => p.text === abstract)?.kind).toBe('frontmatter');
  });
  it('does not treat author affiliations and copyright prose as unlabelled abstracts', () => {
    const authorNoise = 'We study University of Example, Department of Science. Contact researcher@example.test for inquiries. ' + 'The names of all contributing authors are listed here. '.repeat(7);
    const { ledger, pages } = fixture([['Training Compute Optimal Language Models', authorNoise], ['1 Introduction', longDefinition]]);
    expect(prepareThreeLineCandidate(ledger, pages).sources.some(source => source.excerpt === authorNoise)).toBe(false);
  });
  it('excludes lowercase continuation of captions but retains ordinary body continuation', () => {
    const { pages } = fixture([['1 Introduction', 'Figure 1. We overlay the predictions from our three different approaches.']]);
    const captionTail = 'along with alternative projections, we show that the presented methods agree on a single allocation rule in the figure. '.repeat(3);
    const ordinary = 'We propose a complete method in this paragraph with sufficient explanatory content to identify the research contribution and the actual input and output. '.repeat(2);
    const normalTail = 'and the same method also processes another input; we present this additional mechanism as a separate supported contribution in the body of the paper. '.repeat(2);
    for (const [index, rawText] of [captionTail, ordinary, normalTail].entries()) {
      const sourceOrder = index + 2, normalized = normalizePdfTextItem(rawText), previous = pages[0].blocks[0];
      pages[0].blocks.push({ ...previous, blockId: `doc:p0:i${sourceOrder}`, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
        rawTransform: [10, 0, 0, 10, 50, 700 - index * 40], anchor: { ...previous.anchor, quote: rawText, rects: [{ x: 50, y: 700 - index * 40, width: 500, height: 10 }] } });
    }
    const ledger = pdfEvidenceLedgerFromPages(pages, 'doc', pdfSectionCandidatesFromPages(pages, 'doc'));
    const candidate = prepareThreeLineCandidate(ledger, pages);
    expect(candidate.sources.some(source => source.excerpt.includes('along with alternative projections'))).toBe(false);
    expect(candidate.sources.map(source => source.excerpt)).toContain(normalTail.trim());
  });
  it('warns against completing partial enumerations or promoting internal substeps into alternatives', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition]]);
    const notes = JSON.parse(prepareThreeLineCandidate(ledger, pages).messages[1].content).readingNotes.join(' ');
    expect(notes).toContain('fully define all of them');
    expect(notes).toContain('internal substeps');
    expect(notes).toContain('without inventing missing alternatives');
  });
});
