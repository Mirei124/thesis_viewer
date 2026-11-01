import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { pdfSectionCandidatesFromPages } from './pdfSectionCandidates';
import { createDetailedEvidenceLedger } from './structuredPaper';
import { selectThreeLineContext } from './threeLineContext';
import { createParagraphEvidencePacket, resolveEvidencePacketAliases } from './evidencePacket';
import { parseThreeLineOverview, threeLineEvidencePacket, threeLineOverviewMessages, validateThreeLineOverview } from './threeLineOverview';
import { verifiedCachedOverview } from './overviewCache';

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

describe('three-line full-paragraph production input', () => {
  it('preserves the end beyond 600 characters and validates every original paragraph member', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition], ['2 Method', longDefinition.replace('We propose', 'We construct')]]);
    const expanded = createDetailedEvidenceLedger(ledger, pages);
    const packet = threeLineEvidencePacket(expanded, pages);
    const source = packet.sources.find(source => source.excerpt === longDefinition)!;
    expect(source).toBeDefined(); expect(source.excerpt.length).toBeGreaterThan(600);
    expect(source.excerpt).toContain('The final definition is preserved');
    const members = resolveEvidencePacketAliases(packet, [source.alias], expanded, pages);
    expect(members.length).toBeGreaterThan(0);
    expect(members.map(member => member.quote).join(' ')).toBe(longDefinition);
    const payload = JSON.parse(threeLineOverviewMessages(packet)[1].content);
    expect(payload.sources[0]).toEqual({ alias: source.alias, section: source.section, excerpt: longDefinition });
    expect(payload.readingNotes.join(' ')).toContain('No source text was cut');
    expect(JSON.stringify(payload)).not.toMatch(/evidenceId|blockId|normalizedStart/);
  });
  it('binds and restores expanded-only reliable blocks while rejecting validation against the old body ledger', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition]]);
    const body = { ...ledger, candidates: ledger.candidates.filter(candidate => candidate.quote !== longDefinition) };
    const expanded = createDetailedEvidenceLedger(body, pages);
    const packet = threeLineEvidencePacket(expanded, pages);
    expect(packet.sources[0].excerpt).toBe(longDefinition);
    const response = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map(index => ({ text: `Supported item ${index}.`, sources: [packet.sources[0].alias] })) }));
    const overview = validateThreeLineOverview(response, packet, expanded, pages);
    expect(overview.items.every(item => item.evidenceIds.length > 0)).toBe(true);
    expect(verifiedCachedOverview(overview, 'three-line', expanded, pages)).toEqual(overview);
    expect(() => validateThreeLineOverview(response, packet, body, pages)).toThrow(/verifiable/);
    expect(verifiedCachedOverview(overview, 'three-line', body, pages)).toBeUndefined();
  });
  it('does not register passages owned by another ledger and rejects stale original quotes', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition]]);
    const expanded = createDetailedEvidenceLedger(ledger, pages), selection = selectThreeLineContext(expanded, pages);
    const foreignLedger = { ...expanded, candidates: expanded.candidates.map(candidate => ({ ...candidate })) };
    expect(() => createParagraphEvidencePacket(foreignLedger, selection.paragraphs)).toThrow(/exact current PDF ledger/);
    const packet = createParagraphEvidencePacket(expanded, selection.paragraphs);
    const stalePages = [{ ...pages[0], blocks: pages[0].blocks.map(block => ({ ...block, normalizedText: 'Changed paper source.' })) }];
    expect(() => resolveEvidencePacketAliases(packet, ['S01'], expanded, stalePages)).toThrow(/verifiable|quote/);
    expect(() => resolveEvidencePacketAliases(packet, ['S99'], expanded, pages)).toThrow(/unknown packet source/);
  });
  it('excludes appendix descendants and references from selected body paragraphs', () => {
    const { ledger, pages } = fixture([['1 Introduction', longDefinition], ['Appendix A', 'Appendix-only mechanism. '.repeat(10)], ['A.1 Training', 'Supplementary-only training detail. '.repeat(10)], ['References', 'Reference-only bibliography content. '.repeat(10)]]);
    const packet = threeLineEvidencePacket(createDetailedEvidenceLedger(ledger, pages), pages);
    expect(packet.sources.some(source => /Appendix-only|Supplementary-only|Reference-only/.test(source.excerpt))).toBe(false);
    expect(packet.sources.some(source => source.excerpt === longDefinition)).toBe(true);
  });
  it('keeps short Chinese sources through a bounded-excerpt fallback instead of returning an empty packet', () => {
    const text = '我们提出一种保留原文来源的论文阅读方法，通过编码输入文本并构建可核实的上下文来生成有依据的回答，同时保留训练过程和推理过程的不同作用。'.repeat(2);
    const { ledger, pages } = fixture([['1 Introduction', text]]);
    const expanded = createDetailedEvidenceLedger(ledger, pages);
    expect(selectThreeLineContext(expanded, pages).paragraphs).toHaveLength(0);
    const packet = threeLineEvidencePacket(expanded, pages);
    expect(packet.sources.length).toBeGreaterThan(0);
    expect(resolveEvidencePacketAliases(packet, [packet.sources[0].alias], expanded, pages).length).toBeGreaterThan(0);
    const notes = JSON.parse(threeLineOverviewMessages(packet)[1].content).readingNotes.join(' ');
    expect(notes).toContain('bounded source excerpts'); expect(notes).not.toContain('No source text was cut');
    expect(threeLineEvidencePacket(expanded).sources.length).toBeGreaterThan(0);
  });
  it('never sends appendix-only expanded sources when paragraph selection is empty', () => {
    const { ledger, pages } = fixture([['Paper title', 'Short title.'], ['Appendix A', 'We introduce an appendix-only architecture that encodes many input tokens and improves all comparison results under the reported evaluation. '.repeat(3)]]);
    const expanded = createDetailedEvidenceLedger(ledger, pages);
    expect(expanded.candidates.length).toBeGreaterThan(0);
    expect(selectThreeLineContext(expanded, pages).paragraphs).toHaveLength(0);
    expect(threeLineEvidencePacket(expanded, pages).sources).toHaveLength(0);
  });
  it('keeps the Chinese body fallback without admitting strong English appendix or reference evidence', () => {
    const chinese = '我们提出一种保留原文来源的论文阅读方法，通过编码输入文本并构建可核实的上下文来生成有依据的回答，同时保留训练过程和推理过程的不同作用。'.repeat(2);
    const { ledger, pages } = fixture([
      ['1 Introduction', chinese],
      ['Appendix A', 'We introduce a strong appendix-only model and demonstrate improved accuracy in all training and inference settings. '.repeat(4)],
      ['A.1 Training', 'We present a supplementary-only encoding method for input representations and compare accuracy against all baselines. '.repeat(4)],
      ['References', 'We propose a reference-only method with strong performance results and improved comparison scores on every dataset. '.repeat(4)],
    ]);
    const expanded = createDetailedEvidenceLedger(ledger, pages), packet = threeLineEvidencePacket(expanded, pages);
    expect(selectThreeLineContext(expanded, pages).paragraphs).toHaveLength(0);
    expect(packet.sources.length).toBeGreaterThan(0);
    expect(packet.sources.every(source => !/appendix-only|supplementary-only|reference-only/i.test(source.excerpt))).toBe(true);
    expect(packet.sources.some(source => source.excerpt.includes('我们提出'))).toBe(true);
    for (const source of packet.sources) expect(resolveEvidencePacketAliases(packet, [source.alias], expanded, pages).length).toBeGreaterThan(0);
  });

  it('rejects a first-page explicit appendix title before abstract-like prose in both normal and fallback paths', () => {
    const appendixText = 'We propose a new supplementary architecture with an encoder and decoder for transforming input sequences. ' +
      'We investigate its training process and demonstrate improved results under every comparison condition. '.repeat(4);
    for (const heading of ['Appendix A', 'Appendices', 'Supplementary Material', 'References', 'Bibliography']) {
      const { ledger, pages } = fixture([[heading, appendixText]]);
      const expanded = createDetailedEvidenceLedger(ledger, pages);
      expect(selectThreeLineContext(expanded, pages).paragraphs, heading).toHaveLength(0);
      expect(threeLineEvidencePacket(expanded, pages).sources, heading).toHaveLength(0);
    }
  });
  it('does not treat an ordinary sentence mentioning Appendix A as a supplementary title', () => {
    const text = 'Appendix A describes further implementation details, while the main paper presents the method itself. ' + longDefinition;
    const { ledger, pages } = fixture([['1 Introduction', text]]);
    expect(threeLineEvidencePacket(createDetailedEvidenceLedger(ledger, pages), pages).sources.some(source => source.excerpt === text)).toBe(true);
  });

});
