import { describe, expect, it } from 'vitest';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import {
  DETAILED_SECTION_IDS,
  assembleDetailedOverview,
  detailedEvidencePacket,
  detailedSectionMessages,
  parseDetailedSectionResponse,
  progressiveDetailedSectionMessages,
  unavailableDetailedSection,
  validateDetailedSectionResponse,
  validateProgressiveDetailedSectionResponse,
} from './detailedOverview';
import { appendProgressiveEvidenceStage, createProgressiveEvidenceSession } from './evidencePacket';
import { createRetrievalIndex, selectRankedEvidenceForPurpose } from './retrievalIndex';

function block(rawText: string, sourceOrder: number): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return { blockId: `doc:p0:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex: 0, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false, anchor: { pageIndex: 0, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
}

function sample() {
  const page: PageExtraction = {
    pageIndex: 0,
    blocks: [
      block('Introduction problem and motivation from local source.', 0),
      block('Method framework and implementation steps from local source.', 1),
      block('Contributions and comparison to prior work from local source.', 2),
      block('Experiments and ablation results from local source.', 3),
      block('Limitations and evaluation scope from local source.', 4),
    ],
    searchableText: 'sample', textItemCount: 5, status: 'text',
  };
  return { page, ledger: pdfEvidenceLedgerFromPages([page], 'doc', []) };
}

describe('detailed overview compact section contract', () => {
  it('uses a fresh, isolated alias packet for every application-owned section', () => {
    const { ledger } = sample();
    const packets = DETAILED_SECTION_IDS.map((id) => detailedEvidencePacket(ledger, id));
    expect(new Set(packets).size).toBe(DETAILED_SECTION_IDS.length);
    for (const [index, packet] of packets.entries()) {
      const messages = detailedSectionMessages(DETAILED_SECTION_IDS[index], packet);
      expect(messages[0].content).toContain('only the');
      expect(messages[1].content).toContain(`"section":"${DETAILED_SECTION_IDS[index]}"`);
      expect(messages[1].content).toContain('"alias":"S01"');
      expect(messages[1].content).not.toContain('evidenceId');
      expect(messages[1].content).not.toContain('blockId');
    }
  });

  it('tells the model that dataset and benchmark construction is a valid method shape', () => {
    const { ledger } = sample();
    const messages = detailedSectionMessages('method', detailedEvidencePacket(ledger, 'method'));
    expect(messages[0].content).toContain('数据集、基准或评测论文');
    expect(messages[0].content).toContain('没有模型架构就判定资料不足');
    expect(messages[0].content).toContain('标注或问答如何构建');
  });

  it('restores application-owned block fields and original IDs only after packet-local binding', () => {
    const { page, ledger } = sample();
    const packet = detailedEvidencePacket(ledger, 'contributions');
    const response = parseDetailedSectionResponse('{"status":"available","text":"本文给出经过本地证据支持的核心贡献。","sources":["S01"],"providerMetadata":"ignored"}');
    const section = validateDetailedSectionResponse('contributions', response, packet, ledger, [page]);
    expect(section).toMatchObject({ id: 'contributions', status: 'available', blocks: [{ claimKind: 'author_claim' }] });
    expect(section.blocks[0].evidenceIds[0]).toBe(ledger.candidates[0].evidenceId);
    expect(section.blocks[0].evidenceRefs).toEqual([{ alias: 'S01', evidenceIds: [ledger.candidates[0].evidenceId] }]);
  });

  it('rejects unsupported aliases and stale anchors without affecting independently assembled sections', () => {
    const { page, ledger } = sample();
    const packet = detailedEvidencePacket(ledger, 'method');
    const invented = parseDetailedSectionResponse('{"status":"available","text":"不应通过。","sources":["S99"]}');
    expect(() => validateDetailedSectionResponse('method', invented, packet, ledger, [page])).toThrow(/unknown packet source alias/);
    const anchored = parseDetailedSectionResponse('{"status":"available","text":"不应通过。","sources":["S01"]}');
    expect(() => validateDetailedSectionResponse('method', anchored, packet, ledger, [{ ...page, blocks: [block('Changed local source.', 0), ...page.blocks.slice(1)] }])).toThrow(/verifiable|quote/);
    expect(unavailableDetailedSection('method').blocks[0]).toMatchObject({ claimKind: 'missing_information', evidenceIds: [] });
  });

  it('keeps unavailable output evidence-free and assembles exactly the fixed six-section order', () => {
    expect(() => parseDetailedSectionResponse('{"status":"unavailable","text":"资料不足","sources":["S01"]}')).toThrow(/evidence rules/);
    const sections = DETAILED_SECTION_IDS.map((id) => unavailableDetailedSection(id));
    const overview = assembleDetailedOverview(sections);
    expect(overview.sections.map((section) => section.id)).toEqual(DETAILED_SECTION_IDS);
    expect(overview.sections.every((section) => section.blocks[0].evidenceIds.length === 0)).toBe(true);
  });

  it('grows a stable progressive message prefix while only appending the next retrieved sources', () => {
    const { ledger } = sample();
    const session = createProgressiveEvidenceSession(ledger, {
      maxCandidatesByStage: { problem_motivation: 1, method: 1 },
    });
    const index = createRetrievalIndex(ledger);
    const problem = appendProgressiveEvidenceStage(session, 'problem_motivation', {
      orderedCandidates: selectRankedEvidenceForPurpose(index, 'problem_motivation', { maxCandidates: 2 }),
    });
    const first = progressiveDetailedSectionMessages('problem_motivation', problem, []);
    const history = [first[first.length - 1], { role: 'assistant' as const, content: '{"status":"available","text":"未核实草稿","sources":["E001"]}' }];
    const method = appendProgressiveEvidenceStage(session, 'method', {
      orderedCandidates: selectRankedEvidenceForPurpose(index, 'method', { maxCandidates: 2 }),
    });
    const second = progressiveDetailedSectionMessages('method', method, history);

    expect(second.slice(0, first.length)).toEqual(first);
    expect(second[0]).toMatchObject({ role: 'system' });
    expect(second[0].content).toContain('unverified drafts');
    expect(second.at(-1)?.content).toContain('"section":"method"');
    expect(second.at(-1)?.content).toContain('"legalSourceAliases":["E001"');
    expect(JSON.stringify(second)).not.toContain('evidenceId');
    expect(JSON.stringify(second)).not.toContain('blockId');
  });

  it('binds only aliases introduced through the progressive session and safely isolates an invalid section', () => {
    const { page, ledger } = sample();
    const session = createProgressiveEvidenceSession(ledger, { maxCandidatesByStage: { problem_motivation: 1, method: 1 } });
    appendProgressiveEvidenceStage(session, 'problem_motivation');
    const method = appendProgressiveEvidenceStage(session, 'method');
    const valid = parseDetailedSectionResponse(`{"status":"available","text":"方法段由本地摘录支持。","sources":["${method.sources[0].alias}"]}`);
    const validated = validateProgressiveDetailedSectionResponse('method', valid, session, ledger, [page]);
    expect(validated.status).toBe('available');
    expect(validated.blocks[0].evidenceRefs?.[0]).toMatchObject({ alias: method.sources[0].alias, evidenceIds: [validated.blocks[0].evidenceIds[0]] });
    const invalid = parseDetailedSectionResponse('{"status":"available","text":"不应通过。","sources":["E999"]}');
    expect(() => validateProgressiveDetailedSectionResponse('contributions', invalid, session, ledger, [page])).toThrow(/has not been sent/);
    expect(unavailableDetailedSection('contributions').blocks[0].evidenceIds).toEqual([]);
  });
});
