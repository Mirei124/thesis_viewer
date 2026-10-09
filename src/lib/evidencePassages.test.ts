import { describe, expect, it } from 'vitest';
import { createEvidencePassages } from './evidencePassages';
import type { EvidenceCandidate, EvidenceLedger } from './evidenceLedger';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { createPassageRetrievalIndex, selectRankedPassagesForPurpose } from './retrievalIndex';
import { appendProgressiveEvidenceStage, createProgressiveEvidenceSession, resolveProgressiveEvidenceAliases } from './evidencePacket';

function candidate(page: number, sourceOrder: number, quote: string, section = '2 Methods'): EvidenceCandidate {
  return {
    evidenceId: `doc:pdf-evidence-ledger-v1:p${page}:i${sourceOrder}`,
    blockId: `doc:p${page}:i${sourceOrder}`, quote, normalizedStart: 0, normalizedEnd: quote.length,
    slot: 'method_overview', precision: 'block', section: { title: section, confidence: 'automatic' }, coverage: 'full-text',
    qualityWarnings: ['pdfjs-source-order-not-reading-order', 'section-derived-slot-not-semantic-verification', 'section-is-automatic-candidate'],
  };
}

function ledger(candidates: EvidenceCandidate[]): EvidenceLedger {
  return { version: 'pdf-evidence-ledger-v1', documentVersion: 'doc', coverage: 'full-text', candidates, excluded: { referencesBlockCount: 0, unreliableBlockCount: 0, emptyBlockCount: 0 }, diagnostics: [] };
}

function positionedPages(entries: Array<{ candidate: EvidenceCandidate; x: number; y: number }>): PageExtraction[] {
  const grouped = new Map<number, PdfPageTextBlock[]>();
  for (const { candidate: source, x, y } of entries) {
    const match = /:p(\d+):i(\d+)$/.exec(source.evidenceId)!;
    const pageIndex = Number(match[1]);
    const normalized = normalizePdfTextItem(source.quote);
    const block: PdfPageTextBlock = { blockId: source.blockId, documentVersion: 'doc', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder: Number(match[2]),
      rawText: source.quote, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
      rawTransform: [10, 0, 0, 10, x, y], rawWidth: source.quote.length * 5, rawHeight: 10, hasEol: false,
      anchor: { pageIndex, quote: source.quote, rects: [{ x, y, width: source.quote.length * 5, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
      qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags] };
    grouped.set(pageIndex, [...(grouped.get(pageIndex) ?? []), block]);
  }
  return [...grouped].map(([pageIndex, blocks]) => ({ pageIndex, blocks, searchableText: blocks.map((item) => item.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' }));
}

describe('local evidence passages', () => {
  it('admits a numbered allocation formula only from adjacent, anchored PDF text items', () => {
    const tokens = ['M', 'opt', '(', 'C', ')', '∝', 'C', 'a', ',', 'D', 'opt', '(', 'C', ')', '∝', 'C', 'b', '(2)'];
    const entries = [
      { candidate: candidate(1, 0, 'Across budgets, these optima follow the compute-optimal allocation law:', 'Scaling Laws'), x: 108, y: 149 },
      ...tokens.map((quote, index) => ({ candidate: candidate(1, index + 1, quote, 'Scaling Laws'), x: 190 + index * 14, y: 129 })),
    ];
    const source = ledger(entries.map((entry) => entry.candidate));
    const pages = positionedPages(entries);
    const row = pages[0].blocks;
    for (const index of [2, 8, 11, 17]) {
      row[index].rawTransform = [7, 0, 0, 7, row[index].rawTransform[4], index === 8 || index === 17 ? 133 : 127];
    }
    const equation = createEvidencePassages(source, { pages }).passages.find((passage) => passage.passageId.includes(':equation:'));
    expect(equation?.text).toContain('M_{opt}(');
    expect(equation?.text).toContain('C^{a}');
    expect(equation?.text).toContain('D_{opt}(');
    expect(equation?.text).toContain('C^{b}');
    expect(equation?.text.match(/\\propto/g)).toHaveLength(2);
    expect(createEvidencePassages(source, { pages, targetChars: 60, maxChars: 80 }).passages.some((passage) => passage.passageId.includes(':equation:'))).toBe(false);
    const session = createProgressiveEvidenceSession(source);
    appendProgressiveEvidenceStage(session, 'problem_motivation', { orderedPassages: [] });
    const packet = appendProgressiveEvidenceStage(session, 'method', { orderedPassages: [equation!] });
    expect(resolveProgressiveEvidenceAliases(session, [packet.sources[0].alias], source, pages)).toHaveLength(tokens.length + 1);
  });
  it('joins only geometrically aligned inline exponents into verifiable experimental packet sources', () => {
    const entries: Array<{ candidate: EvidenceCandidate; x: number; y: number }> = [];
    const addLine = (page: number, start: number, y: number, quotes: string[], startX = 100) => {
      let x = startX;
      quotes.forEach((quote, offset) => {
        const source = candidate(page, start + offset, quote, '3 Results');
        entries.push({ candidate: source, x, y });
        x += quote.length * 5 + 2;
      });
    };
    addLine(3, 10, 500, ['however, removing the encoder increases a from', '0', '.', '464']);
    addLine(3, 14, 489, ['to', '0', '.', '570', ', shifting compute-optimal training toward larger models.']);
    addLine(4, 20, 480, ['The fitted loss decreases faster, and the predicted crossover is on the order of', '10']);
    entries.push({ candidate: candidate(4, 22, '22', '3 Results'), x: entries.at(-1)!.x + 12, y: 483.5 });
    entries.push({ candidate: candidate(4, 23, 'FLOPs under compute-optimal allocation.', '3 Results'), x: entries.at(-1)!.x + 12, y: 480 });
    const source = ledger(entries.map((item) => item.candidate));
    const pages = positionedPages(entries);
    const passages = createEvidencePassages(source, { targetChars: 520, maxChars: 1500, pages });
    const session = createProgressiveEvidenceSession(source, { maxExcerptChars: 1500 });
    for (const stage of ['problem_motivation', 'method', 'contributions_novelty'] as const) appendProgressiveEvidenceStage(session, stage, { orderedPassages: [] });
    const ordered = selectRankedPassagesForPurpose(createPassageRetrievalIndex(passages), 'experiments_ablations', { maxCandidates: 24, maxCandidatesPerPage: 2 });
    const packet = appendProgressiveEvidenceStage(session, 'experiments_ablations', { orderedPassages: ordered });
    const visible = packet.sources.map((item) => item.excerpt).join(' ');
    expect(visible).toContain('from 0.464 to 0.570');
    expect(visible).toContain('10^22 FLOPs under compute-optimal allocation');
    for (const item of packet.sources) expect(resolveProgressiveEvidenceAliases(session, [item.alias], source, pages).length).toBeGreaterThan(1);
  });

  it('does not join numeric chart ticks across a column, page or section', () => {
    const left = candidate(0, 1, 'The extrapolated crossover is on the order of', 'Results');
    const far = candidate(0, 2, '10', 'Results');
    const exponent = candidate(0, 3, '22', 'Results');
    const nextPage = candidate(1, 4, 'FLOPs under compute-optimal allocation.', 'Results');
    const otherSection = candidate(1, 5, '10', 'Appendix');
    const entries = [
      { candidate: left, x: 100, y: 500 }, { candidate: far, x: 420, y: 500 },
      { candidate: exponent, x: 432, y: 503.5 }, { candidate: nextPage, x: 100, y: 490 },
      { candidate: otherSection, x: 300, y: 490 },
    ];
    const passages = createEvidencePassages(ledger(entries.map((item) => item.candidate)), { pages: positionedPages(entries) }).passages;
    expect(passages.map((item) => item.text).join(' ')).not.toContain('10^22');
    expect(passages.every((item) => item.members.every((member) => Number(/:p(\d+):/.exec(member.candidate.evidenceId)![1]) === item.pageIndex))).toBe(true);
  });
  it('keeps an inline PDF.js abbreviation inside a prompt-encoding step and its original member anchors', () => {
    const fragments = [
      'We represent',
      'points and boxes by positional encodings [95] summed with',
      'learned embeddings for each prompt type and free-form text',
      'with an off-the-shelf text encoder from CLIP [82]. Dense',
      'prompts (',
      'i.e',
      '., masks) are embedded using convolutions and',
      'summed element-wise with the image embedding.',
    ].map((quote, index) => candidate(4, 63 + index, quote, '3. Segment Anything Model'));
    const result = createEvidencePassages(ledger([
      ...fragments,
      candidate(4, 71, 'This is a separate section with a sufficiently long method explanation.', '4. Data Engine'),
      candidate(5, 72, 'This is another sufficiently long method sentence on the following page.', '3. Segment Anything Model'),
    ]), { targetChars: 520, maxChars: 1500 });
    const prompt = result.passages.find((passage) => passage.text.startsWith('We represent'))!;
    expect(prompt.text).toContain('points and boxes by positional encodings');
    expect(prompt.text).toContain('Dense prompts (i.e., masks) are embedded using convolutions and summed element-wise with the image embedding.');
    expect(prompt.members.map((member) => member.candidate.evidenceId)).toEqual(fragments.map((item) => item.evidenceId));
    expect(prompt.text).not.toContain('separate section');
    expect(prompt.text).not.toContain('following page');
  });
  it('keeps a numbered feature list with its lead across one empty PDF.js item without crossing a section', () => {
    const result = createEvidencePassages(ledger([
      candidate(0, 0, 'Our work differs from existing systems through two key features:', 'Introduction'),
      candidate(0, 2, '1) A representation with explicit input parameters;', 'Introduction'),
      candidate(0, 4, '2) A rendering method with controlled output quality.', 'Introduction'),
      candidate(0, 5, 'Experiments compare the approach on held-out data.', 'Experiments'),
    ]), { targetChars: 60, maxChars: 320 });
    expect(result.passages[0].text).toContain('two key features: 1)');
    expect(result.passages[0].text).toContain('2) A rendering method');
    expect(result.passages[0].members.map((item) => item.candidate.evidenceId)).toEqual([
      'doc:pdf-evidence-ledger-v1:p0:i0', 'doc:pdf-evidence-ledger-v1:p0:i2', 'doc:pdf-evidence-ledger-v1:p0:i4',
    ]);
    expect(result.passages[0].text).not.toContain('Experiments compare');
  });

  it('joins adjacent same-section items and repairs only a safe line-break hyphen', () => {
    const result = createEvidencePassages(ledger([
      candidate(0, 3, 'Our frame-'), candidate(0, 4, 'work uses a learned encoder and a calibrated objective.'),
    ]));
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].text).toBe('Our framework uses a learned encoder and a calibrated objective.');
    expect(result.passages[0].members.map((member) => member.candidate.quote)).toEqual(['Our frame-', 'work uses a learned encoder and a calibrated objective.']);
  });

  it('waits past the target length to finish a split annotation sentence within the hard cap', () => {
    const fragments = [
      candidate(3, 47, 'Following collection, each annotator carefully views the full video and creates three relevant questions, each accompa-', 'Dataset Construction'),
      candidate(3, 48, 'nied by four candidate options, contributing to a total of 2,700 QA pairs.', 'Dataset Construction'),
      candidate(4, 49, 'This is a separate complete sentence on the next page.', 'Dataset Construction'),
    ];
    const result = createEvidencePassages(ledger(fragments), { targetChars: 80, maxChars: 1500 });
    expect(result.passages[0].text).toContain('three relevant questions, each accompanied by four candidate options, contributing to a total of 2,700 QA pairs.');
    expect(result.passages[0].members.map((member) => member.candidate.evidenceId)).toEqual(fragments.slice(0, 2).map((item) => item.evidenceId));
    expect(result.passages[0].text).not.toContain('next page');
  });

  it('never joins across a page, section, or a missing source-order item', () => {
    const result = createEvidencePassages(ledger([
      candidate(0, 1, 'This is a sufficiently long method description with an encoder and an objective.'),
      candidate(0, 3, 'This separately long text cannot bridge an absent PDF text item.'),
      candidate(1, 4, 'This separately long text cannot cross a PDF page boundary.'),
      candidate(1, 5, 'This separately long text belongs to another section and remains separate.', '3 Experiments'),
    ]));
    expect(result.passages).toHaveLength(4);
    expect(result.passages.every((passage) => passage.members.length === 1)).toBe(true);
  });

  it('keeps every original candidate rather than manufacturing a stitched quote', () => {
    const left = candidate(2, 1, 'We first encode each input with the shared backbone.');
    const right = candidate(2, 2, 'We then optimize the decoder with a reconstruction loss.');
    const result = createEvidencePassages(ledger([left, right]));
    const passage = result.passages[0];
    expect(passage.members.map((member) => member.candidate)).toEqual([left, right]);
    expect(passage.members.map((member) => member.candidate.evidenceId)).toEqual([left.evidenceId, right.evidenceId]);
    expect(passage.text).not.toBe(left.quote);
  });

  it('drops isolated fragments but preserves a substantial standalone sentence', () => {
    const result = createEvidencePassages(ledger([
      candidate(0, 1, 'the proposed method'),
      candidate(0, 4, 'Our approach uses a learned encoder to represent each document before calibrated decoding.'),
    ]));
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].text).toContain('Our approach');
    expect(result.diagnostics.join(' ')).toContain('isolated');
  });

  it('is deterministic and bounds a long local passage without crossing its member mapping', () => {
    const items = [
      candidate(4, 1, 'A '.repeat(80)), candidate(4, 2, 'B '.repeat(80)), candidate(4, 3, 'C '.repeat(80)),
    ];
    const first = createEvidencePassages(ledger(items), { targetChars: 80, maxChars: 120, minimumChars: 20 });
    const second = createEvidencePassages(ledger(items), { targetChars: 80, maxChars: 120, minimumChars: 20 });
    expect(first).toEqual(second);
    expect(first.passages.every((passage) => Array.from(passage.text).length <= 120)).toBe(true);
    expect(first.passages.flatMap((passage) => passage.members).map((member) => member.candidate.evidenceId)).toEqual(items.map((item) => item.evidenceId));
  });

  it('starts a fresh passage from the current source after a length split', () => {
    const items = [
      candidate(2, 1, 'We initialize the representation from sparse observations and optimize its parameters.'),
      candidate(2, 2, 'We refine the representation with a second objective and keep each source anchor independent.'),
      candidate(2, 3, 'We decode the optimized representation for efficient inference on held-out observations.'),
    ];
    const result = createEvidencePassages(ledger(items), { targetChars: 80, maxChars: 120 });
    expect(result.passages.map((passage) => passage.text)).toEqual(items.map((item) => item.quote));
    expect(result.passages.flatMap((passage) => passage.members.map((member) => member.candidate.evidenceId)))
      .toEqual(items.map((item) => item.evidenceId));
  });
});
