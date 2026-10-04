import type { PageViewport, PDFDocumentProxy } from 'pdfjs-dist';

export type PdfLink = { id: string; rect: number[]; url?: string; dest?: string | unknown[] };

export function safePdfLinkUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch { /* Invalid annotations are ignored. */ }
}

export function pdfLinksFromAnnotations(annotations: unknown[]): PdfLink[] {
  return annotations.flatMap((value, index) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    if (item.subtype !== 'Link' || !Array.isArray(item.rect) || item.rect.length !== 4 || !item.rect.every((n) => typeof n === 'number' && Number.isFinite(n))) return [];
    const url = safePdfLinkUrl(item.url);
    const dest = typeof item.dest === 'string' || Array.isArray(item.dest) ? item.dest : undefined;
    if (!url && !dest) return [];
    return [{ id: typeof item.id === 'string' ? item.id : String(index), rect: item.rect as number[], url, dest }];
  });
}

export function pdfLinkBounds(rect: number[], viewport: Pick<PageViewport, 'convertToViewportPoint'>) {
  const [x1, y1] = viewport.convertToViewportPoint(rect[0], rect[1]);
  const [x2, y2] = viewport.convertToViewportPoint(rect[2], rect[3]);
  const bounds = { left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
  return Object.values(bounds).every(Number.isFinite) && bounds.width > 0 && bounds.height > 0 ? bounds : null;
}

export async function resolvePdfLinkDestination(pdf: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex' | 'numPages'>, dest: string | unknown[]) {
  const destination = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
  if (!Array.isArray(destination) || destination.length < 2) throw new Error('Invalid PDF destination');
  const target = destination[0];
  let pageIndex: number;
  if (typeof target === 'number') pageIndex = target;
  else if (target && typeof target === 'object' && 'num' in target && 'gen' in target && Number.isInteger(target.num) && Number.isInteger(target.gen)) pageIndex = await pdf.getPageIndex(target as { num: number; gen: number });
  else throw new Error('Invalid PDF destination page');
  if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pdf.numPages) throw new Error('PDF destination outside document');
  return { pageIndex, destination };
}

export function pdfDestinationPoint(destination: unknown[], viewport: Pick<PageViewport, 'convertToViewportPoint' | 'viewBox'>): number[] | null {
  const mode = (destination[1] as { name?: string } | undefined)?.name;
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
  const [left, , , top] = viewport.viewBox;
  if (mode === 'XYZ') return viewport.convertToViewportPoint(finite(destination[2]) ? destination[2] : left, finite(destination[3]) ? destination[3] : top);
  if (mode === 'FitH' || mode === 'FitBH') return viewport.convertToViewportPoint(left, finite(destination[2]) ? destination[2] : top);
  if (mode === 'FitV' || mode === 'FitBV') return viewport.convertToViewportPoint(finite(destination[2]) ? destination[2] : left, top);
  if (mode === 'FitR' && finite(destination[2]) && finite(destination[5])) return viewport.convertToViewportPoint(destination[2], destination[5]);
  return null;
}
