import { formatReaderSourceFragment } from './readerSourceFragment';
import { isLocalPdfSourceKey, type LocalPdfSourceKey } from './readerLocalSource';

/** Replace a verified remote URL or local content key; never add browser history. */
export function replaceReaderSourceAddress(
  source: URL | LocalPdfSourceKey | null,
  pageIndex: number,
  currentHref: string,
  replace: (address: URL) => void,
): boolean {
  if (!source || (typeof source === 'string' && !isLocalPdfSourceKey(source))) return false;
  const address = new URL(currentHref);
  const fragment = formatReaderSourceFragment(source, pageIndex);
  if (address.hash === fragment && !address.searchParams.has('arxivPdfUrl')) return false;
  address.searchParams.delete('arxivPdfUrl');
  address.hash = fragment;
  replace(address);
  return true;
}
