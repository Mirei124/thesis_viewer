/**
 * URL import deliberately accepts a response only when its bytes carry a PDF
 * header. Neither a URL suffix nor a Content-Type header is sufficient: both
 * are commonly misleading for sign-in and paper landing pages.
 */
export type UrlPdfResponseKind = 'pdf' | 'html' | 'not-pdf';

export function isPdfSignature(bytes: Uint8Array): boolean {
  return bytes.length >= 5
    && bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
    && bytes[4] === 0x2d;
}

export function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 512)).trimStart().toLowerCase();
  return prefix.startsWith('<!doctype html')
    || prefix.startsWith('<html')
    || prefix.startsWith('<head')
    || prefix.startsWith('<body');
}

export function classifyUrlPdfResponse(bytes: Uint8Array): UrlPdfResponseKind {
  if (isPdfSignature(bytes)) return 'pdf';
  return looksLikeHtml(bytes) ? 'html' : 'not-pdf';
}

export function urlPdfRejectionMessage(kind: Exclude<UrlPdfResponseKind, 'pdf'>): string {
  return kind === 'html'
    ? 'The URL returned HTML instead of a PDF, often a sign-in or landing page. Download the PDF and choose it locally instead.'
    : 'The downloaded response is not a PDF. Download the PDF and choose it locally instead.';
}

export function permissionPattern(url: URL): string {
  // WebExtension host permissions are scoped to a scheme and host. Ports are
  // not expressible in a match pattern, so the browser applies this to HTTPS on
  // the submitted host; the request itself still uses the exact submitted URL.
  return `${url.protocol}//${url.hostname}/*`;
}
