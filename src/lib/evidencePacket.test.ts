import { describe, expect, it } from 'vitest';
import {
  PROGRESSIVE_EVIDENCE_STAGES,
  appendProgressiveEvidenceStage,
  createEvidencePacket,
  createProgressiveEvidenceSession,
  resolveEvidencePacketAliases,
  resolveProgressiveEvidenceAliases,
} from './evidencePacket';
import { pdfEvidenceLedgerFromPages, type EvidenceLedger } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import type { PdfSectionCandidate } from './pdfSectionCandidates';
import { createRetrievalIndex, selectRankedEvidenceForPurpose } from './retrievalIndex';
import { createEvidencePassages } from './evidencePassages';

function block(pageIndex: number, sourceOrder: number, rawText: string): PdfPageTextBlock {
  const normalized = normalizePdfTextItem(rawText);
  return { blockId: `doc:p${pageIndex}:i${sourceOrder}`, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder, rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap, rawTransform: [1, 0, 0, 1, 0, 0], rawWidth: 20, rawHeight: 10, hasEol: false, anchor: { pageIndex, quote: rawText, rects: [{ x: 0, y: 0, width: 20, height: 10 }], coordinateSpace: 'pdfjs-text-item' }, qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
}

function page(pageIndex: number, blocks: PdfPageTextBlock[]): PageExtraction {
  return { pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
}

function section(title: string, source: PdfPageTextBlock): PdfSectionCandidate {
  return { candidateId: `section-${source.blockId}`, title, pageIndex: source.pageIndex, anchor: source.anchor, confidence: 'high', signals: ['numbered-title'], caution: 'Automatic candidate only; multi-column pages, tables, and formulas can produce false headings.' };
}

function sample(): { ledger: EvidenceLedger; pages: PageExtraction[] } {
  const intro = block(0, 0, '1. Introduction');
  const problem = block(0, 1, 'A specific problem motivates this paper.');
  const methodHeading = block(1, 0, '2. Methods');
  const method = block(1, 1, 'We introduce a compact and reproducible method.');
  const duplicate = block(1, 2, 'We introduce a compact and reproducible method.');
  const resultHeading = block(2, 0, '3. Experiments');
  const result = block(2, 1, 'The method improves the reported benchmark result.');
  const pages = [page(0, [intro, problem]), page(1, [methodHeading, method, duplicate]), page(2, [resultHeading, result])];
  return { pages, ledger: pdfEvidenceLedgerFromPages(pages, 'doc', [section('1. Introduction', intro), section('2. Methods', methodHeading), section('3. Experiments', resultHeading)]) };
}

describe('compact evidence packet', () => {
  it('uses stable short aliases, purpose preference, and quote deduplication', () => {
    const { ledger } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'three_line', maxCandidates: 3 });
    expect(packet.sources.map((source) => source.alias)).toEqual(['S01', 'S02', 'S03']);
    expect(packet.sources[0].slot).toBe('method_overview');
    expect(packet.sources.filter((source) => source.excerpt === 'We introduce a compact and reproducible method.')).toHaveLength(1);
    expect(JSON.stringify(packet)).not.toContain('blockId');
    expect(JSON.stringify(packet)).not.toContain('evidenceId');
  });

  it('bounds Unicode excerpts without changing the original local quote', () => {
    const { ledger } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'method', maxCandidates: 1, maxExcerptChars: 12 });
    expect(Array.from(packet.sources[0].excerpt)).toHaveLength(12);
    expect(packet.sources[0].excerpt).toMatch(/…$/);
    expect(ledger.candidates.find((candidate) => candidate.quote === 'We introduce a compact and reproducible method.')?.quote).toBe('We introduce a compact and reproducible method.');
  });

  it('creates purpose-scoped packets and lets callers override preferences', () => {
    const { ledger } = sample();
    const experiment = createEvidencePacket(ledger, { purpose: 'experiments_ablations', maxCandidates: 1 });
    const overridden = createEvidencePacket(ledger, { purpose: 'method', preferredSlots: ['problem'], maxCandidates: 1 });
    expect(experiment.sources[0].slot).toBe('evaluation_scope');
    expect(overridden.sources[0].slot).toBe('problem');
  });

  it('filters title-page metadata and fragmented text before falling back to readable body evidence', () => {
    const { ledger } = sample();
    const template = ledger.candidates[0];
    const frontMatterLedger: EvidenceLedger = {
      ...ledger,
      candidates: [
        { ...template, evidenceId: 'title', quote: 'A Compact Framework for Reliable Scientific Reading', section: { title: 'Unknown', confidence: 'unknown' }, slot: 'unclassified_body' },
        { ...template, evidenceId: 'authors', quote: 'Ada Lovelace, Grace Hopper, Alan Turing', section: { title: 'Unknown', confidence: 'unknown' }, slot: 'unclassified_body' },
        { ...template, evidenceId: 'number', quote: '1, 2, 3 …', section: { title: 'Unknown', confidence: 'unknown' }, slot: 'unclassified_body' },
        { ...template, evidenceId: 'doi', quote: 'https://doi.org/10.1000/example', section: { title: 'Unknown', confidence: 'unknown' }, slot: 'unclassified_body' },
        { ...template, evidenceId: 'body', quote: 'We evaluate the proposed approach on three benchmark tasks with controlled comparisons.', section: { title: 'Introduction', confidence: 'automatic' }, slot: 'problem' },
      ],
    };
    const packet = createEvidencePacket(frontMatterLedger, { purpose: 'method', maxCandidates: 2 });
    // No method slot exists. The fallback must choose readable prose, not the
    // original-order title, author list, identifier, or punctuation fragment.
    expect(packet.sources).toHaveLength(1);
    expect(packet.sources[0]).toMatchObject({ slot: 'problem', excerpt: 'We evaluate the proposed approach on three benchmark tasks with controlled comparisons.' });
  });

  it('maps only packet aliases back to current, verifiable local evidence', () => {
    const { ledger, pages } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'method', maxCandidates: 1 });
    expect(resolveEvidencePacketAliases(packet, ['S01'], ledger, pages)[0].slot).toBe('method_overview');
    expect(() => resolveEvidencePacketAliases(packet, ['S99'], ledger, pages)).toThrow(/unknown packet source alias/);
    expect(() => resolveEvidencePacketAliases(packet, ['S01', 'S01'], ledger, pages)).toThrow(/repeated a packet source alias/);
  });

  it('rejects a packet alias when the current local quote has changed', () => {
    const { ledger, pages } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'method', maxCandidates: 1 });
    const changedPages = pages.map((item) => item.pageIndex === 1 ? { ...item, blocks: item.blocks.map((item) => item.sourceOrder === 1 ? block(1, 1, 'Changed local quote.') : item) } : item);
    expect(() => resolveEvidencePacketAliases(packet, ['S01'], ledger, changedPages)).toThrow(/does not resolve to verifiable|no longer matches/);
  });

  it('adds globally stable aliases only as progressive stages introduce new local excerpts', () => {
    const { ledger } = sample();
    const session = createProgressiveEvidenceSession(ledger, {
      maxCandidatesByStage: {
        problem_motivation: 1, method: 1, contributions: 1,
        relative_novelty: 1, experiments_ablations: 1, limitations: 1,
      },
      maxExcerptChars: 12,
    });
    const problem = appendProgressiveEvidenceStage(session, 'problem_motivation');
    expect(problem.sources.map((source) => source.alias)).toEqual(['E001']);
    expect(problem.sentAliases).toEqual(['E001']);
    expect(JSON.stringify(problem)).not.toMatch(/evidenceId|blockId|normalizedStart|qualityWarnings/);

    const method = appendProgressiveEvidenceStage(session, 'method');
    expect(method.sources.map((source) => source.alias)).toEqual(['E002']);
    expect(method.sentAliases).toEqual(['E001', 'E002']);
    expect(method.sources[0].excerpt).toMatch(/…$/);
    expect(method.sources[0].excerpt).not.toBe(problem.sources[0].excerpt);

    const contribution = appendProgressiveEvidenceStage(session, 'contributions');
    expect(contribution.sources.map((source) => source.alias)).toEqual(['E003']);
    expect(new Set([...problem.sources, ...method.sources, ...contribution.sources].map((source) => source.excerpt)).size).toBe(3);
  });

  it('does not allow future, repeated, foreign-ledger, or stale-anchor progressive aliases', () => {
    const { ledger, pages } = sample();
    const session = createProgressiveEvidenceSession(ledger, { maxCandidatesByStage: { problem_motivation: 1, method: 1 } });
    appendProgressiveEvidenceStage(session, 'problem_motivation');
    expect(() => resolveProgressiveEvidenceAliases(session, ['E002'], ledger, pages)).toThrow(/has not been sent/);
    expect(() => resolveProgressiveEvidenceAliases(session, ['E001', 'E001'], ledger, pages)).toThrow(/repeated a progressive/);
    expect(() => appendProgressiveEvidenceStage(session, 'contributions')).toThrow(/application-defined order/);

    const method = appendProgressiveEvidenceStage(session, 'method');
    expect(resolveProgressiveEvidenceAliases(session, ['E001', method.sources[0].alias], ledger, pages)).toHaveLength(2);
    const changedPages = pages.map((item) => item.pageIndex === 1 ? { ...item, blocks: item.blocks.map((source) => source.sourceOrder === 1 ? block(1, 1, 'Changed local quote.') : source) } : item);
    expect(() => resolveProgressiveEvidenceAliases(session, [method.sources[0].alias], ledger, changedPages)).toThrow(/verifiable|quote/);
    expect(() => resolveProgressiveEvidenceAliases(session, ['E001'], { ...ledger, documentVersion: 'other-document' }, pages)).toThrow(/different PDF ledger/);
  });

  it('uses an explicit retrieval order over the old slot fallback, while rejecting foreign or ineligible candidates', () => {
    const { ledger } = sample();
    const session = createProgressiveEvidenceSession(ledger, { maxCandidatesByStage: { problem_motivation: 1, method: 1 } });
    appendProgressiveEvidenceStage(session, 'problem_motivation');
    const ordered = selectRankedEvidenceForPurpose(createRetrievalIndex(ledger), 'method', { maxCandidates: 2 });
    const method = appendProgressiveEvidenceStage(session, 'method', { orderedCandidates: ordered });
    expect(method.sources[0].excerpt).toContain('compact and reproducible method');

    const next = createProgressiveEvidenceSession(ledger);
    const foreign = { ...ledger.candidates[0], evidenceId: 'other-ledger' };
    expect(() => appendProgressiveEvidenceStage(next, 'problem_motivation', { orderedCandidates: [foreign] })).toThrow(/exact current PDF ledger/);
    const heading = ledger.candidates.find((item) => item.quote === '1. Introduction')!;
    expect(() => appendProgressiveEvidenceStage(next, 'problem_motivation', { orderedCandidates: [heading] })).toThrow(/eligible readable body/);
  });

  it('binds a joined passage alias back to every original member anchor', () => {
    const { ledger, pages } = sample();
    const session = createProgressiveEvidenceSession(ledger, { maxCandidatesByStage: { problem_motivation: 1 } });
    const passages = createEvidencePassages(ledger, { minimumChars: 1 });
    const joined = passages.passages.find((passage) => passage.members.length > 1)!;
    const increment = appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [joined] });
    const resolved = resolveProgressiveEvidenceAliases(session, [increment.sources[0].alias], ledger, pages);
    expect(resolved.map((candidate) => candidate.evidenceId)).toEqual(joined.members.map((member) => member.candidate.evidenceId));
  });

  it('requires a new isolated session and the fixed six-stage sequence for every user request', () => {
    const { ledger } = sample();
    const one = createProgressiveEvidenceSession(ledger);
    const two = createProgressiveEvidenceSession(ledger);
    expect(one).not.toBe(two);
    for (const stage of PROGRESSIVE_EVIDENCE_STAGES) appendProgressiveEvidenceStage(one, stage);
    expect(() => appendProgressiveEvidenceStage(one, 'limitations')).toThrow(/application-defined order/);
    expect(() => resolveProgressiveEvidenceAliases(two, ['E001'], ledger, [])).toThrow(/has not been sent/);
  });
});
