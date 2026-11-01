/**
 * The reader persists only user-created PDF highlight anchors.  In particular,
 * this store deliberately has no PDF bytes, extracted page text, or generated
 * content: the SHA-256 document version is the only document identifier.
 */

export type StoredPdfHighlightRect = {
  left: number;
  bottom: number;
  right: number;
  top: number;
};

export type PdfHighlightStyle = 'highlight' | 'underline';

/** Missing styles belong to pre-underline records and keep their original appearance. */
export function normalizePdfHighlightStyle(value: unknown): PdfHighlightStyle {
  return value === 'underline' ? 'underline' : 'highlight';
}

export type StoredPdfHighlight = {
  id: string;
  documentVersion: string;
  anchor: {
    pageIndex: number;
    rects: StoredPdfHighlightRect[];
  };
  quote: string;
  color: 'yellow' | 'green' | 'blue' | 'pink';
  style?: PdfHighlightStyle;
  createdAt: number;
};

const DATABASE_NAME = 'thesis-viewer';
const DATABASE_VERSION = 1;
const HIGHLIGHTS_STORE = 'pdf-highlights';

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) {
    return Promise.reject(new Error('IndexedDB is unavailable in this browser context.'));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(HIGHLIGHTS_STORE)) {
        const store = database.createObjectStore(HIGHLIGHTS_STORE, { keyPath: 'id' });
        store.createIndex('documentVersion', 'documentVersion', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the local highlight store.'));
    request.onblocked = () => reject(new Error('The local highlight store is blocked by another open reader page.'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise<T | undefined>((resolve, reject) => {
      const tx = database.transaction(HIGHLIGHTS_STORE, mode);
      const store = tx.objectStore(HIGHLIGHTS_STORE);
      let result: T | undefined;
      try {
        const request = run(store);
        if (request) request.onsuccess = () => { result = request.result; };
      } catch (error) {
        tx.abort();
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error('Local highlight transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local highlight transaction was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function loadPdfHighlights(documentVersion: string): Promise<StoredPdfHighlight[]> {
  const database = await openDatabase();
  try {
    return await new Promise<StoredPdfHighlight[]>((resolve, reject) => {
      const tx = database.transaction(HIGHLIGHTS_STORE, 'readonly');
      const request = tx.objectStore(HIGHLIGHTS_STORE).index('documentVersion').getAll(documentVersion);
      request.onsuccess = () => resolve(request.result as StoredPdfHighlight[]);
      request.onerror = () => reject(request.error ?? new Error('Could not read local highlights.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local highlight read was aborted.'));
    });
  } finally {
    database.close();
  }
}

export async function putPdfHighlight(highlight: StoredPdfHighlight): Promise<void> {
  await transaction('readwrite', (store) => store.put(highlight));
}

export async function deletePdfHighlight(id: string): Promise<void> {
  await transaction('readwrite', (store) => store.delete(id));
}

export async function clearPdfHighlights(documentVersion: string): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(HIGHLIGHTS_STORE, 'readwrite');
      const store = tx.objectStore(HIGHLIGHTS_STORE);
      const request = store.index('documentVersion').openKeyCursor(IDBKeyRange.only(documentVersion));
      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
          store.delete(cursor.primaryKey);
          cursor.continue();
        }
      };
      request.onerror = () => reject(request.error ?? new Error('Could not clear local highlights.'));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Local highlight cleanup failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('Local highlight cleanup was aborted.'));
    });
  } finally {
    database.close();
  }
}
