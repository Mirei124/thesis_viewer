import { describe, expect, it, vi } from 'vitest';

import { bindPdfWheelZoom, zoomWheelDelta, clampZoomScale, fittedZoomScale, manualZoomChoice, MAX_ZOOM_SCALE, parseZoomPercentInput, shouldCommitZoomOnKeyDown, ZOOM_CHOICES, zoomChoiceMode, zoomChoiceScale, zoomPercentDisplay } from './readerZoom';

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


describe('PDF wheel gestures', () => {
  it('recognizes cancellable Ctrl/Meta gestures and normalizes all delta modes', () => {
    const wheel = { ctrlKey: true, metaKey: false, cancelable: true, deltaY: 3, deltaMode: 0 };
    expect(zoomWheelDelta(wheel, 800)).toBe(3);
    expect(zoomWheelDelta({ ...wheel, ctrlKey: false, metaKey: true, deltaMode: 1 }, 800)).toBe(48);
    expect(zoomWheelDelta({ ...wheel, deltaMode: 2 }, 800)).toBe(2400);
    expect(zoomWheelDelta({ ...wheel, ctrlKey: false }, 800)).toBeNull();
    expect(zoomWheelDelta({ ...wheel, cancelable: false }, 800)).toBeNull();
    expect(zoomWheelDelta({ ...wheel, deltaY: NaN }, 800)).toBeNull();
  });

  function harness() {
    let listener: (event: WheelEvent) => void = () => {};
    const element = {
      clientHeight: 800,
      addEventListener: vi.fn((_type, callback) => { listener = callback; }),
      removeEventListener: vi.fn(),
    };
    let frame: FrameRequestCallback | undefined;
    let scale = 1;
    let finish: (() => void) | undefined;
    const apply = vi.fn(async (next: number) => { scale = next; await new Promise<void>((resolve) => { finish = resolve; }); });
    const cancelFrame = vi.fn(() => { frame = undefined; });
    const cleanup = bindPdfWheelZoom(element as unknown as HTMLElement, {
      getScale: () => scale, apply,
      requestFrame: (callback) => { frame = callback; return 1; }, cancelFrame,
    });
    return {
      element, apply, cleanup, cancelFrame,
      fire(deltaY: number, ctrlKey = true) {
        const preventDefault = vi.fn();
        listener({ deltaY, ctrlKey, metaKey: false, cancelable: true, deltaMode: 0, clientX: 120, clientY: 200, preventDefault } as unknown as WheelEvent);
        return preventDefault;
      },
      flush() { const callback = frame; frame = undefined; callback?.(0); },
      async finish() { finish?.(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); },
    };
  }

  it('leaves ordinary scroll alone and batches gesture events into one anchored update', async () => {
    const h = harness();
    expect(h.element.addEventListener).toHaveBeenCalledWith('wheel', expect.any(Function), { passive: false });
    expect(h.fire(-20, false)).not.toHaveBeenCalled();
    h.flush();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.fire(-50)).toHaveBeenCalledOnce();
    h.fire(-50);
    h.flush();
    expect(h.apply).toHaveBeenCalledWith(1.22, { clientX: 120, clientY: 200 });
    h.fire(-50);
    h.flush();
    expect(h.apply).toHaveBeenCalledTimes(1);
    await h.finish();
    h.flush();
    expect(h.apply).toHaveBeenLastCalledWith(1.35, { clientX: 120, clientY: 200 });
    h.cleanup();
    await h.finish();
  });

  it('accumulates tiny trackpad deltas and clamps bounds without overshoot debt', async () => {
    const h = harness();
    h.fire(-1); h.flush();
    expect(h.apply).not.toHaveBeenCalled();
    h.fire(-1); h.flush();
    h.fire(-1); h.flush();
    expect(h.apply).toHaveBeenLastCalledWith(1.01, expect.any(Object));
    await h.finish();
    h.fire(-10000); h.flush();
    expect(h.apply).toHaveBeenLastCalledWith(4, expect.any(Object));
    await h.finish();
    h.fire(10000); h.flush();
    expect(h.apply).toHaveBeenLastCalledWith(0.25, expect.any(Object));
    await h.finish();
    h.fire(-100); h.flush();
    expect(h.apply).toHaveBeenLastCalledWith(0.31, expect.any(Object));
    h.cleanup(); await h.finish();
  });

  it('removes listeners and cancels queued work on cleanup, including during an apply', async () => {
    const h = harness();
    h.fire(-50); h.cleanup(); h.flush();
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.cancelFrame).toHaveBeenCalledOnce();
    expect(h.element.removeEventListener).toHaveBeenCalledWith('wheel', expect.any(Function));
    const active = harness();
    active.fire(-50); active.flush(); active.fire(-50);
    active.cleanup(); await active.finish(); active.flush();
    expect(active.apply).toHaveBeenCalledTimes(1);
  });
});
