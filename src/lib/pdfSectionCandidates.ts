import type { PageExtraction, PdfPageAnchor, PdfPageTextBlock } from './pdfPageBlocks';

/**
 * These are intentionally candidates, rather than a reconstructed document
 * outline. PDF text items do not establish reading order, so the detector only
 * accepts a short individual item with a strong numbering or type-size signal.
 */
export const PDF_SECTION_CANDIDATE_VERSION = 'pdf-section-candidates-v3';

export type PdfSectionCandidate = {
  candidateId: string;
  title: string;
  pageIndex: number;
  anchor: PdfPageAnchor;
  confidence: 'high' | 'low';
  signals: Array<'numbered-title' | 'large-type' | 'all-caps-title'>;
  caution: 'Automatic candidate only; multi-column pages, tables, and formulas can produce false headings.';
};

const numberedTitle = /^(?:(?:\d+(?:\.\d+){0,5}\.?)|(?:[IVXLCDM]{1,8}\.)|(?:[A-Z]\.)|(?:Appendix\s+[A-Z0-9]+\.?))\s+\S/i;
const allCapsTitle = /^[A-Z][A-Z0-9&/,:;()\-–— ]{3,90}$/;

function fontSize(block: PdfPageTextBlock): number {
  const [a, b, c, d] = block.rawTransform;
  return Math.max(Math.hypot(a, b), Math.hypot(c, d));
}

function normalizedTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isTitleLength(title: string): boolean {
  if (title.length < 3 || title.length > 120) return false;
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 16) return false;
  // Sentences, figure captions, and most table prose have terminal punctuation.
  return !/[.!?。！？]$/.test(title);
}

function isBodyLineDisguisedAsTitle(title: string): boolean {
  const withoutNumber = title.replace(/^\d+(?:\.\d+)*\.?\s+/, '');
  // Decimal measurements and model names often start a PDF.js line. Their
  // numeric prefix alone must not turn the line into a section boundary.
  if (/^(?:\[|[a-z]|\d)/.test(withoutNumber)) return true;
  if (/^(?:fig(?:ure)?|table|tab\.)\s*\d+\b/i.test(withoutNumber)) return true;
  if (/\b(?:achieves|attains|outperforms|improves|declines|increases|decreases|evaluates|compares|includes|provides|shows|consists)\b/.test(withoutNumber)) return true;
  if (/[;,]$|[-–]$|\[[0-9]+\]/.test(title)) return true;
  return false;
}

function isTitleCaseHeading(title: string): boolean {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length === 1) return /^(?:Abstract|Introduction|Background|Methods?|Approach|Experiments?|Evaluation|Results?|Discussion|Conclusion|Limitations|References|Acknowledgments?)$/i.test(title);
  if (words.length < 2 || words.length > 8) return false;
  const minor = /^(?:a|an|and|as|at|by|for|from|in|of|on|or|the|to|with)$/i;
  return words.every((word, index) => minor.test(word) && index > 0 || /^[A-Z][\w-]*$/.test(word));
}

function pageMedianFontSize(page: PageExtraction): number {
  const sizes = page.blocks
    .map(fontSize)
    .filter((size) => Number.isFinite(size) && size > 0)
    .sort((left, right) => left - right);
  if (sizes.length === 0) return 0;
  return sizes[Math.floor(sizes.length / 2)];
}

function isContentsPage(page: PageExtraction): boolean {
  // A contents heading is reliable only near the beginning of its own page.
  // Looking through the entire page would reject an ordinary section that
  // merely mentions a table of contents in its prose.
  const openingText = page.blocks
    .slice(0, 16)
    .map((block) => block.rawText)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
  return /\b(?:table\s+of\s+)?contents\b/i.test(openingText);
}

function candidateStrength(candidate: PdfSectionCandidate): number {
  return candidate.signals.reduce((strength, signal) => strength + (signal === 'numbered-title' ? 2 : signal === 'large-type' ? 2 : 1), 0);
}

/**
 * Returns only deliberately conservative individual PDF text-item headings.
 * It does not merge items into lines because that would silently impose an
 * order on two-column pages. Consumers must describe these as automatic.
 */
export function pdfSectionCandidatesFromPages(
  pages: PageExtraction[],
  documentVersion: string,
): PdfSectionCandidate[] {
  const candidates: PdfSectionCandidate[] = [];

  for (const page of pages) {
    // Contents entries are often formatted exactly like section headings but
    // navigate to the contents page. Exclude the whole page only when its
    // opening items explicitly identify it as Contents.
    if (isContentsPage(page)) continue;
    const median = pageMedianFontSize(page);
    for (const block of page.blocks) {
      if (block.qualityFlags.includes('non-axis-aligned-transform')) continue;
      const title = normalizedTitle(block.rawText);
      if (!isTitleLength(title)) continue;
      if (isBodyLineDisguisedAsTitle(title)) continue;
      // Author names on the title page can be larger than body text and all
      // caps. Once accepted, they would label the entire paper until the next
      // detected heading, so require a recognisable heading word there.
      if (page.pageIndex === 0 && /^[A-Z]+(?:\s+[A-Z]+){1,3}$/.test(title)
        && !/\b(?:ABSTRACT|INTRODUCTION|BACKGROUND|METHODS?|MODEL|ARCHITECTURE|DATA|RESULTS?|EVALUATION|DISCUSSION|CONCLUSION|LIMITATIONS?|CONTRIBUTIONS?)\b/.test(title)) continue;

      const signals: PdfSectionCandidate['signals'] = [];
      if (numberedTitle.test(title)) signals.push('numbered-title');
      if (allCapsTitle.test(title)) signals.push('all-caps-title');
      if (median > 0 && fontSize(block) >= median * 1.25) signals.push('large-type');

      // Typography alone is weak unless it looks like a title. Numbered
      // headings are accepted even where an embedded font obscures size.
      const looksLikeTitle = signals.includes('numbered-title')
        || (signals.includes('large-type') && (signals.includes('all-caps-title') || isTitleCaseHeading(title)));
      if (!looksLikeTitle) continue;

      candidates.push({
        candidateId: `${documentVersion}:${PDF_SECTION_CANDIDATE_VERSION}:p${page.pageIndex}:i${block.sourceOrder}`,
        title,
        pageIndex: page.pageIndex,
        anchor: block.anchor,
        confidence: signals.includes('numbered-title') && signals.includes('large-type') ? 'high' : 'low',
        signals,
        caution: 'Automatic candidate only; multi-column pages, tables, and formulas can produce false headings.',
      });
    }
  }

  // Deduplicate after excluding contents pages. When a title still appears
  // twice, choose the stronger type/numbering evidence; ties prefer the later
  // occurrence, which keeps a subsequent body heading over an earlier front
  // matter copy. This deliberately does not depend on first-seen order.
  const bestByTitle = new Map<string, PdfSectionCandidate>();
  for (const candidate of candidates) {
    const key = candidate.title.toLocaleLowerCase();
    const previous = bestByTitle.get(key);
    if (!previous || candidateStrength(candidate) > candidateStrength(previous)
      || (candidateStrength(candidate) === candidateStrength(previous) && candidate.pageIndex > previous.pageIndex)) {
      bestByTitle.set(key, candidate);
    }
  }
  return Array.from(bestByTitle.values()).sort((left, right) => left.pageIndex - right.pageIndex || left.candidateId.localeCompare(right.candidateId));
}
