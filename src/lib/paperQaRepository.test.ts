import { describe, expect, it } from 'vitest';
import { newPaperQaSession } from './paperQa';
import { nextStoredPaperQaSession, PaperQaSessionConflictError, recoverPaperQaSession, summarizePaperQaSession } from './paperQaRepository';
import type { PaperQaSession } from './paperQaTypes';

describe('paper QA repository lifecycle and compare-and-swap', () => {
  it('increments revisions and rejects lost updates from a second tab', () => {
    const original = newPaperQaSession('doc', 'source-version');
    const first = nextStoredPaperQaSession(original);
    expect(first.revision).toBe(1);
    const second = nextStoredPaperQaSession(first, first);
    expect(second.revision).toBe(2);
    expect(() => nextStoredPaperQaSession(first, second)).toThrow(PaperQaSessionConflictError);
    expect(original.revision).toBe(0);
  });
  it('does not resurrect a conversation deleted while a stream checkpoint was pending', () => {
    const saved = nextStoredPaperQaSession(newPaperQaSession('doc', 'version'));
    expect(() => nextStoredPaperQaSession(saved)).toThrow(PaperQaSessionConflictError);
  });
  it('rejects cross-document writes and registry changes to an existing ID', () => {
    const saved = nextStoredPaperQaSession(newPaperQaSession('doc', 'version'));
    expect(() => nextStoredPaperQaSession({ ...saved, documentKey: 'other' }, saved)).toThrow(PaperQaSessionConflictError);
    expect(() => nextStoredPaperQaSession({ ...saved, sourceVersion: 'different' }, saved)).toThrow(PaperQaSessionConflictError);
  });
  it('restores interrupted partial output as cancelled without adding invalid assistant JSON to history', () => {
    const session = newPaperQaSession('doc', 'version');
    session.messages = [{ role: 'system', content: 'unchanged prefix' }];
    session.turns = [{ id: 'turn', question: 'Question', createdAt: 1, status: 'generating', text: 'Visible partial', sourceIds: ['P0001'] }];
    const restored = recoverPaperQaSession(session);
    expect(restored.turns[0]).toMatchObject({ status: 'cancelled', text: 'Visible partial' });
    expect(restored.messages).toEqual(session.messages);
    expect(session.turns[0].status).toBe('generating');
  });
  it('drops runtime extra fields at every stored conversation layer while retaining answer state and numeric usage', () => {
    const marker = 'test-only-incidental-data';
    const runtimeValue = {
      ...newPaperQaSession('doc', 'version'), apiKey: marker, metadata: { value: marker }, headers: { Authorization: marker },
      messages: [{ role: 'user', content: 'Original question', apiKey: marker, metadata: { value: marker }, headers: { extra: marker } }],
      turns: [{ id: 'turn', question: 'Original question', createdAt: 1, status: 'completed', text: 'Original answer', sourceIds: ['P0001'],
        apiKey: marker, metadata: { value: marker }, headers: { extra: marker },
        selection: { text: 'Selected text', pageIndex: 0, metadata: { value: marker } },
        blocks: [{ text: 'Original answer', sources: ['P0001'], headers: { extra: marker } }],
        answerStatus: 'partial', missing: 'Need experiment details', error: 'network',
        usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17, promptCacheHitTokens: 2, promptCacheMissTokens: 10, apiKey: marker, headers: { extra: marker } },
      }],
    } as unknown as PaperQaSession;
    const stored = nextStoredPaperQaSession(runtimeValue);
    expect(JSON.stringify(stored)).not.toContain(marker);
    expect(stored.messages).toEqual([{ role: 'user', content: 'Original question' }]);
    expect(stored.turns[0]).toMatchObject({ answerStatus: 'partial', missing: 'Need experiment details', error: 'network',
      selection: { text: 'Selected text', pageIndex: 0 }, blocks: [{ text: 'Original answer', sources: ['P0001'] }],
      usage: { promptTokens: 12, completionTokens: 5, totalTokens: 17, promptCacheHitTokens: 2, promptCacheMissTokens: 10 } });
    expect(stored.revision).toBe(1);
    expect(recoverPaperQaSession(runtimeValue)).toEqual({ ...stored, revision: 0 });
    expect((runtimeValue as unknown as { apiKey: string }).apiKey).toBe(marker);
  });
  it('rejects non-string nested source IDs instead of persisting arbitrary objects in a typed field', () => {
    const runtimeValue = { ...newPaperQaSession('doc', 'version'), turns: [{ id: 'turn', question: 'Question', createdAt: 1, status: 'completed', text: 'Answer', sourceIds: [{ apiKey: 'test-only-value' }] }] } as unknown as PaperQaSession;
    expect(() => nextStoredPaperQaSession(runtimeValue)).toThrow('Invalid paper QA session');
  });
  it('summarizes session metadata without retaining full paper messages, answers or incidental runtime fields', () => {
    const session = newPaperQaSession('doc', 'source-version');
    session.messages = [{ role: 'user', content: 'large original paper context' }];
    session.turns = [{ id: 'turn', createdAt: 1, question: 'Question', status: 'completed', text: 'large answer', sourceIds: ['P0001'] }];
    session.sourceIds = ['P0001'];
    const summary = summarizePaperQaSession({ ...session, apiKey: 'test-only-incidental-value' } as typeof session);
    expect(summary).toEqual({ id: session.id, documentKey: 'doc', sourceVersion: 'source-version', protocolVersion: session.protocolVersion, title: session.title, createdAt: session.createdAt, updatedAt: session.updatedAt, scope: 'pre_experiments', revision: 0 });
    expect(Object.keys(summary).sort()).toEqual(['id', 'documentKey', 'sourceVersion', 'protocolVersion', 'title', 'createdAt', 'updatedAt', 'scope', 'revision'].sort());
    expect(JSON.stringify(summary)).not.toMatch(/large original|large answer|test-only|sourceIds/);
  });
  it('whitelists persisted session data instead of retaining incidental secrets or PDF handles', () => {
    const session = { ...newPaperQaSession('doc', 'version'), apiKey: 'never persist', pdf: { bytes: [1, 2] } } as PaperQaSession;
    const stored = nextStoredPaperQaSession(session) as PaperQaSession & { apiKey?: string; pdf?: unknown };
    expect(stored.apiKey).toBeUndefined(); expect(stored.pdf).toBeUndefined();
  });
});
