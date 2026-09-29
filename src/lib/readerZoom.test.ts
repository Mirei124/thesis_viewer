import { describe, expect, it } from 'vitest';

import { clampZoomScale, fittedZoomScale, manualZoomChoice, MAX_ZOOM_SCALE, parseZoomPercentInput, shouldCommitZoomOnKeyDown, ZOOM_CHOICES, zoomChoiceMode, zoomChoiceScale, zoomPercentDisplay } from './readerZoom';

describe('reader zoom choices', () => {
  it('keeps the requested menu order and maps fixed choices including 400%', () => {
    expect(ZOOM_CHOICES).toEqual(['auto', 'actual', 'fit-page', 'fit-width', '50', '75', '100', '125', '150', '200', '300', '400']);
    expect(zoomChoiceMode('auto')).toBe('auto');
    expect(zoomChoiceMode('fit-page')).toBe('fit-page');
    expect(zoomChoiceMode('fit-width')).toBe('fit-width');
    expect(zoomChoiceMode('actual')).toBe('manual');
    expect(zoomChoiceMode('400')).toBe('manual');
    expect(zoomChoiceScale('actual')).toBe(1);
    expect(zoomChoiceScale('125')).toBe(1.25);
    expect(zoomChoiceScale('400')).toBe(4);
    expect(zoomChoiceScale('auto')).toBeUndefined();
  });

  it('clamps manual zoom and represents step-only values honestly', () => {
    expect(clampZoomScale(5)).toBe(MAX_ZOOM_SCALE);
    expect(clampZoomScale(0.1)).toBe(0.25);
    expect(manualZoomChoice(1.25)).toBe('125');
    expect(manualZoomChoice(1.35)).toBe('custom');
  });

  it('distinguishes auto, page, and width fitting', () => {
    expect(fittedZoomScale('auto', 500, 1000, 1500, 600)).toBe(1.35);
    expect(fittedZoomScale('fit-width', 500, 1000, 1500, 600)).toBe(3);
    expect(fittedZoomScale('fit-page', 500, 1000, 1500, 600)).toBe(0.6);
    expect(fittedZoomScale('fit-width', 500, 1000, 2500, 600)).toBe(4);
  });

  it('displays a percent when idle and plain editable digits on focus', () => {
    expect(zoomPercentDisplay(4, false)).toBe('400%');
    expect(zoomPercentDisplay(1.37, true)).toBe('137');
    expect(zoomPercentDisplay(0.25, false)).toBe('25%');
  });

  it('accepts only integral entered percentages within 25–400', () => {
    expect(parseZoomPercentInput('25')).toBe(25);
    expect(parseZoomPercentInput('400')).toBe(400);
    expect(parseZoomPercentInput(' 137 ')).toBe(137);
    for (const value of ['', ' ', '24', '401', '25.5', '25.0', '1e2', '-25', 'Infinity', 'abc']) {
      expect(parseZoomPercentInput(value)).toBeNull();
    }
  });

  it('submits on Enter only outside IME composition', () => {
    expect(shouldCommitZoomOnKeyDown('Enter', false)).toBe(true);
    expect(shouldCommitZoomOnKeyDown('Enter', true)).toBe(false);
    expect(shouldCommitZoomOnKeyDown('Tab', false)).toBe(false);
  });
});
