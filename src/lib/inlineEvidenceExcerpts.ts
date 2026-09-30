import { locateEvidenceCandidate, type EvidenceCandidate, type EvidenceLocation } from './evidenceLedger';
import type { PageExtraction, PdfPageTextBlock } from './pdfPageBlocks';

export type InlineExcerptMember = {
  evidenceId: string;
  index: number;
  quote: string;
  displayQuote: string;
  location?: EvidenceLocation;
  separatorBefore: string;
};
export type InlineExcerptGroup = { members: InlineExcerptMember[] };

type PositionedMember = InlineExcerptMember & { candidate?: EvidenceCandidate; block?: PdfPageTextBlock; pageMidpoint?: number };

/** Geometry is used only to decide whether two already verified quotes may read continuously. */
function continuous(previous: PositionedMember, current: PositionedMember): boolean {
  const left = previous.block;
  const right = current.block;
  const a = left?.anchor.rects[0];
  const b = right?.anchor.rects[0];
  if (!a || !b || !left || !right || !previous.candidate || !current.candidate) return false;
  if (!previous.location?.anchor || !current.location?.anchor) return false;
  if (previous.location.qualityWarnings.includes('quote-fallback-used') || current.location.qualityWarnings.includes('quote-fallback-used')) return false;
  if (left.pageIndex !== right.pageIndex || right.sourceOrder !== left.sourceOrder + 1) return false;
  if (previous.candidate.section.title !== current.candidate.section.title) return false;
  if (left.qualityFlags.includes('non-axis-aligned-transform') || right.qualityFlags.includes('non-axis-aligned-transform')) return false;
  const height = Math.max(a.height, b.height);
  if (!(height > 0) || Math.abs(a.height - b.height) > height * 0.45) return false;
  const rowDifference = a.y - b.y;
  const sameRow = Math.abs(rowDifference) <= height * 0.45;
  if (sameRow) {
    const gap = b.x - (a.x + a.width);
    return gap >= -height * 0.5 && gap <= height * 2;
  }
  // A wrapped line descends in PDF coordinates and returns to the same text column.
  // Requiring horizontal overlap avoids treating a jump into the next column as prose.
  const overlaps = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  // A line can begin after a displayed equation and wrap back to its column
  // margin. The fragments need not overlap horizontally, but must remain on
  // the same side of the page and within one line width of each other.
  const midpoint = previous.pageMidpoint;
  const sameColumnSide = midpoint !== undefined && current.pageMidpoint === midpoint
    && (a.x >= midpoint) === (b.x >= midpoint);
  const wrappedFromIndentedLine = sameColumnSide
    && Math.abs(a.x - b.x) <= Math.max(a.width, b.width) + height * 2;
  return rowDifference > height * 0.55 && rowDifference <= height * 2.2
    && b.x <= a.x + height * 1.5 && (overlaps > 0 || wrappedFromIndentedLine);
}

function separator(previous: PositionedMember, current: PositionedMember): string {
  const left = previous.quote.trimEnd();
  const right = current.quote.trimStart();
  if (/[-‐‑]$/u.test(left)) return '';
  if (/^[,.;:!?%)\]}，。；：！？、]/u.test(right)) return '';
  if (/[(\[{]$/u.test(left)) return '';
  if (/\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right)) return '';
  return ' ';
}

/** The order of IDs is preserved; gaps never trigger search or synthetic anchors. */
export function buildInlineEvidenceExcerpts(
  evidenceIds: readonly string[], candidates: readonly EvidenceCandidate[], pages: PageExtraction[],
): InlineExcerptGroup[] {
  const byId = new Map(candidates.map((candidate) => [candidate.evidenceId, candidate]));
  const blocks = new Map(pages.flatMap((page) => page.blocks).map((block) => [block.blockId, block]));
  const pageMidpoints = new Map(pages.map((page) => {
    const rects = page.blocks.flatMap((block) => block.anchor.rects);
    return [page.pageIndex, rects.length
      ? (Math.min(...rects.map((rect) => rect.x)) + Math.max(...rects.map((rect) => rect.x + rect.width))) / 2
      : undefined] as const;
  }));
  const groups: InlineExcerptGroup[] = [];
  let previous: PositionedMember | undefined;
  for (const [offset, evidenceId] of evidenceIds.entries()) {
    const candidate = byId.get(evidenceId);
    const location = candidate ? locateEvidenceCandidate(candidate, pages) : undefined;
    const block = location?.blockId ? blocks.get(location.blockId) : undefined;
    const quote = candidate?.quote ?? '';
    const member: PositionedMember = { evidenceId, index: offset + 1, quote, displayQuote: quote, location, separatorBefore: '', candidate, block,
      pageMidpoint: block && pageMidpoints.get(block.pageIndex) };
    if (!previous || !continuous(previous, member)) groups.push({ members: [] });
    else {
      member.separatorBefore = separator(previous, member);
      // Only normalize a printed hyphen at a verified line break. The source
      // quote and anchor remain untouched for inspection and navigation.
      const a = previous.block?.anchor.rects[0];
      const b = member.block?.anchor.rects[0];
      if (previous.block?.hasEol && a && b && a.y - b.y > Math.max(a.height, b.height) * 0.55
        && /\p{Ll}-$/u.test(previous.quote) && /^\p{Ll}/u.test(member.quote)) {
        previous.displayQuote = previous.quote.slice(0, -1);
      }
    }
    groups[groups.length - 1].members.push(member);
    previous = member;
  }
  return groups;
}
