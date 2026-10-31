import { normalizeModelConfig } from './modelConfig';
import { nextStoredPaperQaSession, recoverPaperQaSession } from './paperQaRepository';
import type { PaperQaSession } from './paperQaTypes';

/** Portable data only. PDF binaries, host permissions and credentials are never backed up. */
export const MAX_DATA_BACKUP_BYTES = 100 * 1024 * 1024;
const SCHEMA = {
  'thesis-viewer': { version: 1, stores: { 'pdf-highlights': { key: 'id', index: 'documentVersion' } } },
  'thesis-viewer-translations': { version: 2, stores: { 'translation-cache': { key: 'id', index: '' }, 'translation-jobs': { key: 'jobId', index: 'documentVersion' } } },
  'thesis-viewer-overviews': { version: 1, stores: { 'verified-overviews': { key: 'id', index: '' } } },
  'thesis-viewer-reading-history': { version: 1, stores: { entries: { key: 'id', index: '' }, activities: { key: 'id', index: '' } } },
  'thesis-viewer-paper-qa': { version: 1, stores: { sessions: { key: 'id', index: 'documentKey' } } },
} as const;
type DatabaseName = keyof typeof SCHEMA;
type DataRecord = Record<string, unknown>;
export type DataBackup = {
  format: 'thesis-viewer-backup'; version: 1; createdAt: string;
  databases: Record<string, Record<string, DataRecord[]>>;
  settings: Record<string, unknown>; localStorage: Record<string, string>;
};
export class DataBackupError extends Error {
  constructor(public readonly code: 'INVALID_BACKUP' | 'READERS_OPEN' | 'STORAGE_UNAVAILABLE' | 'WRITE_FAILED' | 'PARTIAL_WRITE' | 'OPERATION_BUSY') {
    super(code); this.name = 'DataBackupError';
  }
}
const invalid = (): never => { throw new DataBackupError('INVALID_BACKUP'); };
const plain = (x: unknown): x is DataRecord => !!x && typeof x === 'object' && !Array.isArray(x);
const string = (x: unknown): x is string => typeof x === 'string';
const text = (x: unknown): x is string => string(x) && x.length > 0;
const integer = (x: unknown): x is number => Number.isSafeInteger(x) && (x as number) >= 0;
const strings = (x: unknown): x is string[] => Array.isArray(x) && x.every(string);
const oneOf = (x: unknown, values: readonly unknown[]) => values.includes(x);
const exactKeys = (x: DataRecord, keys: readonly string[]) => Object.keys(x).every(key => keys.includes(key));
const secretField = /^(?:__proto__|prototype|constructor|api[-_]?key|authorization|headers|password|credentials|pdfBytes|pdfData|accessToken|refreshToken)$/i;
const SETTINGS = ['model-config:v1', 'theme-preference:v1', 'ui-locale:v1', 'reader-zoom:v1', 'overview-auto-generate:v1', 'arxivPdfAutoOpenEnabled'];
const isSettingKey = (key: string) => SETTINGS.includes(key) || /^pdf-view:[a-f0-9]{64}$/.test(key);
const WEB_SETTINGS = ['reader-panel-widths:v1', 'thesis-viewer:theme-preference:v1'];

function safeTree(value: unknown, strip = false, depth = 0, budget = { left: 2_000_000 }): unknown {
  if (--budget.left < 0 || depth > 32) return invalid();
  if (value === null || typeof value === 'boolean' || string(value)) return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : invalid();
  if (Array.isArray(value)) return value.map(item => safeTree(item, strip, depth + 1, budget));
  if (!plain(value)) return invalid();
  const result: DataRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (secretField.test(key)) { if (!strip) invalid(); continue; }
    if (child === undefined && strip) continue;
    result[key] = safeTree(child, strip, depth + 1, budget);
  }
  return result;
}
function translationResult(value: unknown): boolean {
  return plain(value) && exactKeys(value, ['translation', 'uncertainty']) && text(value.translation)
    && (value.uncertainty === null || text(value.uncertainty));
}
function validRefs(value: unknown): boolean {
  return Array.isArray(value) && value.every(ref => plain(ref) && exactKeys(ref, ['alias', 'evidenceIds']) && text(ref.alias) && strings(ref.evidenceIds));
}
function validOverview(value: unknown): boolean {
  if (!plain(value) || !Array.isArray(value.uncertainties) || value.uncertainties.length !== 0) return false;
  if (value.kind === 'three_line') return exactKeys(value, ['kind', 'items', 'uncertainties']) && Array.isArray(value.items) && value.items.length === 3
    && value.items.every(item => plain(item) && exactKeys(item, ['role', 'status', 'text', 'evidenceIds', 'evidenceRefs']) && item.role === 'contribution' && item.status === 'available' && text(item.text) && strings(item.evidenceIds) && validRefs(item.evidenceRefs));
  return value.kind === 'detailed' && exactKeys(value, ['kind', 'sections', 'uncertainties']) && Array.isArray(value.sections)
    && value.sections.every(section => plain(section) && exactKeys(section, ['id', 'status', 'blocks']) && text(section.id) && section.status === 'available'
      && Array.isArray(section.blocks) && section.blocks.every(block => plain(block) && exactKeys(block, ['type', 'text', 'claimKind', 'evidenceIds', 'evidenceRefs'])
        && oneOf(block.type, ['paragraph', 'step', 'bullet', 'equation']) && text(block.text)
        && oneOf(block.claimKind, ['author_claim', 'source_fact', 'observed_result', 'inference']) && strings(block.evidenceIds) && validRefs(block.evidenceRefs)));
}
function validateRecord(db: DatabaseName, store: string, row: unknown): DataRecord {
  if (!plain(row)) return invalid();
  const shape = (SCHEMA[db].stores as Record<string, { key: string }>)[store];
  if (!shape || !text(row[shape.key])) return invalid();
  let valid = false;
  if (store === 'pdf-highlights') {
    valid = exactKeys(row, ['id', 'documentVersion', 'anchor', 'quote', 'color', 'createdAt']) && text(row.documentVersion)
      && string(row.quote) && oneOf(row.color, ['yellow', 'green', 'blue', 'pink']) && integer(row.createdAt)
      && plain(row.anchor) && exactKeys(row.anchor, ['pageIndex', 'rects']) && integer(row.anchor.pageIndex)
      && Array.isArray(row.anchor.rects) && row.anchor.rects.every(rect => plain(rect) && exactKeys(rect, ['left', 'bottom', 'right', 'top'])
        && ['left', 'bottom', 'right', 'top'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key]))
        && (rect.right as number) >= (rect.left as number) && (rect.top as number) >= (rect.bottom as number));
  } else if (store === 'activities') {
    valid = exactKeys(row, ['id', 'day', 'hash']) && text(row.hash) && string(row.day) && /^\d{4}-\d{2}-\d{2}$/.test(row.day)
      && row.id === `${row.day}:${row.hash}`;
  } else if (store === 'entries') {
    valid = exactKeys(row, ['id', 'hash', 'title', 'titleSource', 'source', 'firstOpened', 'lastOpened', 'openCount', 'authors', 'institutions', 'authorsSource', 'institutionsSource'])
      && text(row.hash) && string(row.title) && oneOf(row.titleSource, ['metadata', 'page', 'filename'])
      && integer(row.firstOpened) && integer(row.lastOpened) && integer(row.openCount) && row.openCount > 0
      && (row.authors === undefined || strings(row.authors)) && (row.institutions === undefined || strings(row.institutions))
      && (row.authorsSource === undefined || oneOf(row.authorsSource, ['metadata', 'page'])) && (row.institutionsSource === undefined || oneOf(row.institutionsSource, ['metadata', 'page']))
      && plain(row.source) && ((row.source.kind === 'local' && exactKeys(row.source, ['kind']) && row.id === `local:${row.hash}`)
        || (row.source.kind === 'online' && exactKeys(row.source, ['kind', 'url']) && text(row.source.url) && validHttps(row.source.url) && row.id === `online:${row.source.url}`));
  } else if (store === 'translation-cache' || store === 'translation-jobs') {
    const job = store === 'translation-jobs';
    valid = exactKeys(row, job ? ['jobId', 'documentVersion', 'stage', 'readerSessionId', 'selectedText', 'neighborContext', 'targetLanguage', 'model', 'promptVersion', 'result', 'error', 'createdAt', 'updatedAt']
      : ['id', 'documentVersion', 'selectedText', 'neighborContext', 'targetLanguage', 'model', 'promptVersion', 'result', 'createdAt'])
      && text(row.documentVersion) && string(row.selectedText) && string(row.neighborContext) && oneOf(row.targetLanguage, ['Chinese', 'English'])
      && text(row.model) && text(row.promptVersion) && integer(row.createdAt)
      && (job ? text(row.readerSessionId) && integer(row.updatedAt) && oneOf(row.stage, ['preparing', 'generating', 'success', 'failed', 'cancelled', 'interrupted'])
        && (row.result === undefined || translationResult(row.result)) && (row.error === undefined || string(row.error)) : translationResult(row.result));
    if (valid && job && oneOf(row.stage, ['preparing', 'generating'])) row = { ...row, stage: 'interrupted' };
  } else if (store === 'verified-overviews') {
    valid = exactKeys(row, ['id', 'schema', 'result', 'createdAt']) && row.schema === 'overview-cache-v1' && integer(row.createdAt) && validOverview(row.result);
  } else if (store === 'sessions') {
    if (!exactKeys(row, ['id', 'documentKey', 'sourceVersion', 'protocolVersion', 'title', 'createdAt', 'updatedAt', 'scope', 'sourceIds', 'messages', 'turns', 'revision']) || !integer(row.revision)) return invalid();
    try {
      // Reuse the repository's complete nested contract and credential whitelist.
      const checked = nextStoredPaperQaSession({ ...row, revision: 0 } as PaperQaSession);
      checked.revision = row.revision;
      return recoverPaperQaSession(checked);
    } catch { return invalid(); }
  }
  if (!valid) return invalid();
  return row as DataRecord;
}
function validHttps(value: string): boolean {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.hash; } catch { return false; }
}
function setting(key: string, value: unknown): unknown {
  if (!isSettingKey(key)) return invalid();
  if (key === 'model-config:v1') {
    if (!plain(value) || !string(value.baseUrl) || !string(value.model) || typeof value.structuredOutput !== 'boolean' || (value.semanticReview !== undefined && typeof value.semanticReview !== 'boolean') || !exactKeys(value, ['baseUrl', 'model', 'structuredOutput', 'semanticReview', 'contextLimit', 'outputLimit'])) return invalid();
    try { return normalizeModelConfig(value as Parameters<typeof normalizeModelConfig>[0]); } catch { return invalid(); }
  }
  if (key === 'theme-preference:v1') return oneOf(value, ['light', 'dark', 'system']) ? value : invalid();
  if (key === 'ui-locale:v1') return oneOf(value, ['en', 'zh-CN']) ? value : invalid();
  if (key === 'arxivPdfAutoOpenEnabled') return typeof value === 'boolean' ? value : invalid();
  if (key === 'overview-auto-generate:v1') return plain(value) && exactKeys(value, ['threeLine', 'detailed']) && typeof value.threeLine === 'boolean' && typeof value.detailed === 'boolean' ? value : invalid();
  if (key === 'reader-zoom:v1') {
    if (!plain(value)) return invalid();
    return value.mode === 'manual' ? exactKeys(value, ['mode', 'scale']) && typeof value.scale === 'number' && value.scale >= 0.25 && value.scale <= 4 ? value : invalid()
      : oneOf(value.mode, ['auto', 'fit-page', 'fit-width']) && exactKeys(value, ['mode']) ? value : invalid();
  }
  return plain(value) && exactKeys(value, ['pageIndex', 'pageOffset', 'rotation', 'scale']) && integer(value.pageIndex)
    && oneOf(value.rotation, [0, 90, 180, 270]) && (value.pageOffset === undefined || typeof value.pageOffset === 'number' && value.pageOffset >= 0 && value.pageOffset <= 1)
    && (value.scale === undefined || typeof value.scale === 'number' && value.scale > 0 && value.scale <= 4) ? value : invalid();
}
function webSetting(key: string, value: unknown): string {
  if (!WEB_SETTINGS.includes(key) || !string(value)) return invalid();
  if (key === 'thesis-viewer:theme-preference:v1') return oneOf(value, ['light', 'dark', 'system']) ? value : invalid();
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { return invalid(); }
  return plain(parsed) && exactKeys(parsed, ['left', 'right']) && ['left', 'right'].every(side => typeof parsed[side] === 'number' && Number.isFinite(parsed[side]) && (parsed[side] as number) > 0 && (parsed[side] as number) <= 2000) ? value : invalid();
}
/** Parse and validate every record before any write is permitted. Unknown versions and stores fail closed. */
export function parseDataBackup(contents: string): DataBackup {
  if (contents.length > MAX_DATA_BACKUP_BYTES || new TextEncoder().encode(contents).byteLength > MAX_DATA_BACKUP_BYTES) return invalid();
  let input: unknown; try { input = safeTree(JSON.parse(contents)); } catch { return invalid(); }
  if (!plain(input) || !exactKeys(input, ['format', 'version', 'createdAt', 'databases', 'settings', 'localStorage']) || input.format !== 'thesis-viewer-backup' || input.version !== 1
    || !string(input.createdAt) || !Number.isFinite(Date.parse(input.createdAt)) || !plain(input.databases) || !plain(input.settings) || !plain(input.localStorage)) return invalid();
  if (Object.keys(input.databases).length !== Object.keys(SCHEMA).length) return invalid();
  let total = 0;
  const databases: DataBackup['databases'] = {};
  for (const [db, schema] of Object.entries(SCHEMA)) {
    const source = input.databases[db];
    if (!plain(source) || Object.keys(source).length !== Object.keys(schema.stores).length) return invalid();
    databases[db] = {};
    for (const [store, descriptor] of Object.entries(schema.stores)) {
      const rows = source[store];
      if (!Array.isArray(rows) || (total += rows.length) > 100_000) return invalid();
      const seen = new Set<unknown>();
      databases[db][store] = rows.map(row => {
        const checked = validateRecord(db as DatabaseName, store, row);
        if (seen.has(checked[descriptor.key])) return invalid();
        seen.add(checked[descriptor.key]); return checked;
      });
    }
  }
  const settings = Object.fromEntries(Object.entries(input.settings).map(([key, value]) => [key, setting(key, value)]));
  const local = Object.fromEntries(Object.entries(input.localStorage).map(([key, value]) => [key, webSetting(key, value)]));
  return { format: 'thesis-viewer-backup', version: 1, createdAt: input.createdAt, databases, settings, localStorage: local };
}
export function summarizeDataBackup(backup: DataBackup): { records: number; settings: number } {
  return { records: Object.values(backup.databases).flatMap(stores => Object.values(stores)).reduce((sum, rows) => sum + rows.length, 0), settings: Object.keys(backup.settings).length + Object.keys(backup.localStorage).length };
}

type Area = { get(keys: null): Promise<Record<string, unknown>>; set(values: Record<string, unknown>): Promise<void>; remove(keys: string[]): Promise<void> };
type ExtensionApi = { storage?: { local?: Area; session?: Area }; runtime?: { getURL(path: string): string }; tabs?: { query(query: object): Promise<{ url?: string; pendingUrl?: string }[]> } };
function api(): ExtensionApi {
  const root = globalThis as typeof globalThis & { browser?: ExtensionApi; chrome?: ExtensionApi };
  const result = root.browser ?? root.chrome;
  if (!result?.storage?.local) throw new DataBackupError('STORAGE_UNAVAILABLE');
  return result;
}
export async function assertReadersClosed(): Promise<void> {
  const extension = api();
  if (!extension.tabs || !extension.runtime) throw new DataBackupError('STORAGE_UNAVAILABLE');
  try {
    const reader = new URL(extension.runtime.getURL('reader.html'));
    const open = (await extension.tabs.query({})).some(tab => [tab.url, tab.pendingUrl].some(value => {
      if (!value) return false;
      try { const url = new URL(value); return url.protocol === reader.protocol && url.host === reader.host && url.pathname === reader.pathname; } catch { return false; }
    }));
    if (open) throw new DataBackupError('READERS_OPEN');
  } catch (error) { if (error instanceof DataBackupError) throw error; throw new DataBackupError('STORAGE_UNAVAILABLE'); }
}
async function openDatabase(name: DatabaseName): Promise<IDBDatabase> {
  if (!globalThis.indexedDB) throw new DataBackupError('STORAGE_UNAVAILABLE');
  return new Promise((resolve, reject) => {
    const schema = SCHEMA[name]; const request = indexedDB.open(name, schema.version); let rejected = false;
    request.onupgradeneeded = () => {
      for (const [storeName, shape] of Object.entries(schema.stores)) {
        if (request.result.objectStoreNames.contains(storeName)) continue;
        const store = request.result.createObjectStore(storeName, { keyPath: shape.key });
        if (shape.index) store.createIndex(shape.index, shape.index, { unique: false });
      }
    };
    request.onsuccess = () => {
      if (rejected) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close(); resolve(request.result);
    };
    request.onerror = request.onblocked = () => { rejected = true; reject(new DataBackupError('STORAGE_UNAVAILABLE')); };
  });
}
async function readDatabase(db: IDBDatabase, name: DatabaseName): Promise<Record<string, DataRecord[]>> {
  return new Promise((resolve, reject) => {
    const stores = Object.keys(SCHEMA[name].stores); const tx = db.transaction(stores, 'readonly');
    const requests = stores.map(store => [store, tx.objectStore(store).getAll()] as const);
    tx.oncomplete = () => resolve(Object.fromEntries(requests.map(([store, req]) => [store, req.result])));
    tx.onerror = tx.onabort = () => reject(new DataBackupError('STORAGE_UNAVAILABLE'));
  });
}
async function snapshot(): Promise<DataBackup> {
  const settings = await api().storage!.local!.get(null);
  const databases: DataBackup['databases'] = {};
  for (const name of Object.keys(SCHEMA) as DatabaseName[]) {
    const db = await openDatabase(name);
    try { databases[name] = await readDatabase(db, name); } finally { db.close(); }
  }
  const selected = Object.fromEntries(Object.entries(settings).filter(([key]) => isSettingKey(key)));
  const local = Object.fromEntries(WEB_SETTINGS.flatMap(key => {
    const value = globalThis.localStorage?.getItem(key); return value === null || value === undefined ? [] : [[key, value]];
  }));
  return { format: 'thesis-viewer-backup', version: 1, createdAt: new Date().toISOString(), databases, settings: selected, localStorage: local };
}
let running = false;
async function exclusive<T>(run: () => Promise<T>): Promise<T> {
  if (running) throw new DataBackupError('OPERATION_BUSY');
  running = true;
  try {
    if (globalThis.navigator?.locks) return await navigator.locks.request('thesis-viewer-data-maintenance', run);
    return await run();
  } finally { running = false; }
}
export async function exportLocalData(): Promise<DataBackup> {
  return exclusive(async () => parseDataBackup(JSON.stringify(safeTree(await snapshot(), true))));
}
/** Writes stay atomic within each database; a later failure rolls back earlier databases before reporting failure. */
async function writeDatabase(name: DatabaseName, rows: Record<string, DataRecord[]>, mode: 'merge' | 'replace'): Promise<void> {
  const db = await openDatabase(name);
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(Object.keys(SCHEMA[name].stores), 'readwrite');
      tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(new DataBackupError('WRITE_FAILED'));
      try { for (const [storeName, records] of Object.entries(rows)) {
        const store = tx.objectStore(storeName); if (mode === 'replace') store.clear();
        for (const row of records) store.put(row);
      } } catch { tx.abort(); reject(new DataBackupError('WRITE_FAILED')); }
    });
  } finally { db.close(); }
}
type Journal = {
  databases: Set<DatabaseName>; local: Map<string, unknown>; session: Map<string, unknown>; web: Map<string, string | null>;
};
async function restoreArea(area: Area, before: Record<string, unknown>, changed: Map<string, unknown>): Promise<void> {
  const current = await area.get(null); const values: Record<string, unknown> = {}, remove: string[] = [];
  for (const [key, expected] of changed) {
    // Another settings page may have edited a key: do not overwrite that newer value.
    if (JSON.stringify(current[key]) !== JSON.stringify(expected)) continue;
    if (before[key] === undefined) remove.push(key); else values[key] = before[key];
  }
  if (remove.length) await area.remove(remove);
  if (Object.keys(values).length) await area.set(values);
}
async function restore(before: DataBackup, local: Record<string, unknown>, session: Record<string, unknown> | undefined, web: Record<string, string>, journal: Journal): Promise<void> {
  for (const name of journal.databases) await writeDatabase(name, before.databases[name], 'replace');
  const storage = api().storage!;
  if (journal.local.size) await restoreArea(storage.local!, local, journal.local);
  if (session && storage.session && journal.session.size) await restoreArea(storage.session, session, journal.session);
  for (const [key, expected] of journal.web) {
    if (globalThis.localStorage?.getItem(key) !== expected) continue;
    if (web[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, web[key]);
  }
}
async function mutate(run: (before: DataBackup, journal: Journal) => Promise<{ imported: number; skipped: number } | void>): Promise<{ imported: number; skipped: number } | void> {
  return exclusive(async () => {
    await assertReadersClosed();
    // The rollback snapshot is intentionally raw. Corrupt/legacy data must not block clearing,
    // and rollback must not sanitize or normalize records that were already present.
    const before = await snapshot();
    const storage = api().storage!; const local = await storage.local!.get(null); const session = await storage.session?.get(null);
    const web = Object.fromEntries(Array.from({ length: globalThis.localStorage?.length ?? 0 }, (_, index) => {
      const key = localStorage.key(index)!; return [key, localStorage.getItem(key)!];
    }));
    const journal: Journal = { databases: new Set(), local: new Map(), session: new Map(), web: new Map() };
    await assertReadersClosed();
    try { return await run(before, journal); }
    catch {
      try { await restore(before, local, session, web, journal); } catch { throw new DataBackupError('PARTIAL_WRITE'); }
      throw new DataBackupError('WRITE_FAILED');
    }
  });
}
export async function importLocalData(backup: DataBackup): Promise<{ imported: number; skipped: number }> {
  // Revalidate even when callers bypass the file parser.
  const incoming = parseDataBackup(JSON.stringify(backup));
  return await mutate(async (before, journal) => {
    let imported = 0, skipped = 0;
    for (const [name, stores] of Object.entries(incoming.databases)) {
      const selected: Record<string, DataRecord[]> = {};
      for (const [store, records] of Object.entries(stores)) {
        const key = (SCHEMA[name as DatabaseName].stores as Record<string, { key: string }>)[store].key;
        const existing = new Set(before.databases[name][store].map(row => row[key]));
        selected[store] = records.filter(row => { if (existing.has(row[key])) { skipped++; return false; } imported++; return true; });
      }
      if (Object.values(selected).some(rows => rows.length)) {
        journal.databases.add(name as DatabaseName);
        await writeDatabase(name as DatabaseName, selected, 'merge');
      }
    }
    const area = api().storage!.local!; const existing = await area.get(null);
    const additions = Object.fromEntries(Object.entries(incoming.settings).filter(([key]) => existing[key] === undefined).map(([key, value]) => [key,
      key === 'overview-auto-generate:v1' ? { threeLine: false, detailed: false } : key === 'arxivPdfAutoOpenEnabled' ? false : value]));
    if (Object.keys(additions).length) {
      for (const [key, value] of Object.entries(additions)) journal.local.set(key, value);
      await area.set(additions);
    }
    for (const [key, value] of Object.entries(incoming.localStorage)) if (globalThis.localStorage?.getItem(key) === null) { journal.web.set(key, value); localStorage.setItem(key, value); }
    return { imported, skipped };
  }) as { imported: number; skipped: number };
}
export async function clearLocalData(resetSettings = false): Promise<void> {
  await mutate(async (_before, journal) => {
    for (const [name, schema] of Object.entries(SCHEMA)) {
      journal.databases.add(name as DatabaseName);
      await writeDatabase(name as DatabaseName, Object.fromEntries(Object.keys(schema.stores).map(store => [store, []])), 'replace');
    }
    const storage = api().storage!; const values = await storage.local!.get(null);
    const keys = Object.keys(values).filter(key => resetSettings || key.startsWith('pdf-view:'));
    if (keys.length) { keys.forEach(key => journal.local.set(key, undefined)); await storage.local!.remove(keys); }
    if (resetSettings) {
      if (storage.session) {
        const sessionKeys = Object.keys(await storage.session.get(null));
        sessionKeys.forEach(key => journal.session.set(key, undefined)); await storage.session.remove(sessionKeys);
      }
      for (let i = 0; i < (globalThis.localStorage?.length ?? 0); i++) journal.web.set(localStorage.key(i)!, null);
      globalThis.localStorage?.clear();
    }
  });
}
