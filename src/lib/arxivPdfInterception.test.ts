import { describe, expect, it } from 'vitest';

import { isArxivDirectPdfUrl, readerUrlForArxivPdf } from './arxivPdfInterception';

describe('arXiv PDF interception gate', () => {
  it('accepts only HTTPS arxiv.org direct PDF routes', () => {
    expect(isArxivDirectPdfUrl('https://arxiv.org/pdf/2501.01234')).toBe(true);
    expect(isArxivDirectPdfUrl('https://arxiv.org/pdf/2501.01234v2.pdf?download=1')).toBe(true);
    expect(isArxivDirectPdfUrl('https://arxiv.org/pdf/hep-th/9901001')).toBe(true);
  });

  it('rejects HTML, landing, non-top-level-host and malformed routes', () => {
    expect(isArxivDirectPdfUrl('https://arxiv.org/html/2501.01234')).toBe(false);
    expect(isArxivDirectPdfUrl('https://arxiv.org/abs/2501.01234')).toBe(false);
    expect(isArxivDirectPdfUrl('https://export.arxiv.org/pdf/2501.01234')).toBe(false);
    expect(isArxivDirectPdfUrl('http://arxiv.org/pdf/2501.01234')).toBe(false);
    expect(isArxivDirectPdfUrl('https://arxiv.org/pdf/')).toBe(false);
  });

  it('keeps the original URL as a query value instead of redirecting back to it', () => {
    const result = readerUrlForArxivPdf('chrome-extension://example-id/', 'https://arxiv.org/pdf/2501.01234v2.pdf?x=1');
    const parsed = new URL(result);
    expect(parsed.pathname).toBe('/reader.html');
    expect(parsed.searchParams.get('arxivPdfUrl')).toBe('https://arxiv.org/pdf/2501.01234v2.pdf?x=1');
  });
});
