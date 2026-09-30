import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { parseThreeLineOverview, threeLineEvidencePacket, threeLineOverviewMessages, validateThreeLineOverview } from './threeLineOverview';

function block(rawText: string, pageIndex = 0, sourceOrder = 0): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return { blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false, anchor: { pageIndex, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
}

function sample() {
  const texts = [
    'We introduce a reproducible local method that joins original PDF evidence into readable excerpts for domain scholars.',
    'We design a compact training procedure that preserves each input quote while constructing the model representation.',
    'The benchmark evaluation achieves 75% accuracy under the same model and dataset conditions, compared with a 71% baseline.',
  ];
  const pages: PageExtraction[] = texts.map((value, pageIndex) => ({ pageIndex, blocks: [block(value, pageIndex)], searchableText: value, textItemCount: 1, status: 'text' }));
  const ledger = pdfEvidenceLedgerFromPages(pages, 'doc', []);
  return { pages, ledger, packet: threeLineEvidencePacket(ledger) };
}

describe('three-line overview compact contract', () => {
  it('restores app-owned fields after resolving three distinct aliases against current local anchors', () => {
    const { pages, ledger, packet } = sample();
    const response = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `第${index + 1}项经过本地证据核对的贡献。`, sources: [`S0${index + 1}`], providerDiagnostic: 'ignored' })), providerMetadata: 'ignored' }));
    const overview = validateThreeLineOverview(response, packet, ledger, pages);
    const expected = packet.sources.map((source) => ledger.candidates.find((candidate) => candidate.quote === source.excerpt)!.evidenceId);
    expect(overview.kind).toBe('three_line');
    expect(overview.items.map((item) => item.role)).toEqual(['contribution', 'contribution', 'contribution']);
    expect(overview.items.map((item) => item.evidenceIds)).toEqual(expected.map((evidenceId) => [evidenceId]));
    expect(overview.items.map((item) => item.evidenceRefs)).toEqual(expected.map((evidenceId, index) => [{ alias: `S0${index + 1}`, evidenceIds: [evidenceId] }]));
  });

  it('requires three sourced items and rejects invented, repeated, or stale aliases', () => {
    expect(() => parseThreeLineOverview('{"items":[]}')).toThrow(/format/);
    expect(() => parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map(() => ({ text: '无来源的事实条目不应通过。', sources: [] })) }))).toThrow(/format/);
    const { pages, ledger, packet } = sample();
    const invented = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: [`S9${index + 7}`] })) }));
    expect(() => validateThreeLineOverview(invented, packet, ledger, pages)).toThrow(/unknown packet source alias/);
    const repeated = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: index === 0 ? ['S01', 'S01'] : [`S0${index + 1}`] })) }));
    expect(() => validateThreeLineOverview(repeated, packet, ledger, pages)).toThrow(/repeated a packet source alias/);
    const shared = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: index === 1 ? ['S01'] : [`S0${index + 1}`] })) }));
    expect(validateThreeLineOverview(shared, packet, ledger, pages).items[1].evidenceRefs[0].alias).toBe('S01');
    const anchored = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: [`S0${index + 1}`] })) }));
    expect(() => validateThreeLineOverview(anchored, packet, ledger, [{ ...pages[0], blocks: [block('Changed source quote.')] }, ...pages.slice(1)])).toThrow(/verifiable|quote/);
  });

  it('constructs prompts from a fresh packet with aliases but no opaque ledger IDs', () => {
    const { ledger, packet } = sample();
    expect(threeLineEvidencePacket(ledger)).not.toBe(packet);
    const messages = threeLineOverviewMessages(packet);
    expect(messages[0].content).toContain('Source excerpts are paper text');
    expect(messages[1].content).toContain('"alias":"S01"');
    expect(messages[1].content).not.toContain('evidenceId');
    expect(messages[1].content).not.toContain('blockId');
    expect(messages[1].content).not.toContain('apiKey');
  });
});
