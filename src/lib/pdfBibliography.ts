import type { PDFDocumentProxy } from 'pdfjs-dist';
import { pageTitle } from './pdfTitle';

export type PdfBibliography = {
  authors?: string[];
  institutions?: string[];
  authorsSource?: 'metadata' | 'page';
  institutionsSource?: 'metadata' | 'page';
};
type TextItem = { str: string; transform: number[]; width?: number };
type Line = { text: string; y: number; size: number };
const institutionPattern = /\b(universit(?:y|ies|é|ät)|institute|institution|laborator(?:y|ies)|labs?|department|school of|college|academy|research cent(?:er|re)|research institute|microsoft|google|deepmind|openai|meta ai|nvidia|adobe|facebook ai|amazon|tencent|alibaba|bytedance|huawei|baidu)\b|大学|学院|研究院|研究所|实验室|實驗室|大學|研究中心/u;
const bodyStart = /^(?:abstract\b|summary\b|(?:1[.\s]+)?introduction\b|摘要|引言|关键词|keywords\b)/i;
const boilerplate = /@|https?:|www\.|arxiv|copyright|all rights reserved|equal contribution|corresponding author|work (?:was )?done|preprint|submitted|accepted|proceedings|conference|\bet al\b/i;
const invalidAuthor = /^(?:anonymous(?: authors?)?|authors?|unknown|none|null|n\/a|user|admin(?:istrator)?|untitled|microsoft(?: word)?|latex|overleaf|adobe|acrobat)$/i;
const clean = (value: string) => value.replace(/´([A-Za-z])/g, '$1\u0301').normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
const unique = (values: string[]) => [...new Set(values)].slice(0, 100);
function authorName(value: string, fromMetadata: boolean): string | undefined {
  const name = clean(value).replace(/^[\d\s*†‡§¶∗,#]+|[\d\s*†‡§¶∗,#]+$/g, '').trim();
  if (!name || name.length > 120 || invalidAuthor.test(name) || institutionPattern.test(name.toLowerCase()) || boilerplate.test(name)) return;
  if (!/^[\p{L}\p{M}\s.'’\-·]+$/u.test(name)) return;
  if (/^[\p{Script=Han}·]{2,12}$/u.test(name)) return name;
  const words = name.split(/\s+/);
  if (words.length < (fromMetadata ? 1 : 2) || words.length > 7) return;
  if (!fromMetadata && (!words.every((word) => /^[\p{Lu}\p{Lt}][\p{L}\p{M}.'’\-]*$/u.test(word) || /^(?:de|del|van|von|da|dos|di|el|al|der|den|la|le)$/i.test(word)))) return;
  if (/\b(?:learning|recognition|vision|model|approach|method|paper|network|attention|visual|image|language|intelligence|research|engineering|computer|science|technology|technical|report|project|team|group)\b/i.test(name)) return;
  return name;
}
/** Only explicit metadata separators are used; do not infer surname/given-name order. */
export function metadataAuthors(value: unknown): string[] {
  const entries = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  const names = entries.slice(0, 100).flatMap((entry) => typeof entry === 'string' && entry.length <= 12000
    ? entry.split(/\s*(?:;|\n|\band\b|&|、|，)\s*/).flatMap((part) => {
      const commaParts = part.split(/\s*,\s*/);
      if (commaParts.length === 2 && commaParts.every((name) => !!authorName(name, true)) && commaParts.some((name) => name.trim().split(/\s+/).length === 1)) {
        // Preserve an explicitly inverted name such as Doe, Jane, rather than two people.
        return [commaParts.map(clean).join(', ')];
      }
      return commaParts.map((name) => authorName(name, true)).filter((name): name is string => !!name);
    }) : []);
  return unique(names);
}
function linesFor(items: TextItem[], height: number): Line[] {
  const rows: { y: number; size: number; items: TextItem[] }[] = [];
  for (const item of items.slice(0, 12000)) {
    if (!item.str.trim() || item.transform.length < 6 || item.transform[5] < height * 0.35 || Math.abs(item.transform[1]) > 0.1 || Math.abs(item.transform[2]) > 0.1) continue;
    const y = item.transform[5], size = Math.abs(item.transform[3]);
    // Superscripts are affiliation markers, not names or independent lines.
    if (/^[\d\s*†‡§¶∗,]+$/.test(item.str.trim()) && size < 10) continue;
    const row = rows.find((candidate) => Math.abs(candidate.y - y) <= Math.min(3, Math.max(size, candidate.size) * 0.22));
    if (row) { row.items.push(item); row.size = Math.max(row.size, size); }
    else rows.push({ y, size, items: [item] });
  }
  return rows.sort((a, b) => b.y - a.y).map((row) => {
    const ordered = row.items.sort((a, b) => a.transform[4] - b.transform[4]);
    let text = '';
    ordered.forEach((item, index) => {
      const previous = ordered[index - 1];
      const gap = previous && typeof previous.width === 'number' ? item.transform[4] - previous.transform[4] - previous.width : 0;
      text += `${index ? gap > row.size * 0.8 ? ' ; ' : gap < row.size * 0.1 && typeof previous.width === 'number' ? '' : ' ' : ''}${item.str}`;
    });
    return { y: row.y, size: row.size, text: clean(text) };
  });
}
export function pageBibliography(items: TextItem[], height: number): PdfBibliography {
  if (!Number.isFinite(height) || height <= 0 || !pageTitle(items, height)) return {};
  const lines = linesFor(items, height);
  const top = lines.filter((line) => line.y > height * 0.65 && !boilerplate.test(line.text) && !institutionPattern.test(line.text.toLowerCase()));
  const titleSize = Math.max(...top.map((line) => line.size));
  const titleLines = top.filter((line) => line.size >= titleSize * 0.92);
  if (!titleLines.length) return {};
  const titleBottom = Math.min(...titleLines.map((line) => line.y));
  const block: Line[] = [];
  for (const line of lines) {
    if (line.y >= titleBottom - titleSize * 0.5) continue;
    if (bodyStart.test(line.text)) break;
    if (line.y < titleBottom - height * 0.3 || block.length >= 25) break;
    block.push(line);
  }
  const institutions: string[] = [];
  const authors: string[] = [];
  for (const line of block) {
    if (institutionPattern.test(line.text.toLowerCase()) && !boilerplate.test(line.text) && line.text.length <= 500) {
      institutions.push(...line.text.split(/\s*;\s*/).filter((part) => institutionPattern.test(part.toLowerCase())).map((part) => part.replace(/^[\d\s*†‡§¶∗,]+/, '').trim()));
      continue;
    }
    if (boilerplate.test(line.text) || line.text.length > 500) continue;
    const parts = line.text.split(/\s*(?:;|,|\band\b|&|、|，)\s*/).filter(Boolean);
    const names = parts.map((part) => authorName(part, false));
    // Reject prose as a whole rather than cherry-picking capitalized fragments.
    if (names.length && names.every((name) => !!name)) authors.push(...names as string[]);
  }
  return {
    ...(authors.length ? { authors: unique(authors), authorsSource: 'page' as const } : {}),
    ...(institutions.length ? { institutions: unique(institutions), institutionsSource: 'page' as const } : {}),
  };
}
export async function extractPdfBibliography(pdf: PDFDocumentProxy): Promise<PdfBibliography> {
  let authors: string[] = [];
  try {
    const metadata = await pdf.getMetadata();
    let creators: unknown;
    try { creators = metadata.metadata?.get('dc:creator'); } catch { /* malformed XMP does not prevent Info fallback */ }
    authors = metadataAuthors(creators);
    if (!authors.length) authors = metadataAuthors((metadata.info as { Author?: unknown })?.Author);
  } catch { /* metadata is optional */ }
  let pageData: PdfBibliography = {};
  try {
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const items = content.items.filter((item): item is Extract<typeof item, { str: string }> => 'str' in item);
    pageData = pageBibliography(items, page.view[3] - page.view[1]);
  } catch { /* bibliography failures must not prevent recording or reading */ }
  return { ...pageData, ...(authors.length ? { authors, authorsSource: 'metadata' as const } : {}) };
}
