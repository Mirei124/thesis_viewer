import { describe, expect, it } from 'vitest';
import { limitedMathParts } from './limitedMath';
import { inlineEvidenceParts } from './inlineEvidence';

describe('limited math parsing', () => {
  it('recognizes inline and display delimiters without interpreting ordinary HTML', () => {
    expect(limitedMathParts('A $x_i$ B $$C = MD$$ <img src=x> \\(a+b\\) \\[z^2\\]')).toEqual([
      { kind: 'text', value: 'A ' },
      { kind: 'math', value: 'x_i', source: '$x_i$', display: false },
      { kind: 'text', value: ' B ' },
      { kind: 'math', value: 'C = MD', source: '$$C = MD$$', display: true },
      { kind: 'text', value: ' <img src=x> ' },
      { kind: 'math', value: 'a+b', source: '\\(a+b\\)', display: false },
      { kind: 'text', value: ' ' },
      { kind: 'math', value: 'z^2', source: '\\[z^2\\]', display: true },
    ]);
  });

  it('keeps incomplete, escaped, empty, and oversized expressions as original text', () => {
    for (const raw of ['unclosed $x', '\\$x', '\\(\\)', `$${'x'.repeat(2001)}$`]) {
      expect(limitedMathParts(raw)).toEqual([{ kind: 'text', value: raw }]);
    }
  });

  it('keeps a verified alias linked once when math is parsed after citations', () => {
    const refs = [{ alias: 'E001', evidenceIds: ['original'] }];
    const parts = inlineEvidenceParts('关系 $C=MD$ [E001]。', refs);
    expect(parts.filter((part) => part.kind === 'source')).toHaveLength(1);
    expect(parts.filter((part) => part.kind === 'text').flatMap((part) => limitedMathParts(part.value))
      .filter((part) => part.kind === 'math')).toEqual([{ kind: 'math', value: 'C=MD', source: '$C=MD$', display: false }]);
  });
});
