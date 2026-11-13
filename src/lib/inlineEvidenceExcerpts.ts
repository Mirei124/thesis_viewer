import { locateEvidenceCandidate, PDF_EVIDENCE_LEDGER_VERSION, type EvidenceCandidate, type EvidenceLocation } from './evidenceLedger';
import type { PageExtraction, PdfPageTextBlock } from './pdfPageBlocks';
import { createStructuredPaper } from './structuredPaper';

export type InlineExcerptMember = {
  evidenceId: string;
  index: number;
  /** Original verified quote: never replaced by reconstructed prose. */
  quote: string;
  displayQuote: string;
  location?: EvidenceLocation;
  separatorBefore: string;
};
export type InlineExcerptGroup = {
  members: InlineExcerptMember[];
  /** Presentation only; this is not a synthetic evidence quote/anchor. */
  text: string;
  target?: InlineExcerptMember;
  mathLayout: boolean;
};
type PositionedMember = InlineExcerptMember & { candidate?: EvidenceCandidate; block?: PdfPageTextBlock; paragraph?: string };
const height = (member: PositionedMember) => member.block?.rawHeight || member.block?.anchor.rects[0]?.height || 0;
const rect = (member: PositionedMember) => member.block?.anchor.rects[0];
const usable = (member: PositionedMember) => Boolean(member.block && member.location?.anchor
  && !member.location.qualityWarnings.includes('quote-fallback-used') && !member.block.qualityFlags.includes('non-axis-aligned-transform'));

function separator(previous: PositionedMember, current: PositionedMember): string {
  const left = previous.quote.trimEnd(), right = current.quote.trimStart();
  if (/[-‐‑]$/u.test(left) || /^[,.;:!?%)\]}，。；：！？、]/u.test(right) || /[(\[{]$/u.test(left)) return '';
  if (/\p{Script=Han}$/u.test(left) && /^\p{Script=Han}/u.test(right)) return '';
  const a = rect(previous), b = rect(current);
  // Join touching glyphs, including their printed sub/superscripts. Never
  // manufacture LaTeX or infer a fraction from flattened PDF text.
  if (a && b && Math.abs(a.y - b.y) < Math.max(height(previous), height(current)) * 1.2
    && b.x >= a.x && b.x - a.x - a.width >= -Math.max(height(previous), height(current)) * 0.2
    && b.x - a.x - a.width < Math.max(height(previous), height(current)) * 0.12) return '';
  return ' ';
}

function completeSourceInterval(a: PositionedMember, b: PositionedMember, page: PageExtraction | undefined, selected: ReadonlySet<string>): boolean {
  if (!a.block || !b.block || !page) return false;
  const low = Math.min(a.block.sourceOrder, b.block.sourceOrder), high = Math.max(a.block.sourceOrder, b.block.sourceOrder);
  const inBetween = page.blocks.filter(block => block.sourceOrder > low && block.sourceOrder < high);
  // Empty PDF.js items are omitted by extraction. The original item count
  // establishes that an absent index is an empty item, rather than unknown data.
  if (high >= page.textItemCount && high - low > 1) return false;
  return inBetween.every(block => !block.normalizedText.trim() || selected.has(block.blockId));
}

function canJoin(group: readonly PositionedMember[], next: PositionedMember, page: PageExtraction | undefined, selected: ReadonlySet<string>): boolean {
  const previous = group.at(-1)!;
  if (!usable(previous) || !usable(next) || previous.block!.pageIndex !== next.block!.pageIndex
    || previous.candidate?.section.title !== next.candidate?.section.title || !completeSourceInterval(previous, next, page, selected)) return false;
  const a = rect(previous)!, b = rect(next)!;
  const size = Math.max(height(previous), height(next));
  if (!(size > 0)) return false;
  const gap = b.x - a.x - a.width, rowDifference = a.y - b.y;
  const sameRow = Math.abs(rowDifference) <= size * 0.55;
  const script = Math.abs(rowDifference) <= size * 1.2 && (previous.quote.trim().length <= 3 || next.quote.trim().length <= 3);
  if ((sameRow || script) && gap >= -size * 0.5 && gap <= size * 2) {
    // A paragraph marker remains a boundary except for attached math glyphs.
    return previous.paragraph === next.paragraph || script;
  }
  if (previous.paragraph !== next.paragraph) return false;
  // Use the whole current line, not its last isolated glyph, to identify a
  // wrapped line in the same column. This also avoids crossing table columns.
  const row = group.filter(member => {
    const r = rect(member); return r && Math.abs(r.y - a.y) <= size * 0.55;
  });
  const rowLeft = Math.min(...row.map(member => rect(member)!.x));
  const rowRight = Math.max(...row.map(member => rect(member)!.x + rect(member)!.width));
  const overlap = Math.min(rowRight, b.x + b.width) - Math.max(rowLeft, b.x);
  const pageRects = page?.blocks.flatMap(block => block.anchor.rects) ?? [];
  const midpoint = pageRects.length ? (Math.min(...pageRects.map(r => r.x)) + Math.max(...pageRects.map(r => r.x + r.width))) / 2 : NaN;
  const wrappedFromIndent = (rowLeft >= midpoint) === (b.x >= midpoint)
    && Math.abs(rowLeft - b.x) <= Math.max(rowRight - rowLeft, b.width) + size * 2;
  return rowDifference > size * 0.55 && rowDifference <= size * 2.2
    && b.x <= rowLeft + size * 1.5 && (overlap > 0 || wrappedFromIndent);
}

function mathBand(members: readonly PositionedMember[], page: PageExtraction | undefined, selected: ReadonlySet<string>): boolean {
  if (members.length < 2 || members.some(member => !usable(member))) return false;
  const quotes = members.map(member => member.quote).join(' ');
  if (!/[=∑∫√∝≈]/u.test(quotes) || quotes.length > 240 || /\b(?:the|we|with|which|where|using|input|output)\b/i.test(quotes)) return false;
  const size = Math.max(...members.map(height)), ys = members.map(member => rect(member)!.y);
  if (Math.max(...ys) - Math.min(...ys) > size * 2.5) return false;
  const ordered = [...members].sort((a, b) => a.block!.sourceOrder - b.block!.sourceOrder);
  if (new Set(members.map(member => member.candidate?.section.title)).size > 1) return false;
  // Formula scripts may sit above/below the baseline, but separate columns
  // are not one expression. A printed equation number is the sole exception
  // to the connected horizontal band requirement.
  let left = Infinity, right = -Infinity;
  for (const member of ordered) {
    const r = rect(member)!;
    const equationNumber = /^\(\d+[a-z]?\)$/i.test(member.quote.trim());
    if (left !== Infinity && !equationNumber && (r.x > right + size * 3.5 || r.x + r.width < left - size * 3.5)) return false;
    if (!equationNumber) { left = Math.min(left, r.x); right = Math.max(right, r.x + r.width); }
  }
  return ordered.every((member, index) => !index || completeSourceInterval(ordered[index - 1], member, page, selected));
}

/** Split only oversized readable paragraphs, at language sentence boundaries.
 * Original members remain available even when a sentence starts inside an item. */
function sentenceGroups(group: InlineExcerptGroup): InlineExcerptGroup[] {
  if (group.text.length <= 1200 || group.mathLayout || !('Segmenter' in Intl)) return [group];
  const segments = [...new Intl.Segmenter('en', { granularity: 'sentence' }).segment(group.text)];
  const sentences: Array<{ start: number; end: number }> = [];
  for (const segment of segments) {
    const previous = sentences.at(-1);
    // Segmenter understands decimals; join the small set of scientific
    // abbreviations that can otherwise look like sentence-ending periods.
    const abbreviation = previous && /\b(?:e\.g|i\.e|et al|Fig|Figs|Eq|Eqs|Sec|Dr|Prof|vs)\.[\s"')\]]*$/i.test(group.text.slice(previous.start, previous.end));
    if (previous && abbreviation) previous.end = segment.index + segment.segment.length;
    else sentences.push({ start: segment.index, end: segment.index + segment.segment.length });
  }
  const spans: Array<{ start: number; end: number }> = [];
  for (const sentence of sentences) {
    const previous = spans.at(-1);
    if (previous && sentence.end - previous.start <= 900) previous.end = sentence.end;
    else spans.push({ ...sentence });
  }
  if (spans.length <= 1) return [group];
  let cursor = 0;
  const ranges = group.members.map(member => { const start = cursor; cursor += member.separatorBefore.length + member.displayQuote.length; return { member, start, end: cursor }; });
  return spans.map(span => {
    const members = ranges.filter(range => range.end > span.start && range.start < span.end).map(range => range.member);
    return { ...group, text: group.text.slice(span.start, span.end).trim(), members, target: members.find(member => member.location) };
  });
}

/** Reconstructs reading units only from the cited, independently verified items.
 * No missing text is fetched, and no synthesized paragraph is used as an anchor. */
export function buildInlineEvidenceExcerpts(evidenceIds: readonly string[], candidates: readonly EvidenceCandidate[], pages: PageExtraction[]): InlineExcerptGroup[] {
  const byId = new Map(candidates.map(candidate => [candidate.evidenceId, candidate]));
  const blocks = new Map(pages.flatMap(page => page.blocks).map(block => [block.blockId, block]));
  const members: PositionedMember[] = evidenceIds.map((evidenceId, offset) => {
    const candidate = byId.get(evidenceId), location = candidate ? locateEvidenceCandidate(candidate, pages) : undefined;
    return { evidenceId, index: offset + 1, quote: candidate?.quote ?? '', displayQuote: candidate?.quote ?? '', location,
      separatorBefore: '', candidate, block: location?.blockId ? blocks.get(location.blockId) : undefined };
  });
  const pageIds = new Set(members.flatMap(member => member.block ? [member.block.pageIndex] : []));
  const selectedPages = pages.filter(page => pageIds.has(page.pageIndex));
  const pageBlocks = new Set(selectedPages.flatMap(page => page.blocks.map(block => block.blockId)));
  const localCandidates = candidates.filter(candidate => pageBlocks.has(candidate.blockId));
  const paper = createStructuredPaper({ version: PDF_EVIDENCE_LEDGER_VERSION, documentVersion: selectedPages[0]?.blocks[0]?.documentVersion ?? '',
    candidates: localCandidates, coverage: 'full-text', excluded: { referencesBlockCount: 0, unreliableBlockCount: 0, emptyBlockCount: 0 }, diagnostics: [] }, selectedPages);
  const paragraphByBlock = new Map(paper.paragraphs.flatMap(paragraph => paragraph.members.map(member => [member.candidate.blockId, paragraph.paragraphId] as const)));
  for (const member of members) member.paragraph = member.block && paragraphByBlock.get(member.block.blockId);
  const selected = new Set(members.flatMap(member => member.block ? [member.block.blockId] : []));
  // A paragraph's high radicals/scripts can be assigned to a neighbouring row
  // by layout heuristics. Recover source item order locally, never across a
  // paragraph/page or an uncited substantive item.
  const ordered: PositionedMember[] = [];
  for (let start = 0; start < members.length;) {
    let end = start + 1;
    while (end < members.length && members[start].paragraph && members[end].paragraph === members[start].paragraph) end++;
    const run = members.slice(start, end);
    ordered.push(...run.sort((a, b) => (a.block?.sourceOrder ?? a.index) - (b.block?.sourceOrder ?? b.index)));
    start = end;
  }
  const positionedGroups: PositionedMember[][] = [];
  if (mathBand(ordered, selectedPages[0], selected) && pageIds.size === 1) {
    positionedGroups.push([...ordered].sort((a, b) => a.block!.sourceOrder - b.block!.sourceOrder));
  } else for (const member of ordered) {
    const previous = positionedGroups.at(-1);
    const page = pages.find(page => page.pageIndex === member.block?.pageIndex);
    if (!previous || !canJoin(previous, member, page, selected)) positionedGroups.push([member]);
    else previous.push(member);
  }
  const groups = positionedGroups.map(items => {
    for (let i = 1; i < items.length; i++) {
      items[i].separatorBefore = separator(items[i - 1], items[i]);
      const a = rect(items[i - 1]), b = rect(items[i]);
      if (items[i - 1].block?.hasEol && a && b && a.y - b.y > Math.max(a.height, b.height) * 0.55
        && /\p{Ll}-$/u.test(items[i - 1].quote) && /^\p{Ll}/u.test(items[i].quote)) items[i - 1].displayQuote = items[i - 1].quote.slice(0, -1);
    }
    const text = items.map(member => member.separatorBefore + member.displayQuote).join('');
    return { members: items, text, target: items.find(member => member.location), mathLayout: /[=∑∫√∝≈]/u.test(text)
      || items.some((member, i) => i > 0 && Math.abs(height(member) - height(items[i - 1])) > Math.max(height(member), height(items[i - 1])) * 0.2) };
  });
  return groups.flatMap(sentenceGroups);
}
