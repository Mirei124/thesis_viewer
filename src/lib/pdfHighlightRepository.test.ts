import { describe, expect, it } from 'vitest';
import { normalizePdfHighlightStyle } from './pdfHighlightRepository';

describe('PDF highlight style compatibility', () => {
  it('keeps legacy and unrecognized stored values as background highlights', () => {
    for (const value of [undefined, null, '', 'strike-through', 1, {}]) {
      expect(normalizePdfHighlightStyle(value)).toBe('highlight');
    }
  });

  it('restores the two supported annotation appearances', () => {
    expect(normalizePdfHighlightStyle('highlight')).toBe('highlight');
    expect(normalizePdfHighlightStyle('underline')).toBe('underline');
  });
});
