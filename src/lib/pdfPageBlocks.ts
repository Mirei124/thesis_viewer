import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

/**
 * This is deliberately a page-level extraction format. `sourceOrder` is the
 * order PDF.js supplied text items in; it is useful for locating the source
 * item, but must never be presented as a reconstructed reading order.
 */
export const PDF_PAGE_BLOCK_EXTRACTION_VERSION = 'pdf-page-blocks-v2';

export type OffsetMap = {
  /** Maps UTF-16 raw-text boundaries to normalized-text boundaries, when known. */
  rawToNormalized: Array<number | null>;
  /** Maps UTF-16 normalized-text boundaries to raw-text boundaries, when known. */
  normalizedToRaw: Array<number | null>;
};

export type TextNormalizationFlag =
  | 'normalized-whitespace'
  | 'normalized-soft-hyphen'
  | 'normalized-unicode-nfkc'
  | 'offset-map-ambiguous';

export type PdfTextRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfPageAnchor = {
  pageIndex: number;
  quote: string;
  rects: PdfTextRect[];
  coordinateSpace: 'pdfjs-text-item';
};

export type PdfPageTextBlock = {
  blockId: string;
  documentVersion: string;
  extractionVersion: typeof PDF_PAGE_BLOCK_EXTRACTION_VERSION;
  pageIndex: number;
  sourceOrder: number;
  rawText: string;
  normalizedText: string;
  offsetMap: OffsetMap;
  rawTransform: readonly [number, number, number, number, number, number];
  rawWidth: number;
  rawHeight: number;
  hasEol: boolean;
  anchor: PdfPageAnchor;
  qualityFlags: Array<'pdfjs-source-order-not-reading-order' | 'non-axis-aligned-transform' | 'empty-or-zero-size-rect' | TextNormalizationFlag>;
};

export type PageExtraction = {
  pageIndex: number;
  blocks: PdfPageTextBlock[];
  searchableText: string;
  textItemCount: number;
  status: 'text' | 'empty' | 'failed';
  error?: string;
};

function isTextItem(item: TextContent['items'][number]): item is TextItem {
  return 'str' in item;
}

function itemRect(item: TextItem): PdfTextRect {
  const [, , , , x, y] = item.transform;
  return { x, y, width: item.width, height: item.height };
}

/**
 * Normalizes one PDF.js text item only. It intentionally never joins items:
 * their source order is not a reading order. Every removal or many-to-one
 * transformation is recorded and its interior offsets are left unknown.
 */
export function normalizePdfTextItem(rawText: string): { normalizedText: string; offsetMap: OffsetMap; qualityFlags: TextNormalizationFlag[] } {
  const rawToNormalized: Array<number | null> = Array(rawText.length + 1).fill(null);
  const normalizedToRaw: Array<number | null> = [0];
  const qualityFlags = new Set<TextNormalizationFlag>();
  let normalizedText = '';
  let rawOffset = 0;
  let normalizedOffset = 0;

  const setBoundary = (rawBoundary: number, normalizedBoundary: number, exact: boolean) => {
    rawToNormalized[rawBoundary] = normalizedBoundary;
    normalizedToRaw[normalizedBoundary] = rawBoundary;
    if (!exact) qualityFlags.add('offset-map-ambiguous');
  };

  while (rawOffset < rawText.length) {
    const rawStart = rawOffset;
    const character = String.fromCodePoint(rawText.codePointAt(rawOffset)!);
    rawOffset += character.length;
    const normalizedStart = normalizedOffset;

    if (/\s/u.test(character)) {
      let rawEnd = rawOffset;
      while (rawEnd < rawText.length) {
        const next = String.fromCodePoint(rawText.codePointAt(rawEnd)!);
        if (!/\s/u.test(next)) break;
        rawEnd += next.length;
      }
      const hadRun = rawEnd - rawStart !== 1 || character !== ' ';
      if (normalizedText.length > 0 && !normalizedText.endsWith(' ')) {
        normalizedText += ' ';
        normalizedOffset += 1;
      }
      if (hadRun) qualityFlags.add('normalized-whitespace');
      // Collapsed whitespace has no one-character source correspondence.
      setBoundary(rawStart, normalizedStart, !hadRun);
      for (let boundary = rawStart + 1; boundary < rawEnd; boundary += 1) rawToNormalized[boundary] = null;
      setBoundary(rawEnd, normalizedOffset, !hadRun);
      rawOffset = rawEnd;
      continue;
    }

    if (character === '\u00ad') {
      qualityFlags.add('normalized-soft-hyphen');
      setBoundary(rawStart, normalizedStart, false);
      setBoundary(rawOffset, normalizedStart, false);
      continue;
    }

    const normalizedCharacter = character.normalize('NFKC');
    const changed = normalizedCharacter !== character;
    if (changed) qualityFlags.add('normalized-unicode-nfkc');
    normalizedText += normalizedCharacter;
    normalizedOffset += normalizedCharacter.length;
    const exact = !changed && character.length === 1;
    setBoundary(rawStart, normalizedStart, exact);
    for (let boundary = rawStart + 1; boundary < rawOffset; boundary += 1) rawToNormalized[boundary] = null;
    for (let boundary = normalizedStart + 1; boundary < normalizedOffset; boundary += 1) normalizedToRaw[boundary] = null;
    setBoundary(rawOffset, normalizedOffset, exact);
  }

  return { normalizedText, offsetMap: { rawToNormalized, normalizedToRaw }, qualityFlags: Array.from(qualityFlags) };
}

export type NormalizedRangeLocation =
  | { precision: 'exact'; rawStart: number; rawEnd: number }
  | { precision: 'block' }
  | { precision: 'page' };

/** Maps a normalized block range back to raw source offsets conservatively. */
export function locateNormalizedRange(block: PdfPageTextBlock, normalizedStart: number, normalizedEnd: number): NormalizedRangeLocation {
  const rawStart = block.offsetMap.normalizedToRaw[normalizedStart];
  const rawEnd = block.offsetMap.normalizedToRaw[normalizedEnd];
  if (rawStart === null || rawStart === undefined || rawEnd === null || rawEnd === undefined) return { precision: 'page' };
  if (block.qualityFlags.some((flag) => flag === 'normalized-whitespace' || flag === 'normalized-soft-hyphen' || flag === 'normalized-unicode-nfkc' || flag === 'offset-map-ambiguous')) return { precision: 'block' };
  return { precision: 'exact', rawStart, rawEnd };
}

export function pageBlocksFromTextContent(
  textContent: TextContent,
  pageIndex: number,
  documentVersion: string,
): PageExtraction {
  const textItems = textContent.items.filter(isTextItem);
  const blocks = textItems
    .flatMap((item, sourceOrder): PdfPageTextBlock[] => {
      if (item.str.length === 0) return [];
      const rawTransform: PdfPageTextBlock['rawTransform'] = [
        item.transform[0], item.transform[1], item.transform[2],
        item.transform[3], item.transform[4], item.transform[5],
      ];
      const rect = itemRect(item);
      const qualityFlags: PdfPageTextBlock['qualityFlags'] = ['pdfjs-source-order-not-reading-order'];
      if (rawTransform[1] !== 0 || rawTransform[2] !== 0) qualityFlags.push('non-axis-aligned-transform');
      if (rect.width <= 0 || rect.height <= 0) qualityFlags.push('empty-or-zero-size-rect');
      const rawText = item.str;
      const normalization = normalizePdfTextItem(rawText);
      qualityFlags.push(...normalization.qualityFlags);
      return [{
        blockId: `${documentVersion}:${PDF_PAGE_BLOCK_EXTRACTION_VERSION}:p${pageIndex}:i${sourceOrder}`,
        documentVersion,
        extractionVersion: PDF_PAGE_BLOCK_EXTRACTION_VERSION,
        pageIndex,
        sourceOrder,
        rawText,
        normalizedText: normalization.normalizedText,
        offsetMap: normalization.offsetMap,
        rawTransform,
        rawWidth: item.width,
        rawHeight: item.height,
        hasEol: item.hasEOL,
        anchor: { pageIndex, quote: rawText, rects: [rect], coordinateSpace: 'pdfjs-text-item' },
        qualityFlags,
      }];
    });
  const searchableText = blocks.map((block) => block.normalizedText).join(' ').trim();
  return {
    pageIndex,
    blocks,
    searchableText,
    textItemCount: textItems.length,
    status: searchableText.length > 0 ? 'text' : 'empty',
  };
}
