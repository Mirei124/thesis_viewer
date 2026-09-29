import { describe, expect, it } from 'vitest';

import { pdfLocalCitationIndexFromPages } from './pdfCitationIndex';
import { pageBlocksFromTextContent } from './pdfPageBlocks';

function page(pageIndex: number, texts: string[]) {
  return pageBlocksFromTextContent({
    items: texts.map((str) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 300, height: 12, hasEOL: false })),
    styles: {},
  } as never, pageIndex, 'doc');
}

describe('local numbered citation index', () => {
  it('groups continuation blocks across pages, stops at the next number, and keeps the first anchor', () => {
    const body = page(0, ['A prior result [20] is discussed here.']);
    const firstReferencePage = page(1, ['References', '[20] De-An']);
    const continuationPage = page(2, ['Deng et al. Complete paper title.', 'https://example.org/paper', '[21] Another work.', 'Its own continuation.']);
    const index = pdfLocalCitationIndexFromPages([body, firstReferencePage, continuationPage], 'doc');

    expect(index.references).toHaveLength(2);
    expect(index.references[0]).toMatchObject({
      number: 20,
      rawText: '[20] De-An Deng et al. Complete paper title. https://example.org/paper',
      sourceUrl: 'https://example.org/paper',
      anchor: firstReferencePage.blocks[1].anchor,
      sourceBlockId: firstReferencePage.blocks[1].blockId,
    });
    expect(index.references[0].rawText).not.toContain('[21]');
    expect(index.references[1].rawText).toBe('[21] Another work. Its own continuation.');
    expect(index.references[1].sourceUrl).toBeUndefined();
    expect(index.references[0].qualityWarnings).toEqual(['references-heading-is-heuristic', 'pdfjs-source-order-not-reading-order']);

    expect(index.occurrences).toHaveLength(1);
    expect(index.occurrences[0]).toMatchObject({
      displayMarker: '[20]',
      status: 'matched',
      rawStart: 15,
      rawEnd: 19,
      refIds: [index.references[0].refId],
    });
  });

  it('cuts at a marker-only next entry and does not treat pre-entry text as a reference', () => {
    const index = pdfLocalCitationIndexFromPages([
      page(0, ['See [1].', 'References', 'Editorial note before any number.', '[1] First entry', 'First tail', '[2]', 'Second tail']),
    ], 'doc');
    expect(index.references.map((reference) => reference.rawText)).toEqual([
      '[1] First entry First tail',
      '[2] Second tail',
    ]);
    expect(index.occurrences[0].status).toBe('matched');
  });

  it('does not infer reference entries without a References heading', () => {
    const index = pdfLocalCitationIndexFromPages([page(0, ['A claim [1].', '[1] Apparent entry.'])], 'doc');
    expect(index.references).toEqual([]);
    expect(index.occurrences.find((item) => item.displayMarker === '[1]')?.status).toBe('unresolved');
  });

  it('retains matched, ambiguous, and unresolved body marker decisions', () => {
    const index = pdfLocalCitationIndexFromPages([
      page(0, ['Compare [1], [2], and [3-4].', 'References', '[1] First.', '[1] Duplicate.', '[2] Second.']),
    ], 'doc');
    expect(index.occurrences.map(({ displayMarker, status }) => [displayMarker, status])).toEqual([
      ['[1]', 'ambiguous'],
      ['[2]', 'matched'],
      ['[3-4]', 'unresolved'],
    ]);
  });
});
