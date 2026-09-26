import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { parseThreeLineOverview, threeLineEvidencePacket, threeLineOverviewMessages, validateThreeLineOverview } from './threeLineOverview';

function block(rawText: string): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return { blockId: 'doc:p0:i0', documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex: 0, sourceOrder: 0, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false, anchor: { pageIndex: 0, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
}

function sample() {
  const first = block('We introduce a reproducible local method.');
  const second = { ...block('We validate its compact training design.'), blockId: 'doc:p0:i1', sourceOrder: 1 };
  const third = { ...block('Experiments report the benchmark trade-off.'), blockId: 'doc:p0:i2', sourceOrder: 2 };
  const page: PageExtraction = { pageIndex: 0, blocks: [first, second, third], searchableText: 'sample', textItemCount: 3, status: 'text' };
  const ledger = pdfEvidenceLedgerFromPages([page], 'doc', []);
  return { page, ledger, packet: threeLineEvidencePacket(ledger) };
}

describe('three-line overview compact contract', () => {
  it('restores app-owned fields after resolving three distinct aliases against current local anchors', () => {
    const { page, ledger, packet } = sample();
    const response = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `第${index + 1}项经过本地证据核对的贡献。`, sources: [`S0${index + 1}`], providerDiagnostic: 'ignored' })), providerMetadata: 'ignored' }));
    const overview = validateThreeLineOverview(response, packet, ledger, [page]);
    expect(overview.kind).toBe('three_line');
    expect(overview.items.map((item) => item.role)).toEqual(['contribution', 'contribution', 'contribution']);
    expect(overview.items.map((item) => item.evidenceIds)).toEqual(ledger.candidates.slice(0, 3).map((candidate) => [candidate.evidenceId]));
  });

  it('requires three sourced items and rejects invented, repeated, or stale aliases', () => {
    expect(() => parseThreeLineOverview('{"items":[]}')).toThrow(/format/);
    expect(() => parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map(() => ({ text: '无来源的事实条目不应通过。', sources: [] })) }))).toThrow(/format/);
    const { page, ledger, packet } = sample();
    const invented = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: [`S9${index + 7}`] })) }));
    expect(() => validateThreeLineOverview(invented, packet, ledger, [page])).toThrow(/unknown packet source alias/);
    const repeated = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: ['S01'] })) }));
    expect(() => validateThreeLineOverview(repeated, packet, ledger, [page])).toThrow(/repeated a packet source alias/);
    const anchored = parseThreeLineOverview(JSON.stringify({ items: [0, 1, 2].map((index) => ({ text: `条目${index}`, sources: [`S0${index + 1}`] })) }));
    expect(() => validateThreeLineOverview(anchored, packet, ledger, [{ ...page, blocks: [block('Changed source quote.'), ...page.blocks.slice(1)] }])).toThrow(/verifiable|quote/);
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
