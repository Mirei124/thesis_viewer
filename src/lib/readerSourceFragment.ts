import { isLocalPdfSourceKey, type LocalPdfSourceKey } from './readerLocalSource';

export type ReaderSourceFragment =
  | { kind: 'none' }
  | { kind: 'invalid'; message: string }
  | { kind: 'local'; key: LocalPdfSourceKey; pageIndex?: number }
  | { kind: 'pdf'; url: URL; pageIndex?: number };

/** A local key identifies bytes already imported here; it cannot reopen a File. */
export function parseReaderSourceFragment(hash: string): ReaderSourceFragment {
  if (!hash || hash === '#') return { kind: 'none' };
  const parts = hash.replace(/^#/, '').split('&');
  const values = new Map<string, string>();
  try {
    for (const part of parts) {
      const separator = part.indexOf('=');
      if (separator < 1) throw new Error('Invalid parameter');
      const key = part.slice(0, separator);
      if ((key !== 'pdf' && key !== 'page') || values.has(key)) throw new Error('Invalid parameter');
      values.set(key, decodeURIComponent(part.slice(separator + 1)));
    }
  } catch {
    return { kind: 'invalid', message: 'This reader link has an invalid PDF source fragment.' };
  }
  const source = values.get('pdf');
  if (!source) return { kind: 'invalid', message: 'This reader link needs an HTTPS PDF URL.' };
  const page = values.get('page');
  if (page !== undefined && (!/^[1-9]\d{0,2}$/.test(page) || Number(page) > 500)) {
    return { kind: 'invalid', message: 'This reader link has an invalid page number.' };
  }
  const pageIndex = page === undefined ? undefined : Number(page) - 1;
  if (isLocalPdfSourceKey(source)) return { kind: 'local', key: source, pageIndex };
  let url: URL;
  try { url = new URL(source); }
  catch { return { kind: 'invalid', message: 'This reader link needs a complete HTTPS PDF URL.' }; }
  if (url.protocol !== 'https:' || url.username || url.password) {
    return { kind: 'invalid', message: 'This reader link accepts only HTTPS PDF URLs without embedded credentials.' };
  }
  return { kind: 'pdf', url, pageIndex };
}

export function formatReaderSourceFragment(source: URL | LocalPdfSourceKey, pageIndex?: number): string {
  const value = source instanceof URL ? encodeURIComponent(source.href) : source;
  return `#pdf=${value}${pageIndex && pageIndex > 0 ? `&page=${pageIndex + 1}` : ''}`;
}
