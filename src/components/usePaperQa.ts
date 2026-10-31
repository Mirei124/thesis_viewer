import { useEffect, useMemo, useRef, useState } from 'react';
import type { EvidenceLedger } from '../lib/evidenceLedger';
import type { PageExtraction } from '../lib/pdfPageBlocks';
import type { ModelConfig } from '../lib/modelConfig';
import { requestApiHostPermission } from '../lib/apiPermissions';
import { CompatibleProviderError, requestCompatibleCompletion, requestCompatibleCompletionStream, type ChatMessage, type CompatibleUsage } from '../lib/compatibleProvider';
import { buildPaperQaSources, completePaperQaTurn, newPaperQaSession, PAPER_QA_OUTPUT_LIMIT, PaperQaError, paperQaRepairMessages, preparePaperQaTurn, setPaperQaScope, streamedPaperQaText } from '../lib/paperQa';
import { deletePaperQaSession, listPaperQaSessionSummaries, loadPaperQaSession, summarizePaperQaSession, PaperQaSessionConflictError, putPaperQaSession } from '../lib/paperQaRepository';
import type { PaperQaScope, PaperQaSelection, PaperQaSession, PaperQaSessionSummary } from '../lib/paperQaTypes';

type Options = { documentKey: string | null; ledger?: EvidenceLedger; pages?: PageExtraction[]; locale: string; getConfig: () => ModelConfig | null; getApiKey: () => string | undefined };
type Running = { token: number; controller: AbortController; session: PaperQaSession; turnId: string; raw: string; timer?: ReturnType<typeof setTimeout> };
const mergeUsage = (a: CompatibleUsage | undefined, b: CompatibleUsage | undefined): CompatibleUsage | undefined => {
  if (!a) return b; if (!b) return a;
  return Object.fromEntries([...new Set([...Object.keys(a), ...Object.keys(b)])].map(key => [key, (a[key as keyof CompatibleUsage] ?? 0) + (b[key as keyof CompatibleUsage] ?? 0)]));
};

/** UI state is separate from immutable provider messages. Never persist credentials. */
export function usePaperQa(options: Options) {
  const { documentKey, ledger, pages, locale } = options;
  const registry = useMemo(() => documentKey && ledger && pages && ledger.documentVersion === `sha256:${documentKey}`
    ? buildPaperQaSources(ledger, pages) : null, [documentKey, ledger, pages]);
  const [sessions, setSessions] = useState<PaperQaSessionSummary[]>([]);
  const [activeSession, setActiveSession] = useState<PaperQaSession | null>(null);
  const [selection, setSelection] = useState<PaperQaSelection | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingSession, setLoadingSession] = useState(false);
  const loadEpochRef = useRef(0);
  const [error, setError] = useState<string>();
  const activeRef = useRef<PaperQaSession | null>(null);
  const documentKeyRef = useRef(documentKey); documentKeyRef.current = documentKey;
  const runningRef = useRef<Running | null>(null);
  const generationRef = useRef(0);
  const queueRef = useRef(new Map<string, Promise<unknown>>());
  const revisionsRef = useRef(new Map<string, number>());
  const deletedRef = useRef(new Set<string>());
  const conflictRef = useRef(new Set<string>());
  const unsavedRef = useRef(new Map<string, PaperQaSession>());
  const zh = locale.startsWith('zh');
  const label = (cn: string, en: string) => zh ? cn : en;

  function apply(next: PaperQaSession) {
    if (next.documentKey !== documentKeyRef.current || deletedRef.current.has(next.id)) return;
    activeRef.current = next; setActiveSession(next);
    setSessions(current => [summarizePaperQaSession(next), ...current.filter(item => item.id !== next.id)].sort((a, b) => b.updatedAt - a.updatedAt));
  }
  function storageError(cause: unknown, key: string) {
    if (key !== documentKeyRef.current) return;
    setError(cause instanceof PaperQaSessionConflictError
      ? label('这段对话已在其他页面修改或删除。请新建对话，避免覆盖。', 'This conversation changed in another page. Start a new conversation to avoid overwriting it.')
      : label('对话保存失败，当前内容暂留本页；请勿关闭页面。', 'Conversation storage failed. Current text is kept in this page; keep the page open.'));
  }
  function keepUnsaved(next: PaperQaSession) {
    const previous = unsavedRef.current.get(next.id);
    if (!previous || previous.updatedAt <= next.updatedAt) unsavedRef.current.set(next.id, next);
  }
  function persist(next: PaperQaSession) {
    if (deletedRef.current.has(next.id)) return Promise.resolve();
    if (conflictRef.current.has(next.id)) { keepUnsaved(next); return Promise.resolve(); }
    const task = (queueRef.current.get(next.id) ?? Promise.resolve()).catch(() => undefined).then(async () => {
      if (deletedRef.current.has(next.id)) return;
      if (conflictRef.current.has(next.id)) { keepUnsaved(next); return; }
      const saved = await putPaperQaSession({ ...next, revision: revisionsRef.current.get(next.id) ?? next.revision });
      revisionsRef.current.set(next.id, saved.revision);
      if ((unsavedRef.current.get(next.id)?.updatedAt ?? -Infinity) <= next.updatedAt) unsavedRef.current.delete(next.id);
      if (next.documentKey === documentKeyRef.current && !deletedRef.current.has(next.id)) {
        setSessions(current => current.map(item => item.id === next.id ? { ...item, revision: saved.revision } : item));
        if (activeRef.current?.id === next.id) {
          const current = { ...activeRef.current, revision: saved.revision }; activeRef.current = current; setActiveSession(current);
        }
      }
    }).catch(cause => {
      if (cause instanceof PaperQaSessionConflictError) conflictRef.current.add(next.id);
      keepUnsaved(next);
      storageError(cause, next.documentKey);
      if (cause instanceof PaperQaSessionConflictError && runningRef.current?.session.id === next.id) cancelRef.current();
    });
    queueRef.current.set(next.id, task); return task;
  }
  function projected(job: Running, status: 'generating' | 'cancelled' | 'error' = 'generating', message?: string): PaperQaSession {
    return { ...job.session, updatedAt: Date.now(), turns: job.session.turns.map(turn => turn.id === job.turnId
      ? { ...turn, status, text: streamedPaperQaText(job.raw), ...(message ? { error: message } : {}) } : turn) };
  }
  function cancel() {
    const job = runningRef.current;
    if (!job) return;
    generationRef.current++; runningRef.current = null;
    if (job.timer) clearTimeout(job.timer);
    job.controller.abort();
    const next = projected(job, 'cancelled'); apply(next); void persist(next); setBusy(false);
  }
  const cancelRef = useRef(cancel); cancelRef.current = cancel;

  useEffect(() => {
    cancelRef.current();
    const epoch = ++loadEpochRef.current;
    activeRef.current = null; setActiveSession(null); setSessions([]); setSelection(null); setError(undefined);
    setLoadingSession(Boolean(documentKey && registry));
    if (!documentKey || !registry) return;
    let alive = true;
    void listPaperQaSessionSummaries(documentKey).then(async savedSummaries => {
      const summaries = [...new Map([...savedSummaries, ...[...unsavedRef.current.values()].filter(session => session.documentKey === documentKey).map(summarizePaperQaSession)].map(item => [item.id, item])).values()].sort((a, b) => b.updatedAt - a.updatedAt);
      const selected = summaries.find(session => session.sourceVersion === registry.sourceVersion);
      const first = selected ? unsavedRef.current.get(selected.id) ?? await loadPaperQaSession(selected.id, documentKey) : undefined;
      if (!alive || loadEpochRef.current !== epoch || documentKeyRef.current !== documentKey) return;
      for (const summary of summaries) revisionsRef.current.set(summary.id, summary.revision);
      if (first) revisionsRef.current.set(first.id, first.revision);
      const next = first ?? newPaperQaSession(documentKey, registry.sourceVersion);
      activeRef.current = next; setActiveSession(next);
      setSessions(summaries.some(session => session.id === next.id) ? summaries : [summarizePaperQaSession(next), ...summaries]);
    }).catch(cause => {
      if (!alive || loadEpochRef.current !== epoch) return;
      const local = [...unsavedRef.current.values()].filter(session => session.documentKey === documentKey).sort((a, b) => b.updatedAt - a.updatedAt);
      const first = local[0] ?? newPaperQaSession(documentKey, registry.sourceVersion); apply(first);
      setSessions(local.length ? local.map(summarizePaperQaSession) : [summarizePaperQaSession(first)]); storageError(cause, documentKey);
    }).finally(() => { if (alive && loadEpochRef.current === epoch) setLoadingSession(false); });
    return () => { alive = false; cancelRef.current(); };
  }, [documentKey, registry?.sourceVersion]);

  useEffect(() => {
    const checkpoint = () => { const job = runningRef.current; if (job) void persist(projected(job)); };
    const pagehide = () => cancelRef.current();
    const timer = window.setInterval(checkpoint, 1000);
    window.addEventListener('pagehide', pagehide);
    return () => { clearInterval(timer); window.removeEventListener('pagehide', pagehide); cancelRef.current(); };
  }, []);

  function newSession() {
    if (runningRef.current || !documentKey || !registry) return;
    loadEpochRef.current++; setLoadingSession(false);
    const next = newPaperQaSession(documentKey, registry.sourceVersion); apply(next); setSelection(null); setError(undefined); void persist(next);
  }
  async function selectSession(id: string) {
    if (runningRef.current || !documentKey) return;
    const summary = sessions.find(session => session.id === id && session.documentKey === documentKey);
    if (!summary) return;
    const epoch = ++loadEpochRef.current; setLoadingSession(true);
    try {
      const local = unsavedRef.current.get(id);
      const next = local ?? await loadPaperQaSession(id, documentKey);
      if (loadEpochRef.current !== epoch || documentKeyRef.current !== documentKey) return;
      if (!next) throw new PaperQaSessionConflictError();
      revisionsRef.current.set(next.id, next.revision);
      apply(next); setSelection(null);
      setError(local ? label('此对话仍有未保存内容，已暂存本页；请勿关闭页面。', 'This conversation has unsaved text kept in this page. Keep the page open.') : undefined);
    } catch (cause) { if (loadEpochRef.current === epoch) storageError(cause, documentKey); }
    finally { if (loadEpochRef.current === epoch) setLoadingSession(false); }
  }

  async function removeSession(id: string) {
    if (runningRef.current || !documentKey) return;
    const target = sessions.find(session => session.id === id && session.documentKey === documentKey);
    if (!target) return;
    deletedRef.current.add(id);
    await (queueRef.current.get(id) ?? Promise.resolve());
    try {
      await deletePaperQaSession(id, documentKey);
      unsavedRef.current.delete(id);
      if (documentKey !== documentKeyRef.current) return;
      const rest = sessions.filter(session => session.id !== id); setSessions(rest);
      if (activeRef.current?.id === id) {
        const preferred = rest.find(session => session.sourceVersion === registry?.sourceVersion);
        if (preferred) await selectSession(preferred.id);
        else {
          const next = registry ? newPaperQaSession(documentKey, registry.sourceVersion) : null;
          activeRef.current = next; setActiveSession(next);
          if (next) setSessions([summarizePaperQaSession(next), ...rest]);
        }
      }
    } catch (cause) { deletedRef.current.delete(id); storageError(cause, documentKey); }
  }
  function changeScope(scope: PaperQaScope) {
    if (runningRef.current || loadingSession || !registry || !activeRef.current) return;
    try { const next = setPaperQaScope(activeRef.current, registry.sources, scope); apply(next); setError(undefined); void persist(next); }
    catch (cause) { setError(explain(cause)); }
  }
  function explain(cause: unknown): string {
    if (cause instanceof PaperQaError) {
      if (cause.code === 'context-too-large') return label('上下文超过本次输入预算。已有对话不会被截断；请新建对话并选择较小输入范围。', 'The input budget was exceeded. Existing messages will not be truncated; start a new conversation with a smaller scope.');
      if (cause.code === 'source-version') return label('论文提取版本已变化。请新建对话，以免旧引用指向错误原文。', 'The paper extraction version changed. Start a new conversation to keep sources accurate.');
      if (cause.code === 'empty-sources') return label('当前范围没有可用原文，请扩大输入范围。', 'No usable paper text is available in this scope. Choose a larger scope.');
      return label('回答未通过格式或来源检查，可以重试。', 'The answer failed format or source checks. You can retry.');
    }
    if (cause instanceof CompatibleProviderError) {
      if (cause.code === 'unauthorized') return label('API密钥不可用，请检查模型设置。', 'The API key was rejected. Check model settings.');
      if (cause.code === 'context-too-large') return label('服务商拒绝了当前上下文或64K输出上限，请检查模型能力或新建较小范围的对话。', 'The provider rejected this context or the 64K output limit. Check model capabilities or start a smaller conversation.');
      if (cause.code === 'rate-limited') return label('请求过于频繁，请稍后重试。', 'The provider rate limit was reached. Retry later.');
      if (cause.code === 'invalid-response') return label('响应格式损坏或流式连接未正常结束；已保留收到的文字，可以重试。', 'The response was malformed or the stream did not finish normally. Received text is kept; you can retry.');
    }
    return label('请求未完成，已保留收到的文字。请检查网络及模型设置后重试。', 'The request did not complete. Received text is kept. Check the connection and model settings before retrying.');
  }
  function send(question: string, retryId?: string) {
    if (runningRef.current || loadingSession || !registry || !documentKey) return;
    const config = options.getConfig();
    if (!config) { setError(label('模型设置尚未就绪，请检查设置后重试。', 'Model settings are not ready. Check settings and retry.')); return; }
    const current = activeRef.current ?? newPaperQaSession(documentKey, registry.sourceVersion);
    if (conflictRef.current.has(current.id)) { storageError(new PaperQaSessionConflictError(), documentKey); return; }
    const retryTurn = retryId ? current.turns.find(turn => turn.id === retryId && turn.status !== 'completed') : undefined;
    const draftSelection = retryTurn?.selection ?? selection;
    let prepared: ReturnType<typeof preparePaperQaTurn>;
    try { prepared = preparePaperQaTurn(current, registry.sources, retryTurn?.question ?? question, draftSelection ?? undefined); }
    catch (cause) { setError(explain(cause)); return; }
    // Invoke before any await so Firefox/Chrome retain the click's permission gesture.
    const permission = requestApiHostPermission(config.baseUrl);
    const generation = ++generationRef.current;
    const controller = new AbortController();
    const job: Running = { token: generation, controller, session: prepared.session, turnId: prepared.turnId, raw: '' };
    runningRef.current = job; apply(job.session); setBusy(true); setSelection(null); setError(undefined); const initialSave = persist(job.session);
    const apiKey = options.getApiKey();
    const qaConfig = { ...config, outputLimit: PAPER_QA_OUTPUT_LIMIT };
    const isCurrent = () => runningRef.current === job && generationRef.current === generation && documentKeyRef.current === documentKey && !controller.signal.aborted;
    void (async () => {
      let usage: CompatibleUsage | undefined;
      try {
        const grant = await permission;
        await initialSave;
        if (!isCurrent()) return;
        if (!grant.granted) throw new Error('qa-permission-denied');
        const response = await requestCompatibleCompletionStream({ config: qaConfig, apiKey, messages: prepared.messages, signal: controller.signal }, delta => {
          if (!isCurrent()) return;
          job.raw += delta;
          if (!job.timer) job.timer = setTimeout(() => { job.timer = undefined; if (isCurrent()) apply(projected(job)); }, 60);
        });
        if (!isCurrent()) return;
        usage = response.usage; job.raw = response.content;
        let final: PaperQaSession;
        try { final = completePaperQaTurn(job.session, job.turnId, response.content, usage); }
        catch (cause) {
          // Transport/source failures are not a license for an extra billed retry.
          if (!(cause instanceof PaperQaError) || cause.code !== 'invalid-format') throw cause;
          const repairMessages = paperQaRepairMessages(prepared.messages, response.content);
          const repair = await requestCompatibleCompletion({ config: qaConfig, apiKey, messages: repairMessages, signal: controller.signal });
          if (!isCurrent()) return;
          usage = mergeUsage(usage, repair.usage);
          final = completePaperQaTurn(job.session, job.turnId, repair.content, usage);
          // Keep the actual repair conversation too, so later turns do not rewrite that prefix.
          final.messages = [...repairMessages, { role: 'assistant', content: repair.content } satisfies ChatMessage];
        }
        if (!isCurrent()) return;
        if (job.timer) clearTimeout(job.timer);
        runningRef.current = null; apply(final); await persist(final);
      } catch (cause) {
        if (!isCurrent()) return;
        if (job.timer) clearTimeout(job.timer);
        const message = cause instanceof Error && cause.message === 'qa-permission-denied'
          ? label('未获得API访问权限，可以再次发送以授权。', 'API access permission was not granted. Send again to authorize it.') : explain(cause);
        const next = projected(job, 'error', message);
        if (usage) next.turns = next.turns.map(turn => turn.id === job.turnId ? { ...turn, usage } : turn);
        runningRef.current = null; apply(next); await persist(next);
      } finally {
        if (generationRef.current === generation && documentKeyRef.current === documentKey) setBusy(false);
      }
    })();
  }
  const visibleSession = activeSession?.documentKey === documentKey ? activeSession : null;
  return { ready: Boolean(registry && visibleSession && !loadingSession), sessions: sessions.filter(session => session.documentKey === documentKey), activeSession: visibleSession,
    busy: busy && runningRef.current?.session.documentKey === documentKey, error: visibleSession ? error : undefined, selection: visibleSession ? selection : null, setSelection,
    sources: registry?.sources ?? [], sourceVersion: registry?.sourceVersion,
    newSession, selectSession, removeSession, changeScope, send: (question: string) => send(question), cancel,
    retry: (id: string) => { const turn = activeRef.current?.turns.find(item => item.id === id); if (turn) send(turn.question, id); },
  };
}
