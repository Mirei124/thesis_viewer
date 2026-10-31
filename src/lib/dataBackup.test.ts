import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertReadersClosed, DataBackupError, importLocalData, parseDataBackup, summarizeDataBackup, type DataBackup } from './dataBackup';
import { DEFAULT_MODEL_CONFIG } from './modelConfig';
import { newPaperQaSession } from './paperQa';

function empty(): DataBackup {
  return {
    format: 'thesis-viewer-backup', version: 1, createdAt: '2026-10-31T00:00:00.000Z',
    databases: {
      'thesis-viewer': { 'pdf-highlights': [] },
      'thesis-viewer-translations': { 'translation-cache': [], 'translation-jobs': [] },
      'thesis-viewer-overviews': { 'verified-overviews': [] },
      'thesis-viewer-reading-history': { entries: [], activities: [] },
      'thesis-viewer-paper-qa': { sessions: [] },
    }, settings: {}, localStorage: {},
  };
}
function parse(value: unknown) { return parseDataBackup(JSON.stringify(value)); }
function installApi(tabs: { url?: string; pendingUrl?: string }[] = []) {
  vi.stubGlobal('browser', {
    storage: { local: { get: vi.fn(async () => ({})), set: vi.fn(), remove: vi.fn() } },
    runtime: { getURL: (path: string) => `moz-extension://test-id/${path}` },
    tabs: { query: vi.fn(async () => tabs) },
  });
}
afterEach(() => vi.unstubAllGlobals());

describe('portable local-data backup validation', () => {
  it('round trips the complete empty schema and non-secret settings', () => {
    const backup = empty();
    backup.settings = {
      'model-config:v1': DEFAULT_MODEL_CONFIG, 'ui-locale:v1': 'zh-CN', 'theme-preference:v1': 'dark',
      'overview-auto-generate:v1': { threeLine: true, detailed: false }, 'arxivPdfAutoOpenEnabled': true,
      'reader-zoom:v1': { mode: 'manual', scale: 1.5 }, [`pdf-view:${'a'.repeat(64)}`]: { pageIndex: 2, rotation: 90 },
    };
    backup.localStorage = { 'reader-panel-widths:v1': '{"left":280,"right":440}', 'thesis-viewer:theme-preference:v1': 'dark' };
    expect(parse(backup)).toEqual(backup);
    expect(summarizeDataBackup(backup)).toEqual({ records: 0, settings: 9 });
  });
  it('restores interrupted answers without rewriting their committed message prefix', () => {
    const backup = empty(); const session = newPaperQaSession('doc', 'version');
    session.messages = [{ role: 'system', content: 'Original prompt' }, { role: 'user', content: 'Original paper' }];
    session.turns = [{ id: 'turn', question: 'Question', createdAt: 0, status: 'generating', text: 'Partial answer', sourceIds: ['P0001'] }];
    session.revision = 4;
    backup.databases['thesis-viewer-paper-qa'].sessions.push(session as unknown as Record<string, unknown>);
    const restored = parse(backup).databases['thesis-viewer-paper-qa'].sessions[0];
    expect(restored.revision).toBe(4); expect(restored.messages).toEqual(session.messages);
    expect(restored.turns).toEqual([{ ...session.turns[0], status: 'cancelled' }]);
    expect(session.turns[0].status).toBe('generating');
  });
  it('interrupts saved pending translation jobs while preserving completed caches', () => {
    const backup = empty();
    backup.databases['thesis-viewer-translations']['translation-jobs'] = [{ jobId: 'job', documentVersion: 'doc', stage: 'generating', readerSessionId: 'reader', selectedText: 'Source', neighborContext: '', targetLanguage: 'Chinese', model: 'model', promptVersion: 'v1', createdAt: 0, updatedAt: 0 }];
    expect(parse(backup).databases['thesis-viewer-translations']['translation-jobs'][0].stage).toBe('interrupted');
  });
  it('rejects unsupported versions, unknown databases, missing stores and duplicate IDs', () => {
    expect(() => parse({ ...empty(), version: 2 })).toThrow(DataBackupError);
    const extra = empty(); extra.databases.extra = {}; expect(() => parse(extra)).toThrow(DataBackupError);
    const missing = empty(); delete missing.databases['thesis-viewer']; expect(() => parse(missing)).toThrow(DataBackupError);
    const duplicate = empty(); const row = { id: '2026-10-31:hash', day: '2026-10-31', hash: 'hash' };
    duplicate.databases['thesis-viewer-reading-history'].activities = [row, row];
    expect(() => parse(duplicate)).toThrow(DataBackupError);
  });
  it('rejects credentials and prototype keys anywhere in structured data', () => {
    const backup = empty(); backup.settings['model-api-key:v1'] = 'not-a-real-key';
    expect(() => parse(backup)).toThrow(DataBackupError);
    backup.settings = { 'model-config:v1': { ...DEFAULT_MODEL_CONFIG, apiKey: 'not-a-real-key' } };
    expect(() => parse(backup)).toThrow(DataBackupError);
    expect(() => parseDataBackup(JSON.stringify(empty()).replace('"settings":{}', '"settings":{"__proto__":{"polluted":true}}'))).toThrow(DataBackupError);
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
  it('rejects credential-bearing model endpoints and malformed settings without writing', () => {
    for (const config of [
      { ...DEFAULT_MODEL_CONFIG, baseUrl: 'https://user:secret@example.com/v1' },
      { ...DEFAULT_MODEL_CONFIG, structuredOutput: 'false' },
      { ...DEFAULT_MODEL_CONFIG, contextLimit: -1 },
    ]) { const backup = empty(); backup.settings['model-config:v1'] = config; expect(() => parse(backup)).toThrow(DataBackupError); }
    const backup = empty(); backup.settings['reader-zoom:v1'] = { mode: 'manual', scale: 100 };
    expect(() => parse(backup)).toThrow(DataBackupError);
  });
  it('rejects unsafe history links and highlights with broken geometry', () => {
    const backup = empty();
    backup.databases['thesis-viewer-reading-history'].entries = [{ id: 'online:javascript:alert(1)', hash: 'hash', title: 'Title', titleSource: 'page', source: { kind: 'online', url: 'javascript:alert(1)' }, firstOpened: 1, lastOpened: 2, openCount: 1 }];
    expect(() => parse(backup)).toThrow(DataBackupError);
    backup.databases['thesis-viewer-reading-history'].entries = [];
    backup.databases['thesis-viewer']['pdf-highlights'] = [{ id: 'highlight', documentVersion: 'doc', quote: 'text', color: 'yellow', createdAt: 1, anchor: { pageIndex: 0, rects: [{ left: 4, right: 2, bottom: 1, top: 3 }] } }];
    expect(() => parse(backup)).toThrow(DataBackupError);
  });
  it('rejects malformed nested answers instead of importing unusable conversations', () => {
    const backup = empty(); const session = newPaperQaSession('doc', 'version');
    session.turns = [{ id: 'turn', question: 'Question', createdAt: 0, status: 'completed', text: 'Answer', sourceIds: [] }];
    const row = session as unknown as Record<string, unknown>;
    row.messages = [{ role: 'assistant', content: { image: 'unsupported' } }];
    backup.databases['thesis-viewer-paper-qa'].sessions = [row];
    expect(() => parse(backup)).toThrow(DataBackupError);
  });
  it('rejects excessively deep input and invalid JSON', () => {
    let nested: unknown = {}; for (let i = 0; i < 40; i++) nested = { nested };
    expect(() => parse(nested)).toThrow(DataBackupError);
    expect(() => parseDataBackup('{')).toThrow(DataBackupError);
  });
  it('revalidates programmatic imports before accessing browser storage', async () => {
    await expect(importLocalData({ ...empty(), version: 99 } as unknown as DataBackup)).rejects.toMatchObject({ code: 'INVALID_BACKUP' });
  });
});

describe('reader maintenance guard', () => {
  it('blocks loaded and pending readers from this extension only', async () => {
    installApi([{ url: 'moz-extension://test-id/reader.html?document=abc' }]);
    await expect(assertReadersClosed()).rejects.toMatchObject({ code: 'READERS_OPEN' });
    installApi([{ pendingUrl: 'moz-extension://test-id/reader.html#page=2' }]);
    await expect(assertReadersClosed()).rejects.toMatchObject({ code: 'READERS_OPEN' });
  });
  it('allows settings, unrelated extensions and regular PDF browser tabs', async () => {
    installApi([{ url: 'moz-extension://test-id/options.html' }, { url: 'moz-extension://another-id/reader.html' }, { url: 'https://arxiv.org/pdf/1234' }]);
    await expect(assertReadersClosed()).resolves.toBeUndefined();
  });
  it('fails closed when browser tabs cannot be checked', async () => {
    vi.stubGlobal('browser', { storage: { local: {} } });
    await expect(assertReadersClosed()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
});
