import { describe, expect, it, vi } from 'vitest';

import { replaceReaderSourceAddress } from './readerSourceAddress';
import { localPdfSourceKey } from './readerLocalSource';

describe('remote reader address', () => {
  const source = new URL('https://example.org/paper.pdf?download=1');
  const reader = 'chrome-extension://test/reader.html';

  it('omits page on the first page and writes page N without pushing history', () => {
    let href = reader;
    const replace = vi.fn((address: URL) => { href = address.href; });
    expect(replaceReaderSourceAddress(source, 0, href, replace)).toBe(true);
    expect(new URL(href).hash).toBe(`#pdf=${encodeURIComponent(source.href)}`);
    expect(replaceReaderSourceAddress(source, 1, href, replace)).toBe(true);
    expect(new URL(href).hash).toBe(`#pdf=${encodeURIComponent(source.href)}&page=2`);
    expect(replaceReaderSourceAddress(source, 0, href, replace)).toBe(true);
    expect(new URL(href).hash).toBe(`#pdf=${encodeURIComponent(source.href)}`);
    expect(replace).toHaveBeenCalledTimes(3);
  });

  it('does not write when a PDF source has not been identified', () => {
    const replace = vi.fn();
    expect(replaceReaderSourceAddress(null, 3, reader, replace)).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  it('writes and deduplicates a local key without a filename, URL, or fetchable source', () => {
    const key = localPdfSourceKey('b'.repeat(64));
    let href = reader;
    const replace = vi.fn((address: URL) => { href = address.href; });
    expect(replaceReaderSourceAddress(key, 0, href, replace)).toBe(true);
    expect(new URL(href).hash).toBe(`#pdf=${key}`);
    expect(replaceReaderSourceAddress(key, 1, href, replace)).toBe(true);
    expect(new URL(href).hash).toBe(`#pdf=${key}&page=2`);
    expect(replaceReaderSourceAddress(key, 1, href, replace)).toBe(false);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(replaceReaderSourceAddress('https://example.org/paper.pdf' as never, 0, href, replace)).toBe(false);
  });

  it('deduplicates repeated activity on the same page', () => {
    let href = reader;
    const replace = vi.fn((address: URL) => { href = address.href; });
    for (let activity = 0; activity < 5; activity += 1) {
      replaceReaderSourceAddress(source, 4, href, replace);
    }
    expect(replace).toHaveBeenCalledTimes(1);
    expect(new URL(href).hash.endsWith('&page=5')).toBe(true);
  });

  it('removes the legacy arXiv query even when the fragment already matches', () => {
    const hash = `#pdf=${encodeURIComponent(source.href)}`;
    const replace = vi.fn();
    expect(replaceReaderSourceAddress(source, 0, `${reader}?arxivPdfUrl=old${hash}`, replace)).toBe(true);
    expect(replace.mock.calls[0]?.[0].searchParams.has('arxivPdfUrl')).toBe(false);
  });
});
