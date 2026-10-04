import { MAX_ZOOM_SCALE, MIN_ZOOM_SCALE } from './readerZoom';

export type ReaderZoomPreference = { mode: 'manual'; scale: number } | { mode: 'auto' | 'fit-page' | 'fit-width' };
export const READER_ZOOM_KEY = 'reader-zoom:v1';
type StorageArea = { get(key: string): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void> };

export function parseReaderZoomPreference(value: unknown): ReaderZoomPreference {
  if (value && typeof value === 'object') {
    const input = value as Partial<{ mode: string; scale: number }>;
    if (input.mode === 'auto' || input.mode === 'fit-page' || input.mode === 'fit-width') return { mode: input.mode };
    if (input.mode === 'manual' && typeof input.scale === 'number' && Number.isFinite(input.scale) && input.scale >= MIN_ZOOM_SCALE && input.scale <= MAX_ZOOM_SCALE) return { mode: 'manual', scale: input.scale };
  }
  return { mode: 'auto' };
}

// Serialize this reader's writes so rapid toolbar changes cannot persist out of order.
export function createReaderZoomPreferences(storage: () => StorageArea | undefined) {
  let pendingWrite = Promise.resolve();
  return {
    async load(): Promise<ReaderZoomPreference> {
      await pendingWrite;
      try { return parseReaderZoomPreference((await storage()?.get(READER_ZOOM_KEY))?.[READER_ZOOM_KEY]); }
      catch { return { mode: 'auto' }; }
    },
    save(value: ReaderZoomPreference): Promise<void> {
      const preference = parseReaderZoomPreference(value);
      pendingWrite = pendingWrite.then(async () => { try { await storage()?.set({ [READER_ZOOM_KEY]: preference }); } catch { /* Reading remains available when storage fails. */ } });
      return pendingWrite;
    },
  };
}
