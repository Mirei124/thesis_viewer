import type { PdfBibliography } from './pdfBibliography';
export type ReadingSource = { kind: 'local' } | { kind: 'online'; url: string };
export type ReadingHistoryEntry = PdfBibliography & { id: string; hash: string; title: string; titleSource: 'metadata' | 'page' | 'filename'; source: ReadingSource; firstOpened: number; lastOpened: number; openCount: number };
export type ReadingActivity = { id: string; day: string; hash: string };
export type ReadingSnapshot = { entries: ReadingHistoryEntry[]; activities: ReadingActivity[] };
export function civilDay(date: Date): string { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`; }
export function recentDays(today = new Date(), count = 365): string[] {
  const day = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  day.setDate(day.getDate() - count + 1);
  return Array.from({ length: count }, () => { const result = civilDay(day); day.setDate(day.getDate() + 1); return result; });
}
export function normalizeHistoryUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe history URL');
  url.hash = ''; return url.href;
}
export function historyIdentity(hash: string, source: ReadingSource): string { return source.kind === 'local' ? `local:${hash}` : `online:${normalizeHistoryUrl(source.url)}`; }
export function updatedHistory(previous: ReadingHistoryEntry | undefined, input: Omit<ReadingHistoryEntry, 'id' | 'firstOpened' | 'lastOpened' | 'openCount'>, now: number): ReadingHistoryEntry {
  const source = input.source.kind === 'online' ? { kind: 'online' as const, url: normalizeHistoryUrl(input.source.url) } : input.source;
  const saved = previous?.hash === input.hash ? previous : undefined;
  return { ...input,
    authors: input.authors?.length ? input.authors : saved?.authors,
    authorsSource: input.authors?.length ? input.authorsSource : saved?.authorsSource,
    institutions: input.institutions?.length ? input.institutions : saved?.institutions,
    institutionsSource: input.institutions?.length ? input.institutionsSource : saved?.institutionsSource,
    source, id: historyIdentity(input.hash, source), firstOpened: previous?.firstOpened ?? now, lastOpened: Math.max(previous?.lastOpened ?? now, now), openCount: (previous?.openCount ?? 0) + 1 };
}
export function matchesReadingHistory(entry: ReadingHistoryEntry, query: string): boolean {
  const normalize = (text: string) => text.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const text = normalize([entry.title, ...(entry.authors ?? []), ...(entry.institutions ?? []), entry.source.kind === 'online' ? entry.source.url : ''].join(' '));
  return text.includes(normalize(query));
}
const DB = 'thesis-viewer-reading-history';
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('entries', { keyPath: 'id' }); request.result.createObjectStore('activities', { keyPath: 'id' }); };
    request.onerror = () => reject(request.error); request.onblocked = () => { blocked = true; reject(new Error('History database blocked')); };
    request.onsuccess = () => { if (blocked) { request.result.close(); return; } request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  });
}
export async function recordReading(input: Omit<ReadingHistoryEntry, 'id' | 'firstOpened' | 'lastOpened' | 'openCount'>, now = Date.now(), shouldRecord: () => boolean = () => true): Promise<void> {
  const db = await database();
  try { if (!shouldRecord()) return; await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['entries', 'activities'], 'readwrite');
    tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error ?? new Error('History write aborted')); tx.onerror = () => reject(tx.error);
    const entries = tx.objectStore('entries'); const id = historyIdentity(input.hash, input.source); const get = entries.get(id);
    get.onsuccess = () => { entries.put(updatedHistory(get.result, input, now)); const day = civilDay(new Date(now)); tx.objectStore('activities').put({ id: `${day}:${input.hash}`, day, hash: input.hash }); };
  }); } finally { db.close(); }
}
export async function readReadingHistory(): Promise<ReadingSnapshot> {
  const db = await database();
  try { return await new Promise((resolve, reject) => {
    const tx = db.transaction(['entries', 'activities'], 'readonly'); const entries = tx.objectStore('entries').getAll(); const activities = tx.objectStore('activities').getAll();
    tx.oncomplete = () => resolve({ entries: entries.result.sort((a: ReadingHistoryEntry, b: ReadingHistoryEntry) => b.lastOpened - a.lastOpened), activities: activities.result }); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function clearReadingHistory(): Promise<void> {
  const db = await database();
  try { await new Promise<void>((resolve, reject) => { const tx = db.transaction(['entries', 'activities'], 'readwrite'); tx.objectStore('entries').clear(); tx.objectStore('activities').clear(); tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); tx.onerror = () => reject(tx.error); }); } finally { db.close(); }
}
