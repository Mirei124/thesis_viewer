import type { TranslationResult } from './translationResponse';

export type TranslationCacheInput = {
  documentVersion: string;
  selectedText: string;
  neighborContext: string;
  targetLanguage: 'Chinese' | 'English';
  model: string;
  promptVersion: string;
};

type StoredTranslation = TranslationCacheInput & {
  id: string;
  result: TranslationResult;
  createdAt: number;
};

const DATABASE_NAME = 'thesis-viewer-translations';
const STORE_NAME = 'translation-cache';
const JOB_STORE_NAME = 'translation-jobs';

/** This deterministic key deliberately contains no endpoint, API key, or headers. */
export function translationCacheKey(input: TranslationCacheInput): string {
  return JSON.stringify([
    input.documentVersion,
    input.selectedText,
    input.neighborContext,
    input.targetLanguage,
    input.model,
    input.promptVersion,
  ]);
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
  return new Promise((resolve, reject) => {
  // Keep this version aligned with translationJobRepository: both stores share
  // one database so existing cache entries survive the job-store migration.
  const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      // Either repository may open a fresh database first, so the shared v2
      // schema must create both stores in either upgrade path.
      if (!request.result.objectStoreNames.contains(JOB_STORE_NAME)) {
        const store = request.result.createObjectStore(JOB_STORE_NAME, { keyPath: 'jobId' });
        store.createIndex('documentVersion', 'documentVersion', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local translation cache.'));
  });
}

export async function loadCachedTranslation(input: TranslationCacheInput): Promise<TranslationResult | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<TranslationResult | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(translationCacheKey(input));
      request.onsuccess = () => resolve((request.result as StoredTranslation | undefined)?.result);
      request.onerror = () => reject(request.error ?? new Error('Could not read the local translation cache.'));
    });
  } finally {
    database.close();
  }
}

export async function cacheTranslation(input: TranslationCacheInput, result: TranslationResult): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ ...input, id: translationCacheKey(input), result, createdAt: Date.now() } satisfies StoredTranslation);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Could not write the local translation cache.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('The local translation-cache transaction was aborted.'));
    });
  } finally {
    database.close();
  }
}
