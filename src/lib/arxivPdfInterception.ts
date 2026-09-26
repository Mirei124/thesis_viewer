/**
 * The background page deliberately uses this small URL gate rather than trying
 * to infer a PDF from a file suffix anywhere on the web.  The reader still
 * checks the downloaded bytes before it opens a document.
 */
export const ARXIV_AUTO_OPEN_STORAGE_KEY = 'arxivPdfAutoOpenEnabled';

export function isArxivDirectPdfUrl(input: string): boolean {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return false;
  }

  // arXiv's direct download route is /pdf/<identifier>.  In particular this
  // excludes /abs, /html, export pages, and every non-arXiv host.
  return url.protocol === 'https:'
    && url.hostname === 'arxiv.org'
    && /^\/pdf\/[^/?#]+(?:\/[^/?#]+)?(?:\.pdf)?$/i.test(url.pathname);
}

export function readerUrlForArxivPdf(extensionBaseUrl: string, originalUrl: string): string {
  const readerUrl = new URL('reader.html', extensionBaseUrl);
  readerUrl.searchParams.set('arxivPdfUrl', originalUrl);
  return readerUrl.href;
}
