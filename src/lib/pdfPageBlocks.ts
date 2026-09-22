import type { TextContent, TextItem } from 'pdfjs-dist/types/src/display/api';

/**
 * This is deliberately a page-level extraction format. `sourceOrder` is the
 * order PDF.js supplied text items in; it is useful for locating the source
 * item, but must never be presented as a reconstructed reading order.
 */
export const PDF_PAGE_BLOCK_EXTRACTION_VERSION = 'pdf-page-blocks-v1';

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
  rawTransform: readonly [number, number, number, number, number, number];
  rawWidth: number;
  rawHeight: number;
  hasEol: boolean;
  anchor: PdfPageAnchor;
  qualityFlags: Array<'pdfjs-source-order-not-reading-order' | 'non-axis-aligned-transform' | 'empty-or-zero-size-rect'>;
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
      return [{
        blockId: `${documentVersion}:${PDF_PAGE_BLOCK_EXTRACTION_VERSION}:p${pageIndex}:i${sourceOrder}`,
        documentVersion,
        extractionVersion: PDF_PAGE_BLOCK_EXTRACTION_VERSION,
        pageIndex,
        sourceOrder,
        rawText,
        rawTransform,
        rawWidth: item.width,
        rawHeight: item.height,
        hasEol: item.hasEOL,
        anchor: { pageIndex, quote: rawText, rects: [rect], coordinateSpace: 'pdfjs-text-item' },
        qualityFlags,
      }];
    });
  const searchableText = blocks.map((block) => block.rawText).join(' ').trim();
  return {
    pageIndex,
    blocks,
    searchableText,
    textItemCount: textItems.length,
    status: searchableText.length > 0 ? 'text' : 'empty',
  };
}
