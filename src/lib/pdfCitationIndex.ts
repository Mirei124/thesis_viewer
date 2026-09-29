import type { PageExtraction, PdfPageAnchor, PdfPageTextBlock } from './pdfPageBlocks';

/**
 * This index is deliberately limited to numbered, bracketed references. PDF.js
 * text-item order does not reconstruct a paper's reading order, so the result
 * is evidence for a future citation UI, never a claim that a marker is a
 * semantic paper citation or that a reference entry has been fully parsed.
 */
export const PDF_LOCAL_CITATION_INDEX_VERSION = 'pdf-local-citation-index-v1';

export type ReferenceQualityWarning =
  | 'references-heading-is-heuristic'
  | 'pdfjs-source-order-not-reading-order';

export type PdfReferenceCandidate = {
  refId: string;
  number: number;
  rawText: string;
  anchor: PdfPageAnchor;
  sourceBlockId: string;
  confidence: 'low';
  qualityWarnings: ReferenceQualityWarning[];
  matchingStatus: 'candidate';
  /** An http(s) URL written in the local PDF.js blocks grouped for this entry. */
  sourceUrl?: string;
};

export type CitationMatchStatus = 'matched' | 'ambiguous' | 'unresolved';

export type PdfCitationOccurrence = {
  occurrenceId: string;
  displayMarker: string;
  refIds: string[];
  referencedNumbers: number[];
  anchor: PdfPageAnchor;
  sourceBlockId: string;
  rawStart: number;
  rawEnd: number;
  status: CitationMatchStatus;
  basis: Array<'numbered-bracket-marker' | 'single-pdfjs-item-offset' | 'reference-number-candidate' | 'duplicate-reference-number' | 'missing-reference-number' | 'range-too-broad'>;
  caution: string;
};

export type PdfLocalCitationIndex = {
  version: typeof PDF_LOCAL_CITATION_INDEX_VERSION;
  referenceHeading?: { rawText: string; anchor: PdfPageAnchor; sourceBlockId: string };
  references: PdfReferenceCandidate[];
  occurrences: PdfCitationOccurrence[];
  matchedOccurrenceCount: number;
  ambiguousOccurrenceCount: number;
  unresolvedOccurrenceCount: number;
  diagnostics: string[];
};

type ReferenceHeading = { block: PdfPageTextBlock; flatIndex: number };

const referenceHeadingPattern = /^(?:(?:\d+(?:\.\d+){0,5}\.?|[IVXLCDM]{1,8}\.)\s+)?(?:references|bibliography|literature\s+cited)\.?$/i;
const referenceEntryPattern = /^\s*\[\s*(\d{1,5})\s*\]/;
const numberedCitationPattern = /\[\s*\d{1,5}\s*(?:(?:[,;]|[-–])\s*\d{1,5}\s*)*\]/g;
const MAX_RANGE_WIDTH = 25;

function localHttpSourceUrl(rawText: string): string | undefined {
  // Do not turn a DOI, title, or other inferred field into a link. This is
  // deliberately limited to an http(s) URL present in the grouped local text.
  const url = rawText.match(/https?:\/\/[^\s<>"']+/i)?.[0]?.replace(/[),.;\]}]+$/u, '');
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}

function flattenPages(pages: PageExtraction[]): PdfPageTextBlock[] {
  return pages.flatMap((page) => page.blocks)
    .sort((left, right) => left.pageIndex - right.pageIndex || left.sourceOrder - right.sourceOrder);
}

function parseMarkerNumbers(marker: string): { numbers: number[]; rangeTooBroad: boolean } {
  let rangeTooBroad = false;
  const values = marker.slice(1, -1).split(/[,;]/).flatMap((part) => {
    const range = part.trim().split(/[-–]/);
    if (range.length === 2) {
      const start = Number(range[0].trim());
      const end = Number(range[1].trim());
      if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end - start + 1 > MAX_RANGE_WIDTH) {
        rangeTooBroad = true;
        return [];
      }
      return Array.from({ length: end - start + 1 }, (_, index) => start + index);
    }
    const number = Number(part.trim());
    return Number.isInteger(number) ? [number] : [];
  });
  return { numbers: Array.from(new Set(values)), rangeTooBroad };
}

function headingWithMostNumberedEntries(blocks: PdfPageTextBlock[]): ReferenceHeading | undefined {
  const headings = blocks.flatMap((block, flatIndex): ReferenceHeading[] =>
    referenceHeadingPattern.test(block.rawText.trim()) ? [{ block, flatIndex }] : []);
  let best: ReferenceHeading | undefined;
  let bestCount = -1;
  for (const heading of headings) {
    const count = blocks.slice(heading.flatIndex + 1).filter((block) => referenceEntryPattern.test(block.rawText)).length;
    if (count > bestCount || (count === bestCount && best && heading.flatIndex > best.flatIndex)) {
      best = heading;
      bestCount = count;
    }
  }
  return best;
}

function occurrenceAnchor(block: PdfPageTextBlock, marker: string): PdfPageAnchor {
  return { ...block.anchor, quote: marker };
}

/**
 * Builds inspectable candidates from a heuristic References heading and the
 * following PDF.js source-order tail. Each [n] starts a new candidate; later
 * items belong to it until the next [n], possibly across pages. This grouping
 * is not a reconstructed reading order or parsed bibliography record.
 */
export function pdfLocalCitationIndexFromPages(pages: PageExtraction[], documentVersion: string): PdfLocalCitationIndex {
  const blocks = flattenPages(pages);
  const heading = headingWithMostNumberedEntries(blocks);
  const referenceBlocks = heading ? blocks.slice(heading.flatIndex + 1) : [];
  const references: PdfReferenceCandidate[] = [];
  let entryStart: PdfPageTextBlock | undefined;
  let entryNumber = 0;
  let entryParts: string[] = [];
  const finishEntry = () => {
    if (!entryStart) return;
    // Separators aid display but do not assert the PDF's visual reading order.
    const rawText = entryParts.map((part) => part.trim()).filter(Boolean).join(' ');
    references.push({
      refId: `${documentVersion}:${PDF_LOCAL_CITATION_INDEX_VERSION}:ref:${entryNumber}:p${entryStart.pageIndex}:i${entryStart.sourceOrder}`,
      number: entryNumber,
      rawText,
      anchor: entryStart.anchor,
      sourceBlockId: entryStart.blockId,
      confidence: 'low',
      qualityWarnings: ['references-heading-is-heuristic', 'pdfjs-source-order-not-reading-order'],
      matchingStatus: 'candidate',
      sourceUrl: localHttpSourceUrl(rawText),
    });
  };
  for (const block of referenceBlocks) {
    const match = referenceEntryPattern.exec(block.rawText);
    if (match) {
      finishEntry();
      entryStart = block;
      entryNumber = Number(match[1]);
      entryParts = [block.rawText];
    } else if (entryStart) {
      entryParts.push(block.rawText);
    }
  }
  finishEntry();
  const referencesByNumber = new Map<number, PdfReferenceCandidate[]>();
  for (const reference of references) {
    referencesByNumber.set(reference.number, [...(referencesByNumber.get(reference.number) ?? []), reference]);
  }
  const referenceBlockIds = new Set(referenceBlocks.map((block) => block.blockId));
  const occurrences = blocks.flatMap((block): PdfCitationOccurrence[] => {
    if (referenceBlockIds.has(block.blockId)) return [];
    return Array.from(block.rawText.matchAll(numberedCitationPattern)).map((match, occurrenceIndex) => {
      const displayMarker = match[0];
      const parsed = parseMarkerNumbers(displayMarker);
      const candidates = parsed.numbers.map((number) => referencesByNumber.get(number) ?? []);
      const hasDuplicates = candidates.some((items) => items.length > 1);
      const hasMissing = parsed.rangeTooBroad || candidates.some((items) => items.length === 0);
      const status: CitationMatchStatus = hasMissing ? 'unresolved' : hasDuplicates ? 'ambiguous' : 'matched';
      const basis: PdfCitationOccurrence['basis'] = ['numbered-bracket-marker', 'single-pdfjs-item-offset'];
      if (parsed.rangeTooBroad) basis.push('range-too-broad');
      if (hasDuplicates) basis.push('duplicate-reference-number');
      if (hasMissing) basis.push('missing-reference-number');
      if (!hasMissing && !hasDuplicates) basis.push('reference-number-candidate');
      const refIds = candidates.flat().map((reference) => reference.refId);
      const rawStart = match.index ?? 0;
      return {
        occurrenceId: `${documentVersion}:${PDF_LOCAL_CITATION_INDEX_VERSION}:cite:p${block.pageIndex}:i${block.sourceOrder}:o${occurrenceIndex}`,
        displayMarker,
        refIds,
        referencedNumbers: parsed.numbers,
        anchor: occurrenceAnchor(block, displayMarker),
        sourceBlockId: block.blockId,
        rawStart,
        rawEnd: rawStart + displayMarker.length,
        status,
        basis,
        caution: 'This is a numbered-bracket pattern in one PDF.js text item. It is not proof that the marker is a scholarly citation or that the candidate entry is a complete bibliography record.',
      };
    });
  });
  const matchedOccurrenceCount = occurrences.filter((occurrence) => occurrence.status === 'matched').length;
  const ambiguousOccurrenceCount = occurrences.filter((occurrence) => occurrence.status === 'ambiguous').length;
  const unresolvedOccurrenceCount = occurrences.filter((occurrence) => occurrence.status === 'unresolved').length;
  const diagnostics = [
    heading
      ? `A heuristic References heading was found on page ${heading.block.pageIndex + 1}; later [n] starts were grouped with following source-order items until the next [n].`
      : 'No unambiguous References/Bibliography heading with numbered entries was found; numbered markers remain unresolved.',
    'PDF.js source-item order is not paper reading order. Grouped entries do not imply reconstructed layout; the index does not parse titles/authors/DOIs or infer author-year citations.',
    'Matched means exactly one local numbered entry candidate exists for every number in the marker; it does not establish semantic correctness.',
  ];
  return {
    version: PDF_LOCAL_CITATION_INDEX_VERSION,
    referenceHeading: heading ? { rawText: heading.block.rawText, anchor: heading.block.anchor, sourceBlockId: heading.block.blockId } : undefined,
    references,
    occurrences,
    matchedOccurrenceCount,
    ambiguousOccurrenceCount,
    unresolvedOccurrenceCount,
    diagnostics,
  };
}
