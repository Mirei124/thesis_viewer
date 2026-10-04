import { describe, expect, it } from 'vitest';
import { createReaderZoomPreferences, parseReaderZoomPreference, READER_ZOOM_KEY } from './readerZoomPreferences';

describe('shared reader zoom preference', () => {
  it('accepts bounded manual scales and layout modes, ignoring legacy document zoom', () => {
    for (const scale of [0.25, 1, 1.37, 4]) expect(parseReaderZoomPreference({ mode: 'manual', scale })).toEqual({ mode: 'manual', scale });
    for (const mode of ['auto', 'fit-page', 'fit-width']) expect(parseReaderZoomPreference({ mode, scale: 99 })).toEqual({ mode });
    for (const value of [undefined, null, {}, { scale: 1.5 }, { mode: 'manual', scale: '1.5' }, { mode: 'manual', scale: NaN }, { mode: 'manual', scale: Infinity }, { mode: 'manual', scale: 0.24 }, { mode: 'manual', scale: 4.01 }, { mode: 'unknown' }]) expect(parseReaderZoomPreference(value)).toEqual({ mode: 'auto' });
  });
  it('uses one global key and reads the latest queued choice before opening another PDF', async () => {
    let value: unknown;
    let finishFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => { finishFirst = resolve; });
    const keys: string[] = [];
    const preferences = createReaderZoomPreferences(() => ({
      async get(key) { keys.push(key); return { [key]: value }; },
      async set(values) { keys.push(...Object.keys(values)); if (!value) await firstWrite; value = values[READER_ZOOM_KEY]; },
    }));
    void preferences.save({ mode: 'manual', scale: 1.5 });
    void preferences.save({ mode: 'fit-width' });
    const nextOpen = preferences.load();
    finishFirst();
    expect(await nextOpen).toEqual({ mode: 'fit-width' });
    expect(keys).toEqual([READER_ZOOM_KEY, READER_ZOOM_KEY, READER_ZOOM_KEY]);
  });
  it('handles unavailable storage and read/write failures without blocking later saves', async () => {
    const unavailable = createReaderZoomPreferences(() => undefined);
    await expect(unavailable.save({ mode: 'manual', scale: 2 })).resolves.toBeUndefined();
    expect(await unavailable.load()).toEqual({ mode: 'auto' });
    let fail = true;
    let value: unknown;
    const preferences = createReaderZoomPreferences(() => ({
      async get(key) { if (fail) throw new Error('read failed'); return { [key]: value }; },
      async set(values) { if (fail) throw new Error('write failed'); value = values[READER_ZOOM_KEY]; },
    }));
    expect(await preferences.load()).toEqual({ mode: 'auto' });
    await expect(preferences.save({ mode: 'manual', scale: 1.5 })).resolves.toBeUndefined();
    fail = false;
    await preferences.save({ mode: 'manual', scale: 1.75 });
    expect(await preferences.load()).toEqual({ mode: 'manual', scale: 1.75 });
  });
});
