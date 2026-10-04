import type { PDFDocumentProxy } from 'pdfjs-dist';
export type PdfTitle = { title: string; titleSource: 'metadata' | 'page' | 'filename' };
export function usableMetadataTitle(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length < 3 || title.length > 500 || /^(untitled|document|microsoft word|pdf|arxiv|unknown|title)(\b|$)/i.test(title) || /\.pdf$/i.test(title)) return;
  return title;
}
export function filenameTitle(name: string): string { try { return decodeURIComponent(name).replace(/\.pdf$/i, '') || name; } catch { return name.replace(/\.pdf$/i, '') || name; } }
export function pageTitle(items: { str: string; transform: number[] }[], height: number): string | undefined {
  const candidates = items.filter((item) => item.str.trim().length > 1 && item.transform[5] > height * 0.65 && Math.abs(item.transform[1]) < 0.1 && Math.abs(item.transform[2]) < 0.1 && !/^(arxiv|abstract|submitted|published|proceedings|copyright|https?:|\d+$)/i.test(item.str.trim()));
  const maxSize = Math.max(...candidates.map((item) => Math.abs(item.transform[3])));
  if (maxSize < 14) return;
  const large = candidates.filter((item) => Math.abs(item.transform[3]) >= maxSize * 0.92).sort((a, b) => b.transform[5] - a.transform[5] || a.transform[4] - b.transform[4]);
  if (!large.length || large.length > 15 || large.some((item) => /@|\b(university|institute|department)\b/i.test(item.str))) return;
  if (large[0].transform[5] - large[large.length - 1].transform[5] > maxSize * 5) return;
  const title = large.map((item) => item.str.trim()).join(' ').replace(/\s+/g, ' ');
  if (title.length < 15 || title.length > 350 || title.split(/\s+/).length < 3) return;
  return title;
}
export async function extractPdfTitle(pdf: PDFDocumentProxy, name: string): Promise<PdfTitle> {
  try { const metadata = await pdf.getMetadata(); const title = usableMetadataTitle((metadata.info as { Title?: unknown })?.Title); if (title) return { title, titleSource: 'metadata' }; } catch { /* title failures never block reading */ }
  try { const page = await pdf.getPage(1); const text = await page.getTextContent(); const items = text.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item); const title = pageTitle(items, page.view[3] - page.view[1]); if (title) return { title, titleSource: 'page' }; } catch { /* fallback */ }
  return { title: filenameTitle(name), titleSource: 'filename' };
}
