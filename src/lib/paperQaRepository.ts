import type { PaperQaSession, PaperQaSessionSummary } from './paperQaTypes';
import { PAPER_QA_PROTOCOL_VERSION } from './paperQa';

const DATABASE = 'thesis-viewer-paper-qa';
const STORE = 'sessions';
/** Source-context messages alone are not a conversation; retain actual questions even when answers fail. */
export function hasPaperQaQuestions(session: Pick<PaperQaSession, 'turns'>): boolean {
  return session.turns.some(turn => turn.question.trim().length > 0);
}
export class PaperQaSessionConflictError extends Error {
  constructor() { super('paper-qa-session-conflict'); this.name = 'PaperQaSessionConflictError'; }
}
/** Interrupted partial output remains readable, but is never committed as an assistant message. */
export function recoverPaperQaSession(session: PaperQaSession): PaperQaSession {
  const result = sessionData(session);
  result.turns = result.turns.map(turn => turn.status === 'generating' ? { ...turn, status: 'cancelled' as const } : turn);
  return result;
}
function validSession(value: unknown): value is PaperQaSession {
  if (!value || typeof value !== 'object') return false;
  const session = value as Partial<PaperQaSession>;
  return typeof session.id === 'string' && typeof session.documentKey === 'string' && typeof session.sourceVersion === 'string'
    && session.protocolVersion === PAPER_QA_PROTOCOL_VERSION && typeof session.title === 'string'
    && Number.isFinite(session.createdAt) && Number.isFinite(session.updatedAt)
    && ['pre_experiments', 'body', 'full'].includes(String(session.scope))
    && Array.isArray(session.sourceIds) && session.sourceIds.every(id => typeof id === 'string')
    && Array.isArray(session.messages) && session.messages.every(message => message && ['system', 'user', 'assistant'].includes(message.role) && typeof message.content === 'string')
    && Array.isArray(session.turns) && session.turns.every(turn => turn && typeof turn.id === 'string' && typeof turn.question === 'string' && typeof turn.text === 'string'
      && Number.isFinite(turn.createdAt) && ['generating', 'completed', 'cancelled', 'error'].includes(turn.status)
      && Array.isArray(turn.sourceIds) && turn.sourceIds.every(id => typeof id === 'string')
      && (!turn.selection || typeof turn.selection.text === 'string' && Number.isSafeInteger(turn.selection.pageIndex) && turn.selection.pageIndex >= 0)
      && (!turn.blocks || Array.isArray(turn.blocks) && turn.blocks.every(block => block && typeof block.text === 'string'
        && Array.isArray(block.sources) && block.sources.every(id => typeof id === 'string')))
      && (turn.answerStatus === undefined || ['answered', 'partial', 'insufficient'].includes(turn.answerStatus))
      && (turn.missing === undefined || typeof turn.missing === 'string')
      && (turn.error === undefined || typeof turn.error === 'string'))
    && Number.isSafeInteger(session.revision) && session.revision! >= 0;
}
/** Compare-and-swap prevents another reader tab from silently overwriting this conversation. */
export function nextStoredPaperQaSession(session: PaperQaSession, previous?: PaperQaSession): PaperQaSession {
  if (!validSession(session)) throw new Error('Invalid paper QA session');
  if (previous && (previous.documentKey !== session.documentKey || previous.sourceVersion !== session.sourceVersion
    || previous.revision !== session.revision)) throw new PaperQaSessionConflictError();
  // A missing non-new revision was deleted elsewhere: never resurrect it through a late stream checkpoint.
  if (!previous && session.revision !== 0) throw new PaperQaSessionConflictError();
  const data = sessionData(session);
  data.revision = session.revision + 1;
  return data;
}
/** Persist the conversation contract only, never incidental credentials or document handles. */
function sessionData(session: PaperQaSession): PaperQaSession {
  return {
    id: session.id, documentKey: session.documentKey, sourceVersion: session.sourceVersion, protocolVersion: session.protocolVersion,
    title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, scope: session.scope, revision: session.revision,
    sourceIds: [...session.sourceIds], messages: session.messages.map(message => ({ role: message.role, content: message.content })),
    turns: session.turns.map(turn => ({
      id: turn.id, question: turn.question, createdAt: turn.createdAt, status: turn.status, text: turn.text, sourceIds: [...turn.sourceIds],
      ...(turn.selection ? { selection: { text: turn.selection.text, pageIndex: turn.selection.pageIndex } } : {}),
      ...(turn.blocks ? { blocks: turn.blocks.map(block => ({ text: block.text, sources: [...block.sources] })) } : {}),
      ...(turn.answerStatus ? { answerStatus: turn.answerStatus } : {}), ...(typeof turn.missing === 'string' ? { missing: turn.missing } : {}),
      ...(typeof turn.error === 'string' ? { error: turn.error } : {}),
      ...(turn.usage ? { usage: Object.fromEntries(Object.entries(turn.usage).filter(([key, value]) => ['promptTokens', 'completionTokens', 'totalTokens', 'promptCacheHitTokens', 'promptCacheMissTokens'].includes(key) && Number.isSafeInteger(value) && value! >= 0)) } : {}),
    })),
  };
}
async function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    let blocked = false;
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('documentKey', 'documentKey', { unique: false });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Paper QA database blocked')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}
/** List metadata must not retain every conversation's paper messages and answer bodies. */
export function summarizePaperQaSession(session: PaperQaSession): PaperQaSessionSummary {
  return {
    id: session.id, documentKey: session.documentKey, sourceVersion: session.sourceVersion, protocolVersion: session.protocolVersion,
    title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, scope: session.scope, revision: session.revision,
  };
}
export async function listPaperQaSessionSummaries(documentKey: string): Promise<PaperQaSessionSummary[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      // Read and prune in one transaction so another tab's first saved question cannot be deleted by a stale list.
      const transaction = db.transaction(STORE, 'readwrite');
      const request = transaction.objectStore(STORE).index('documentKey').openCursor(documentKey);
      const summaries: PaperQaSessionSummary[] = [];
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (validSession(cursor.value) && cursor.value.documentKey === documentKey) {
          if (hasPaperQaQuestions(cursor.value)) summaries.push(summarizePaperQaSession(cursor.value));
          else cursor.delete();
        }
        cursor.continue();
      };
      transaction.oncomplete = () => resolve(summaries.sort((a, b) => b.updatedAt - a.updatedAt));
      transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function loadPaperQaSession(id: string, documentKey: string): Promise<PaperQaSession | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(id);
      transaction.oncomplete = () => resolve(validSession(request.result) && request.result.documentKey === documentKey && hasPaperQaQuestions(request.result) ? recoverPaperQaSession(request.result) : undefined);
      transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function listPaperQaSessions(documentKey: string): Promise<PaperQaSession[]> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).index('documentKey').getAll(documentKey);
      transaction.oncomplete = () => resolve(request.result.filter(validSession).filter(session => session.documentKey === documentKey && hasPaperQaQuestions(session)).map(recoverPaperQaSession).sort((a, b) => b.updatedAt - a.updatedAt));
      transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function putPaperQaSession(session: PaperQaSession): Promise<PaperQaSession> {
  if (!validSession(session)) throw new Error('Invalid paper QA session');
  if (!hasPaperQaQuestions(session)) return sessionData(session);
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      let result: PaperQaSession | undefined, failure: unknown;
      const store = transaction.objectStore(STORE), get = store.get(session.id);
      get.onsuccess = () => {
        try {
          if (get.result !== undefined && !validSession(get.result)) throw new Error('Invalid stored paper QA session');
          result = nextStoredPaperQaSession(session, get.result); store.put(result);
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve(result!);
      transaction.onabort = () => reject(failure ?? transaction.error ?? new Error('Paper QA write aborted'));
      transaction.onerror = () => reject(failure ?? transaction.error);
    });
  } finally { db.close(); }
}
export async function deletePaperQaSession(id: string, documentKey: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite'); const store = transaction.objectStore(STORE); const get = store.get(id);
      get.onsuccess = () => { if (get.result?.documentKey === documentKey) store.delete(id); };
      transaction.oncomplete = () => resolve(); transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
