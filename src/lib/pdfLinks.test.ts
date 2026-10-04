import { describe, expect, it } from 'vitest';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfDestinationPoint, pdfLinkBounds, pdfLinksFromAnnotations, resolvePdfLinkDestination, safePdfLinkUrl } from './pdfLinks';

describe('PDF native links', () => {
  it('accepts only valid HTTP(S) URLs and never guesses from unsafeUrl', () => {
    expect(safePdfLinkUrl('https://github.com/Tier-Flow/LoopVL')).toBe('https://github.com/Tier-Flow/LoopVL');
    for (const url of ['javascript:alert(1)', 'file:///tmp/example', 'data:text/html,x', 'https://', '/relative']) expect(safePdfLinkUrl(url)).toBeUndefined();
    expect(pdfLinksFromAnnotations([{ subtype: 'Link', rect: [0, 0, 10, 10], unsafeUrl: 'https://example.com' }])).toEqual([]);
  });
  it('filters malformed annotations but retains named and zero-based numeric destinations', () => {
    const result = pdfLinksFromAnnotations([
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: 'target' },
      { subtype: 'Link', rect: [0, 0, 10, 10], dest: [0, { name: 'Fit' }] },
      { subtype: 'Widget', rect: [0, 0, 10, 10], url: 'https://example.com' },
      { subtype: 'Link', rect: [0, NaN, 10, 10], url: 'https://example.com' },
    ]);
    expect(result.map((link) => link.dest)).toEqual(['target', [0, { name: 'Fit' }]]);
  });
  it('uses PDF.js viewport transforms for CropBox, all rotations, and scale', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 400 600] /CropBox [10 20 390 580] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
    const loadingTask = getDocument({ data: bytes });
    const pdf = await loadingTask.promise;
    const page = await pdf.getPage(1);
    for (const rotation of [0, 90, 180, 270]) {
      const viewport = page.getViewport({ scale: 2, rotation });
      const rect = [50, 100, 150, 120];
      const [x1, y1] = viewport.convertToViewportPoint(50, 100);
      const [x2, y2] = viewport.convertToViewportPoint(150, 120);
      expect(pdfLinkBounds(rect, viewport)).toEqual({ left: Math.min(x1, x2), top: Math.min(y1, y2), width: Math.abs(x1 - x2), height: Math.abs(y1 - y2) });
      expect(pdfLinkBounds([50, 100, 50, 100], viewport)).toBeNull();
      expect(pdfDestinationPoint([0, { name: 'XYZ' }, 50, 120, null], viewport)).toEqual(viewport.convertToViewportPoint(50, 120));
      expect(pdfDestinationPoint([0, { name: 'FitH' }, 120], viewport)).toEqual(viewport.convertToViewportPoint(10, 120));
    }
    await loadingTask.destroy();
  });
  it('resolves named, numeric page zero and ref targets, rejecting missing or out-of-range destinations', async () => {
    const ref = { num: 7, gen: 0 };
    const pdf = { numPages: 2, getDestination: async (name: string) => name === 'target' ? [ref, { name: 'XYZ' }, 0, 500, null] : null, getPageIndex: async () => 1 };
    expect((await resolvePdfLinkDestination(pdf, 'target')).pageIndex).toBe(1);
    expect((await resolvePdfLinkDestination(pdf, [0, { name: 'Fit' }])).pageIndex).toBe(0);
    for (const dest of ['missing', [2, { name: 'Fit' }], [-1, { name: 'Fit' }], [0.5, { name: 'Fit' }], [null, { name: 'Fit' }]]) await expect(resolvePdfLinkDestination(pdf, dest)).rejects.toThrow();
  });
});
