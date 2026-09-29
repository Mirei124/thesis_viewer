import { describe, expect, it } from 'vitest';
import { formatReaderSourceFragment, parseReaderSourceFragment } from './readerSourceFragment';
import { localPdfSourceKey } from './readerLocalSource';

describe('shareable reader source', () => {
  it('round trips a remote URL containing its own query and fragment', () => {
    const source = new URL('https://example.org/paper.pdf?download=1&version=2#section');
    expect(parseReaderSourceFragment(formatReaderSourceFragment(source, 7))).toEqual({ kind: 'pdf', url: source, pageIndex: 7 });
  });

  it('rejects non-HTTPS, credentials, duplicate keys and invalid pages', () => {
    for (const hash of [
      '#pdf=http%3A%2F%2Fexample.org%2Fpaper.pdf',
      '#pdf=https%3A%2F%2Fu%3Ap%40example.org%2Fpaper.pdf',
      '#pdf=https%3A%2F%2Fexample.org%2Fpaper.pdf&pdf=https%3A%2F%2Fother.org%2Fpaper.pdf',
      '#pdf=https%3A%2F%2Fexample.org%2Fpaper.pdf&page=501',
      '#pdf=%bad',
    ]) expect(parseReaderSourceFragment(hash).kind).toBe('invalid');
  });

  it('has no remote source for an empty fragment', () => {
    expect(parseReaderSourceFragment('')).toEqual({ kind: 'none' });
  });

  it('round trips a local content key and page without turning it into a URL', () => {
    const key = localPdfSourceKey('a'.repeat(64));
    expect(formatReaderSourceFragment(key, 0)).toBe(`#pdf=${key}`);
    expect(parseReaderSourceFragment(formatReaderSourceFragment(key, 0))).toEqual({ kind: 'local', key, pageIndex: undefined });
    expect(formatReaderSourceFragment(key, 2)).toBe(`#pdf=${key}&page=3`);
    expect(parseReaderSourceFragment(formatReaderSourceFragment(key, 2))).toEqual({ kind: 'local', key, pageIndex: 2 });
    expect(parseReaderSourceFragment(`#pdf=${key}&page=501`).kind).toBe('invalid');
  });

  it('never treats malformed local keys or remote lookalikes as local content', () => {
    expect(parseReaderSourceFragment('#pdf=local-sha256-short').kind).toBe('invalid');
    expect(parseReaderSourceFragment('#pdf=https%3A%2F%2Fexample.org%2Fpaper.pdf').kind).toBe('pdf');
  });
});
