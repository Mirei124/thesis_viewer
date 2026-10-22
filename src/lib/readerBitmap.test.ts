import { describe, expect, it } from 'vitest';
import { bitmapBytes, releaseReaderBitmap, selectReaderBitmaps, settleBitmapTask } from './readerBitmap';

describe('reader bitmap working set', () => {
  it('retains visible pages at their real resolution even when they exceed the budget', () => {
    expect(selectReaderBitmaps([
      { index: 2, visible: false, distance: 1, bytes: 40 },
      { index: 1, visible: true, distance: 0, bytes: 120 },
    ], 100)).toEqual([1]);
  });
  it('prioritizes visible and nearest adjacent pages without exceeding the RGBA budget', () => {
    expect(selectReaderBitmaps([
      { index: 4, visible: false, distance: 800, bytes: 40 },
      { index: 2, visible: false, distance: 20, bytes: 40 },
      { index: 3, visible: true, distance: 0, bytes: 40 },
    ], 100)).toEqual([3, 2]);
    expect(bitmapBytes(826, 1069)).toBe(3531976);
  });
  it('does not release a buffer until cancellation actually settles', async () => {
    let reject!: (error: Error) => void;
    const events: string[] = [];
    const canvas = { width: 100, height: 200, dataset: { renderKey: 'old' } };
    const promise = new Promise<void>((_, failure) => { reject = failure; });
    const done = settleBitmapTask({ cancel: () => events.push('cancel'), promise }).then(() => {
      releaseReaderBitmap(canvas);
      events.push('release');
    });
    await Promise.resolve();
    expect(events).toEqual(['cancel']);
    expect(canvas.width).toBe(100);
    reject(new Error('RenderingCancelledException'));
    await done;
    expect(events).toEqual(['cancel', 'release']);
    expect(canvas).toEqual({ width: 0, height: 0, dataset: {} });
  });
});

it('a background eviction cannot erase a reactivated page after cancellation settles', async () => {
  const { retireReaderBitmap } = await import('./readerBitmap');
  let finish!: () => void;
  let hiddenEpoch = true;
  const canvas = { width: 800, height: 1000, dataset: { renderKey: 'new-view' } };
  const pending = retireReaderBitmap(canvas, { cancel() {}, promise: new Promise<void>((resolve) => { finish = resolve; }) }, () => hiddenEpoch);
  hiddenEpoch = false;
  finish();
  expect(await pending).toBe(false);
  expect(canvas.width).toBe(800);
  expect(canvas.dataset.renderKey).toBe('new-view');
});

it('a retired document cannot clear a replacement document canvas', async () => {
  const { retireReaderBitmap } = await import('./readerBitmap');
  const oldCanvas = { width: 800, height: 1000, dataset: {} };
  const newCanvas = { width: 1600, height: 2000, dataset: {} };
  let currentCanvas = oldCanvas;
  const pending = retireReaderBitmap(oldCanvas, undefined, () => currentCanvas === oldCanvas);
  currentCanvas = newCanvas;
  expect(await pending).toBe(false);
  expect(newCanvas.width).toBe(1600);
});


it('does not cancel a render that is already needed before retirement starts', async () => {
  const { retireReaderBitmap } = await import('./readerBitmap');
  let cancelled = false;
  const canvas = { width: 800, height: 1000, dataset: { renderKey: 'current' } };
  expect(await retireReaderBitmap(canvas, { cancel() { cancelled = true; }, promise: Promise.resolve() }, () => false)).toBe(false);
  expect(cancelled).toBe(false);
  expect(canvas.width).toBe(800);
});
