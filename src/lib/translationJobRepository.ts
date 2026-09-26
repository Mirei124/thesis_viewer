import type { TranslationResult } from './translationResponse';

export type TranslationJobStage = 'preparing' | 'generating' | 'success' | 'failed' | 'cancelled' | 'interrupted';

export type StoredTranslationJob = {
  jobId: string;
  documentVersion: string;
  stage: TranslationJobStage;
  readerSessionId: string;
  selectedText: string;
  neighborContext: string;
  targetLanguage: 'Chinese' | 'English';
  model: string;
  promptVersion: string;
  result?: TranslationResult;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

const DATABASE_NAME = 'thesis-viewer-translations';
const DATABASE_VERSION = 2;
const STORE_NAME = 'translation-jobs';
const CACHE_STORE_NAME = 'translation-cache';
const ACTIVE_STAGES = new Set<TranslationJobStage>(['preparing', 'generating']);

/** Whitelist the durable contract so callers cannot accidentally persist keys or headers. */
export function translationJobForStorage(job: StoredTranslationJob): StoredTranslationJob {
  return {
    jobId: job.jobId,
    documentVersion: job.documentVersion,
    stage: job.stage,
    readerSessionId: job.readerSessionId,
    selectedText: job.selectedText,
    neighborContext: job.neighborContext,
    targetLanguage: job.targetLanguage,
    model: job.model,
    promptVersion: job.promptVersion,
    ...(job.stage === 'success' && job.result ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(CACHE_STORE_NAME)) database.createObjectStore(CACHE_STORE_NAME, { keyPath: 'id' });
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const store = database.createObjectStore(STORE_NAME, { keyPath: 'jobId' });
        store.createIndex('documentVersion', 'documentVersion', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local translation-job store.'));
    request.onblocked = () => reject(new Error('The local translation-job store is blocked by another open reader page.'));
  });
}

async function write(update: (store: IDBObjectStore) => void): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      try { update(tx.objectStore(STORE_NAME)); } catch (error) { tx.abort(); reject(error); return; }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local translation-job write failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local translation-job write was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function createTranslationJob(job: StoredTranslationJob): Promise<void> {
  await write((store) => store.put(translationJobForStorage(job)));
}

export async function updateTranslationJob(jobId: string, stage: TranslationJobStage, options: { result?: TranslationResult; error?: string } = {}): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(jobId);
      request.onsuccess = () => {
        const job = request.result as StoredTranslationJob | undefined;
        if (!job) return;
        const next: StoredTranslationJob = { ...job, stage, updatedAt: Date.now() };
        if (options.result) next.result = options.result;
        if (options.error) next.error = options.error;
        else if (stage !== 'failed') delete next.error;
        if (stage !== 'success') delete next.result;
        store.put(translationJobForStorage(next));
      };
      request.onerror = () => reject(request.error ?? new Error('Could not read the local translation job.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local translation-job update failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local translation-job update was aborted.'));
    });
  } finally {
    database.close();
  }
}

/** A new reader never resumes billable work; any prior active checkpoint is terminally interrupted. */
export async function interruptActiveTranslationJobs(documentVersion: string, readerSessionId?: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.index('documentVersion').openCursor(IDBKeyRange.only(documentVersion));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const job = cursor.value as StoredTranslationJob;
        if (ACTIVE_STAGES.has(job.stage) && (!readerSessionId || job.readerSessionId === readerSessionId)) {
          cursor.update(translationJobForStorage({ ...job, stage: 'interrupted', error: 'The reader closed or refreshed before this translation finished.', updatedAt: Date.now() }));
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error ?? new Error('Could not inspect local translation jobs.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local translation-job interruption update failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local translation-job interruption update was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function loadSuccessfulTranslationJobs(documentVersion: string): Promise<StoredTranslationJob[]> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredTranslationJob[]>((resolve, reject) => {
      const tx = database.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).index('documentVersion').getAll(documentVersion);
      request.onsuccess = () => resolve((request.result as StoredTranslationJob[])
        .filter((job) => job.stage === 'success' && !!job.result)
        .sort((left, right) => right.updatedAt - left.updatedAt));
      request.onerror = () => reject(request.error ?? new Error('Could not read local translation jobs.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local translation-job read was aborted.'));
    });
  } finally {
    database.close();
  }
}
