import { describe, expect, it } from 'vitest';
import { createEvidencePassages } from './evidencePassages';
import type { EvidenceCandidate, EvidenceLedger } from './evidenceLedger';

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

describe('local evidence passages', () => {
  it('joins adjacent same-section items and repairs only a safe line-break hyphen', () => {
    const result = createEvidencePassages(ledger([
      candidate(0, 3, 'Our frame-'), candidate(0, 4, 'work uses a learned encoder and a calibrated objective.'),
    ]));
    expect(result.passages).toHaveLength(1);
    expect(result.passages[0].text).toBe('Our framework uses a learned encoder and a calibrated objective.');
    expect(result.passages[0].members.map((member) => member.candidate.quote)).toEqual(['Our frame-', 'work uses a learned encoder and a calibrated objective.']);
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
});
