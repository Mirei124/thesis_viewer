import { describe, expect, it } from 'vitest';
import { replayDetailedEvidenceFromPages } from './offlineEvidenceReplay';
import { normalizePdfTextItem, type PageExtraction, type PdfPageTextBlock } from './pdfPageBlocks';
import { PROGRESSIVE_EVIDENCE_STAGES } from './evidencePacket';

function page(pageIndex: number, lines: string[]): PageExtraction {
  const blocks: PdfPageTextBlock[] = lines.map((rawText, sourceOrder) => {
    const normalized = normalizePdfTextItem(rawText);
    return {
      blockId: `fixture:pdf-page-blocks-v2:p${pageIndex}:i${sourceOrder}`,
      documentVersion: 'fixture', extractionVersion: 'pdf-page-blocks-v2', pageIndex, sourceOrder,
      rawText, normalizedText: normalized.normalizedText, offsetMap: normalized.offsetMap,
      rawTransform: [10, 0, 0, 10, 90, 700 - sourceOrder * 20], rawWidth: rawText.length * 5,
      rawHeight: 10, hasEol: true,
      anchor: { pageIndex, quote: rawText, rects: [{ x: 90, y: 700 - sourceOrder * 20, width: rawText.length * 5, height: 10 }], coordinateSpace: 'pdfjs-text-item' },
      qualityFlags: ['pdfjs-source-order-not-reading-order', ...normalized.qualityFlags],
    };
  });
  return { pageIndex, blocks, searchableText: blocks.map((block) => block.normalizedText).join(' '), textItemCount: blocks.length, status: 'text' };
}

describe('offline detailed evidence replay', () => {
  it('reports the six actual progressive packets with validated original IDs and budgets', () => {
    const pages = [
      page(0, ['Introduction', 'Existing systems lack reliable long-range visual reasoning, motivating a controlled comparison of architectures.']),
      page(1, ['Methods', 'We train matched encoder-based and encoder-free models on the same data mixture and fit loss against compute.']),
      page(2, ['Results', 'Removing the visual encoder increases the model allocation exponent from 0.464 to 0.570 under compute-optimal training.']),
    ];
    const report = replayDetailedEvidenceFromPages(pages, 'fixture');
    expect(report.stages.map((stage) => stage.stage)).toEqual(PROGRESSIVE_EVIDENCE_STAGES);
    expect(report.stages.some((stage) => stage.sourceCount > 0)).toBe(true);
    for (const stage of report.stages) {
      expect(stage.sourceCount).toBe(stage.sources.length);
      expect(stage.sourceCount).toBeLessThanOrEqual(stage.sourceLimit);
      expect(stage.totalExcerptChars).toBe(stage.sources.reduce((sum, source) => sum + source.excerptChars, 0));
      for (const source of stage.sources) {
        expect(source.excerptChars).toBeLessThanOrEqual(1500);
        expect(source.evidenceIds.length).toBeGreaterThan(0);
        expect(source.evidenceIds.every((id) => id.startsWith('fixture:pdf-evidence-ledger-v1:'))).toBe(true);
      }
    }
  });
});
