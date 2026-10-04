import { describe, expect, it } from 'vitest';
import { filenameTitle, pageTitle, usableMetadataTitle } from './pdfTitle';
const item = (str: string, size: number, y: number, x = 40) => ({ str, transform: [size, 0, 0, size, x, y] });
describe('local PDF title selection', () => {
  it('accepts real metadata and rejects common placeholders', () => { expect(usableMetadataTitle('  LoopVL:  Recurrent Visual Intelligence ')).toBe('LoopVL: Recurrent Visual Intelligence'); for (const title of ['Untitled', 'Microsoft Word - draft', 'document', 'file.pdf', '', 12]) expect(usableMetadataTitle(title)).toBeUndefined(); });
  it('conservatively joins prominent title lines and excludes rotated sidebar/abstract', () => { expect(pageTitle([item('A Useful Paper', 20, 750), item('About Visual Intelligence', 20, 725), item('Author Name', 12, 690), item('Abstract', 14, 650), { str: 'arXiv: 2609', transform: [0, 12, -12, 0, 10, 730] }], 800)).toBe('A Useful Paper About Visual Intelligence'); });
  it('rejects small prose and institution/author candidates', () => { expect(pageTitle([item('Body prose with enough words', 12, 740)], 800)).toBeUndefined(); expect(pageTitle([item('University of Somewhere', 20, 740)], 800)).toBeUndefined(); });
  it('uses safe decoded filename fallback', () => { expect(filenameTitle('A%20Paper.pdf')).toBe('A Paper'); expect(filenameTitle('%ZZ.pdf')).toBe('%ZZ'); });
});
