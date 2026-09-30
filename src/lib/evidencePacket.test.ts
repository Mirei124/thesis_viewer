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
import { createPassageRetrievalIndex, selectRankedPassagesForPurpose } from './retrievalIndex';
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
  it('keeps distinct 3DGS representation, density, rasterization and conditioned speed evidence', () => {
    const quoted = [
      'The input to our method is a set of images of a static scene, together with the corresponding cameras calibrated by SfM which produces a sparse point cloud. From these points we create a set of 3D Gaussians, defined by a position, covariance matrix and opacity.',
      'For small Gaussians that are in under-reconstructed regions, it is preferable to clone the Gaussians. On the other hand, large Gaussians in regions with high variance need to be split into smaller Gaussians.',
      'After sorting Gaussians, we produce a list for each tile by identifying the first and last depth-sorted entry that splats to a given tile. For rasterization, we launch one thread block for each tile.',
      '30 fps) novel-view synthesis at 1080p resolution. First, starting from sparse points produced during camera calibration, we represent the scene with 3D Gaussians.',
    ];
    const pages = quoted.map((text, index) => page(index, [block(index, 0, text)]));
    for (let index = 4; index < 17; index += 1) pages.push(page(index, [block(index, 0, `We evaluate anisotropic covariance in an ablation against prior radiance-field baselines and report improved rendering quality for scene ${index}.`)]));
    const ledger = pdfEvidenceLedgerFromPages(pages, 'doc', []);
    const packet = createEvidencePacket(ledger, { purpose: 'three_line', maxExcerptChars: 600 });
    const first = packet.sources.slice(0, 4).map((item) => item.excerpt).join(' ');
    expect(first).toContain('calibrated by SfM');
    expect(first).toContain('clone the Gaussians');
    expect(first).toContain('split into smaller Gaussians');
    expect(first).toContain('depth-sorted entry');
    expect(first).toContain('1080p resolution');
    expect(packet.sources.length).toBeLessThanOrEqual(12);
    for (const item of packet.sources.slice(0, 4)) expect(resolveEvidencePacketAliases(packet, [item.alias], ledger, pages).length).toBeGreaterThan(0);
  });

  it('keeps Segment Anything task and encoder/decoder model beside data-engine scale', () => {
    // Short source excerpts from Segment Anything (arXiv:2304.02643), with
    // separate pages standing in for the paper's task/model/data sections.
    const taskTitle = block(0, 0, '1. Introduction');
    const modelTitle = block(1, 0, '3. The Segment Anything Model');
    const dataTitle = block(2, 0, '4. Data Engine');
    const resultTitle = block(3, 0, '5. Experiments');
    const scalePages = Array.from({ length: 10 }, (_, index) => {
      const pageIndex = index + 4;
      const title = block(pageIndex, 0, '4. Data Engine');
      return { title, value: page(pageIndex, [title, block(pageIndex, 1, `We collect ${index + 2} million image-mask pairs through a staged data engine with quality review and annotator feedback.`)]) };
    });
    const pages = [
      page(0, [taskTitle, block(0, 1, 'The promptable segmentation task is to return a valid segmentation mask given any segmentation prompt. This task enables a general interface for segmentation.')]),
      page(1, [modelTitle, block(1, 1, 'We use an image encoder, a prompt encoder, and a lightweight mask decoder. The image encoder computes an image embedding and the prompt encoder embeds the input prompt for the decoder.')]),
      page(2, [dataTitle, block(2, 1, 'We introduce a data engine to collect the SA-1B dataset with 11 million images and over 1 billion masks through multiple collection stages.')]),
      page(3, [resultTitle, block(3, 1, 'We evaluate the model on zero-shot transfer to several segmentation tasks and report strong performance across these benchmarks.')]),
      ...scalePages.map((item) => item.value),
    ];
    const ledger = pdfEvidenceLedgerFromPages(pages, 'doc', [section('1. Introduction', taskTitle), section('3. The Segment Anything Model', modelTitle), section('4. Data Engine', dataTitle), section('5. Experiments', resultTitle), ...scalePages.map((item) => section('4. Data Engine', item.title))]);
    const packet = createEvidencePacket(ledger, { purpose: 'three_line', maxExcerptChars: 400 });
    expect(packet.sources.length).toBeLessThanOrEqual(12);
    expect(packet.sources.some((source) => source.excerpt.includes('promptable segmentation task'))).toBe(true);
    const model = packet.sources.find((source) => source.excerpt.includes('image encoder'))!;
    expect(model.excerpt).toContain('prompt encoder');
    expect(model.excerpt).toContain('mask decoder');
    expect(packet.sources.some((source) => source.excerpt.includes('data engine'))).toBe(true);
    expect(resolveEvidencePacketAliases(packet, [model.alias], ledger, pages).length).toBeGreaterThanOrEqual(1);
  });

  it('sends all four Video-MME comparison features through a verifiable detailed alias', () => {
    const excerpts = [
      'Our work distinguishes from existing benchmarks', 'through four key features:',
      '1) Diversity in video types', ', spanning 6 primary visual domains with 30 subfields to ensure broad scenario generalizability;',
      '2) Duration in temporal dimension', ', encompassing short-, medium-, and long-term videos, ranging from 11 seconds to 1 hour;',
      '3) Breadth in data modalities', ', integrating multi-modal inputs besides video frames, including subtitles and audios;',
      '4) Quality in annotations', ', utilizing rigorous manual labeling by expert annotators to facilitate precise and reliable model assessment.',
    ];
    const sourceBlocks = excerpts.map((text, index) => block(0, index, text));
    const pages = [page(0, sourceBlocks)];
    const ledger = pdfEvidenceLedgerFromPages(pages, 'doc', []);
    const passages = createEvidencePassages(ledger, { targetChars: 520, maxChars: 1500 });
    const ordered = selectRankedPassagesForPurpose(createPassageRetrievalIndex(passages), 'relative_novelty', { maxCandidates: 24, maxCandidatesPerPage: 2 });
    const session = createProgressiveEvidenceSession(ledger, { maxExcerptChars: 1500 });
    for (const stage of PROGRESSIVE_EVIDENCE_STAGES) {
      const increment = appendProgressiveEvidenceStage(session, stage, { orderedPassages: stage === 'relative_novelty' ? ordered : [] });
      if (stage !== 'relative_novelty') continue;
      const source = increment.sources.find((item) => item.excerpt.includes('four key features'))!;
      expect(source.excerpt).toContain('manual labeling by expert annotators');
      expect(source.excerpt).not.toMatch(/…$/);
      expect(resolveProgressiveEvidenceAliases(session, [source.alias], ledger, pages).length).toBeGreaterThanOrEqual(8);
    }
  });

  it('makes fragmented benchmark construction, duration and measured comparison visible without captions or discussion', () => {
    const introduction = block(1, 0, '1. Introduction');
    const construction = block(2, 0, '3.1 Dataset Construction');
    const results = block(3, 0, '4.2 Quantitative Results');
    const discussion = block(4, 0, '5. Discussions');
    const pages = [
      page(0, [
        block(0, 0, 'Our work distinguishes from existing benchmarks'),
        block(0, 1, 'through four key features:'),
        block(0, 3, '1) Diversity in video types, spanning 6 domains and 30 subfields;'),
        block(0, 5, '2) Duration in temporal dimension, from 11 seconds to 1 hour;'),
        block(0, 7, '3) Breadth in data modalities, including subtitles and audios;'),
        block(0, 9, '4) Quality in annotations, with expert review of each question.'),
      ]),
      page(1, [introduction, block(1, 1, 'We meticulously curate a dataset of 900 videos and annotate 2,700 multiple-choice questions for evaluation.')]),
      page(2, [construction, block(2, 1, 'Following collection, annotators create question-answer pairs and a second annotator reviews each answer for correctness.'),
        block(2, 3, 'Figure 1. Overview of benchmark construction and annotation.'),
        block(2, 4, 'This caption summarizes the schematic rather than giving a new result.')]),
      page(3, [results, block(3, 1, 'With video frames as input alone, Model A attains 75% accuracy, surpassing Model B by 3.1 percentage points on the same benchmark.')]),
      page(4, [discussion, block(4, 1, 'We discuss future opportunities for improving long sequence processing and possible architectural extensions.')]),
    ];
    const source = pdfEvidenceLedgerFromPages(pages, 'doc', [section('1. Introduction', introduction), section('3.1 Dataset Construction', construction), section('4.2 Quantitative Results', results), section('5. Discussions', discussion)]);
    const packet = createEvidencePacket(source, { purpose: 'three_line', maxExcerptChars: 400 });
    const excerpts = packet.sources.map((item) => item.excerpt).join(' ');
    expect(packet.sources.length).toBeLessThanOrEqual(12);
    expect(excerpts).toContain('11 seconds to 1 hour');
    expect(excerpts).toContain('900 videos');
    expect(excerpts).toContain('2,700 multiple-choice questions');
    expect(excerpts).toContain('75% accuracy');
    expect(excerpts).not.toContain('future opportunities');
    expect(excerpts).not.toContain('Figure 1');
    expect(excerpts).not.toContain('This caption');
    const list = packet.sources.find((item) => item.excerpt.includes('four key features'))!;
    expect(resolveEvidencePacketAliases(packet, [list.alias], source, pages).length).toBeGreaterThan(2);
  });

  it('puts distinct construction and validation prose into a bounded three-line packet', () => {
    const intro = block(0, 0, '1. Introduction');
    const contributions = Array.from({ length: 12 }, (_, index) => block(0, index + 1, `We introduce Video-MME as a benchmark for evaluating multimodal large language models across diverse video lengths and tasks, contribution ${index + 1}.`));
    const methodHeading = block(1, 0, '3. Benchmark Construction');
    const construction = block(1, 1, 'We collect videos from multiple categories and split them into short, medium and long durations, then annotate question-answer pairs with human verification.');
    const resultsHeading = block(2, 0, '4. Experiments');
    const result = block(2, 1, 'The evaluation compares open-source and proprietary video models on Video-MME and reports accuracy separately for short, medium and long videos.');
    const pages = [page(0, [intro, ...contributions]), page(1, [methodHeading, construction]), page(2, [resultsHeading, result])];
    const source = pdfEvidenceLedgerFromPages(pages, 'doc', [section('1. Introduction', intro), section('3. Benchmark Construction', methodHeading), section('4. Experiments', resultsHeading)]);
    const packet = createEvidencePacket(source, { purpose: 'three_line' });
    expect(packet.sources.length).toBeGreaterThanOrEqual(3);
    expect(packet.sources.length).toBeLessThanOrEqual(12);
    expect(packet.sources.some((item) => item.excerpt.includes('annotate question-answer pairs'))).toBe(true);
    expect(packet.sources.some((item) => item.excerpt.includes('accuracy separately'))).toBe(true);
    for (const item of packet.sources) expect(resolveEvidencePacketAliases(packet, [item.alias], source, pages).length).toBeGreaterThanOrEqual(1);
    expect(() => resolveEvidencePacketAliases(packet, ['S13'], source, pages)).toThrow(/unknown packet source alias/);
  });

  it('uses stable short aliases, purpose preference, and quote deduplication', () => {
    const { ledger } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'three_line', maxCandidates: 3 });
    expect(packet.sources.map((source) => source.alias)).toEqual(['S01', 'S02']);
    expect(packet.sources[0].slot).toBe('method_overview');
    expect(packet.sources.filter((source) => source.excerpt.includes('compact and reproducible method'))).toHaveLength(1);
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

  it('binds one joined three-line alias to every original text item and rejects a stale member', () => {
    const { ledger, pages } = sample();
    const packet = createEvidencePacket(ledger, { purpose: 'three_line' });
    const joined = packet.sources.find((item) => item.excerpt.includes('compact and reproducible method'))!;
    const members = resolveEvidencePacketAliases(packet, [joined.alias], ledger, pages);
    expect(members.map((item) => item.quote)).toEqual([
      'We introduce a compact and reproducible method.',
      'We introduce a compact and reproducible method.',
    ]);
    const stale = pages.map((item) => item.pageIndex === 1
      ? { ...item, blocks: item.blocks.map((source) => source.sourceOrder === 2 ? block(1, 2, 'Changed second source quote.') : source) }
      : item);
    expect(() => resolveEvidencePacketAliases(packet, [joined.alias], ledger, stale)).toThrow(/verifiable|quote/);
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
