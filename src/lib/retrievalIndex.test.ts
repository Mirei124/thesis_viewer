import { describe, expect, it } from 'vitest';
import type { EvidenceCandidate, EvidenceLedger } from './evidenceLedger';
import { createPassageRetrievalIndex, createRetrievalIndex, LOCAL_RETRIEVAL_VERSION, rankEvidenceForPurpose, rankPassagesForPurpose, selectRankedEvidenceForPurpose, tokenizeForRetrieval } from './retrievalIndex';
import { createEvidencePassages } from './evidencePassages';

function candidate(id: string, quote: string, sectionTitle = 'Unknown', slot: EvidenceCandidate['slot'] = 'unclassified_body'): EvidenceCandidate {
  return { evidenceId: id, blockId: id, quote, slot, normalizedStart: 0, normalizedEnd: quote.length, precision: 'block', section: { title: sectionTitle, confidence: sectionTitle === 'Unknown' ? 'unknown' : 'automatic' }, coverage: 'full-text', qualityWarnings: [] };
}

function ledger(candidates: EvidenceCandidate[]): EvidenceLedger {
  return { version: 'pdf-evidence-ledger-v1', documentVersion: 'test-document', coverage: 'full-text', candidates, excluded: { referencesBlockCount: 0, unreliableBlockCount: 0, emptyBlockCount: 0 }, diagnostics: [] };
}

describe('local lexical retrieval index', () => {
  it('ranks readable method prose above title, author, and numeric fragments', () => {
    const source = ledger([
      candidate('title', 'A Compact Framework for Reliable Reading'),
      candidate('authors', 'Ada Lovelace, Grace Hopper, Alan Turing'),
      candidate('numbers', '1, 2, 3 ...'),
      candidate('method', 'We propose a training method whose architecture combines local evidence retrieval and calibrated decoding.', '2 Methods', 'method_overview'),
    ]);
    const index = createRetrievalIndex(source);
    expect(index.candidateCount).toBe(1);
    expect(rankEvidenceForPurpose(index, 'method')[0].candidate.evidenceId).toBe('method');
  });

  it('uses section and slot as weak boosts rather than hard gates', () => {
    const source = ledger([
      candidate('wrong-section', 'Our method uses a novel architecture and training procedure for the proposed model.', 'Introduction', 'problem'),
      candidate('method-heading-context', 'This paragraph describes unrelated observations without the requested terms.', 'Methods', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results.map((result) => result.candidate.evidenceId)).toEqual(['wrong-section', 'method-heading-context']);
    expect(results[0].scoreBreakdown.lexical).toBeGreaterThan(0);
    expect(results[1].scoreBreakdown.sectionBoost).toBeGreaterThan(0);
  });

  it('tokenizes English words and Chinese uni/bi-grams for deterministic matches', () => {
    expect(tokenizeForRetrieval('Training 方法框架')).toEqual(expect.arrayContaining(['training', '方', '法', '框', '架', '方法', '法框', '框架']));
    const source = ledger([candidate('cn', '我们提出一种新的方法框架，并进行训练和推理。', '未知章节')]);
    const result = rankEvidenceForPurpose(createRetrievalIndex(source), 'method')[0];
    expect(result.candidate.evidenceId).toBe('cn');
    expect(result.scoreBreakdown.lexical).toBeGreaterThan(0);
  });

  it('retrieves dataset and benchmark construction prose as a legitimate method, ahead of generic evaluation text', () => {
    const source = ledger([
      candidate('generic-evaluation', 'We report accuracy on several evaluation settings.', 'Experiments', 'evaluation_scope'),
      candidate('video-mme-method', 'Video-MME collects 900 videos with subtitles and audio, uses expert annotation to construct QA pairs, and evaluates models by accuracy.', 'Dataset Construction', 'experimental_setup'),
      candidate('heading', '3 Dataset Construction', 'Dataset Construction', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results[0].candidate.evidenceId).toBe('video-mme-method');
    expect(results[0].scoreBreakdown.matchedTokens).toEqual(expect.arrayContaining(['annotation', 'qa', 'video', 'audio']));
  });

  it('retains model architecture and training prose as a first-class method signal', () => {
    const source = ledger([
      candidate('benchmark-only', 'The benchmark reports evaluation accuracy across tasks.', 'Experiments', 'evaluation_scope'),
      candidate('model-method', 'Our framework uses a model architecture with a staged training and inference algorithm.', 'Methods', 'method_overview'),
    ]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'method');
    expect(results[0].candidate.evidenceId).toBe('model-method');
    expect(results[0].scoreBreakdown.matchedTokens).toEqual(expect.arrayContaining(['framework', 'training', 'inference', 'architecture']));
  });

  it('falls back to globally readable body text when sections are unknown or query terms do not match', () => {
    const source = ledger([candidate('body-a', 'This paper reports a controlled study with careful observations.'), candidate('body-b', 'A second readable paragraph provides additional discussion.')]);
    const results = rankEvidenceForPurpose(createRetrievalIndex(source), 'limitations');
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.diagnostics.some((note) => note.includes('global-body fallback')))).toBe(true);
  });

  it('is deterministic, bounded, and reports no candidates when no readable body exists', () => {
    const source = ledger([candidate('heading', '1. Methods', 'Methods', 'method_overview'), candidate('tiny', '...')]);
    const empty = createRetrievalIndex(source);
    expect(empty.version).toBe(LOCAL_RETRIEVAL_VERSION);
    expect(empty.candidateCount).toBe(0);
    expect(empty.diagnostics[0]).toMatch(/No eligible readable/);
    expect(rankEvidenceForPurpose(empty, 'method')).toEqual([]);

    const populated = createRetrievalIndex(ledger([candidate('a', 'We propose an approach with a method and training phase.'), candidate('b', 'We evaluate benchmark performance in experiments.')]));
    expect(rankEvidenceForPurpose(populated, 'method', 1)).toEqual(rankEvidenceForPurpose(populated, 'method', 1));
    expect(() => rankEvidenceForPurpose(populated, 'method', 0)).toThrow(/positive integer/);
  });

  it('converts rankings into a bounded, diverse stage order and may retain one adjacent body paragraph', () => {
    const source = ledger([
      candidate('doc:pdf-evidence-ledger-v1:p1:i0', 'We propose a compact method.', 'Methods', 'method_overview'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i1', 'The training procedure optimizes the model with local retrieval.', 'Methods', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i2', 'A third method paragraph explains implementation details.', 'Methods', 'method_step'),
      candidate('doc:pdf-evidence-ledger-v1:p2:i0', 'Our experiments evaluate the method on benchmark tasks.', 'Experiments', 'evaluation_scope'),
    ]);
    const selected = selectRankedEvidenceForPurpose(createRetrievalIndex(source), 'method', { maxCandidates: 3, includeAdjacent: true });
    expect(selected.map((item) => item.evidenceId)).toEqual(expect.arrayContaining([
      'doc:pdf-evidence-ledger-v1:p1:i0', 'doc:pdf-evidence-ledger-v1:p1:i1',
    ]));
    expect(selected.filter((item) => item.evidenceId.includes(':p1:'))).toHaveLength(2);
    expect(new Set(selected.map((item) => item.quote)).size).toBe(selected.length);
  });

  it('ranks joined passage prose, not its individually fragmented PDF.js members', () => {
    const source = ledger([
      candidate('doc:pdf-evidence-ledger-v1:p1:i0', 'We propose a frame-', 'Methods', 'method_overview'),
      candidate('doc:pdf-evidence-ledger-v1:p1:i1', 'work with training and inference stages for reliable decoding.', 'Methods', 'method_step'),
    ]);
    const passages = createEvidencePassages(source, { minimumChars: 1 });
    const ranked = rankPassagesForPurpose(createPassageRetrievalIndex(passages), 'method');
    expect(ranked[0].passage.text).toContain('framework with training');
    expect(ranked[0].passage.members).toHaveLength(2);
  });
});
