import { describe, expect, it } from 'vitest';
import { clampAnnotationPopup, pdfUnderlineEdge } from './pdfAnnotationAppearance';

describe('PDF annotation appearance', () => {
  it('keeps the original text baseline through all user rotations', () => {
    expect([0, 90, 180, 270, 360, -90].map(pdfUnderlineEdge)).toEqual(['bottom', 'left', 'top', 'right', 'bottom', 'right']);
  });
  it('retains an in-bounds popup anchor', () => {
    expect(clampAnnotationPopup({ left: 200, top: 120 }, { left: 80, top: 40, width: 240, height: 80 }, { width: 390, height: 844 })).toEqual({ left: 200, top: 120 });
  });
  it('keeps a selection toolbar above the top or past the right edge reachable', () => {
    const point = clampAnnotationPopup({ left: 380, top: 10 }, { left: 220, top: -70, width: 320, height: 80 }, { width: 390, height: 844 });
    expect(point).toEqual({ left: 222, top: 88 });
    expect({ left: 220 + point.left - 380, top: -70 + point.top - 10 }).toEqual({ left: 62, top: 8 });
  });
  it('shifts a large translation popup above the viewport bottom without clipping its controls', () => {
    expect(clampAnnotationPopup({ left: 15, top: 810 }, { left: -135, top: 810, width: 300, height: 300 }, { width: 390, height: 844 })).toEqual({ left: 158, top: 536 });
  });
});
