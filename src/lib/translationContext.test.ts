import { describe, expect, it } from 'vitest';

import { pageBlocksFromTextContent } from './pdfPageBlocks';
import { translationSourceForSelection } from './translationContext';

function page(text: string) {
  return pageBlocksFromTextContent({ items: [{ str: text, transform: [1, 0, 0, 1, 0, 0], width: 300, height: 12, hasEOL: false }], styles: {} } as never, 0, 'sha256:test');
}

describe('translationSourceForSelection', () => {
  it('expands only inside one clean text item and supplies immediate sentence neighbors', () => {
    expect(translationSourceForSelection(page('Before context. The selected words are here. After context.'), 'selected words')).toEqual({
      text: 'The selected words are here.',
      neighborContext: 'Before context.\nAfter context.',
      expanded: true,
    });
  });

  it('keeps the original selection when matching or sentence boundaries are unreliable', () => {
    expect(translationSourceForSelection(page('Repeat. Repeat.'), 'Repeat.')).toMatchObject({ text: 'Repeat.', neighborContext: '', expanded: false });
    expect(translationSourceForSelection(undefined, 'Only selection')).toMatchObject({ text: 'Only selection', neighborContext: '', expanded: false });
  });
});
