import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import type { PaperQaScope, PaperQaSelection, PaperQaSession, PaperQaSessionSummary, PaperQaTurn } from '../lib/paperQaTypes';
import type { CompatibleUsage } from '../lib/compatibleProvider';
import { qaLabel, type QaLabelKey } from '../lib/paperQaLabels';
import { formatTokenCount } from '../lib/tokenCountFormat';
import { LimitedMath } from './LimitedMath';
import './paperQa.css';

export type PaperQaPanelProps = {
  locale: string;
  title: string;
  ready: boolean;
  visible?: boolean;
  sessions: readonly PaperQaSessionSummary[];
  activeSession: PaperQaSession | null;
  busy: boolean;
  selection: PaperQaSelection | null;
  error?: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  onScopeChange: (scope: PaperQaScope) => void;
  onClearSelection: () => void;
  onSend: (question: string) => void;
  onCancel: () => void;
  onRetry: (turnId: string) => void;
  onSource: (sourceId: string, trigger: HTMLElement) => void;
  renderAnswer?: (text: string, sourceIds: readonly string[], enabled: boolean) => ReactNode;
};

type UsageProps = { usage?: CompatibleUsage; locale: string; label: (key: QaLabelKey) => string; title?: string; incomplete?: boolean };
const QA_SCOPES = ['pre_experiments', 'body', 'full'] as const;
function RecordedUsage({ usage, locale, label, title, incomplete }: UsageProps) {
  const fields: ReadonlyArray<readonly [keyof CompatibleUsage, QaLabelKey, QaLabelKey]> = [
    ['promptTokens', 'inputTokens', 'inputShort'], ['completionTokens', 'outputTokens', 'outputShort'],
    ['promptCacheHitTokens', 'cacheHit', 'cacheHitShort'], ['promptCacheMissTokens', 'cacheMiss', 'cacheMissShort'],
  ];
  const reported = fields.filter(([key]) => typeof usage?.[key] === 'number' && Number.isSafeInteger(usage[key]) && usage[key]! >= 0);
  if (!reported.length && typeof usage?.totalTokens === 'number' && Number.isSafeInteger(usage.totalTokens) && usage.totalTokens >= 0) reported.push(['totalTokens', 'totalTokens', 'totalShort']);
  const partial = Boolean(reported.length && (incomplete || !reported.some(([key]) => key === 'promptTokens') || !reported.some(([key]) => key === 'completionTokens')));
  const exactFormatter = new Intl.NumberFormat(locale);
  const exact = reported.map(([key, fullLabel]) => `${label(fullLabel)} ${exactFormatter.format(usage![key]!)}`).join(' · ');
  const description = [title || label('usage'), exact || label('usageMissing'), ...(partial ? [label('usageIncomplete')] : [])].join(' · ');
  return <div className="qa-usage" role="group" tabIndex={0} aria-label={description} title={description}>
    <span aria-hidden="true">{title && <span className="qa-usage-title">{title} · </span>}
      {reported.length ? reported.map(([key, , shortLabel], index) => <span key={key}>{index > 0 && ' · '}{label(shortLabel)} {formatTokenCount(usage![key])}</span>) : label('usageMissing')}
      {partial && <span className="qa-usage-partial"> · {label('usagePartial')}</span>}
    </span>
  </div>;
}

/** A reader sidebar, not a modal chat application. API and persistence live above this component. */
export function PaperQaPanel(props: PaperQaPanelProps) {
  const { locale, title, ready, sessions, activeSession, busy, selection, error, visible = true } = props;
  const l = (key: QaLabelKey, values?: Record<string, string | number>) => qaLabel(locale, key, values);
  const [showHistory, setShowHistory] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [copyStatus, setCopyStatus] = useState<{ id: string; message: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const keepAtEnd = useRef(true);
  const composing = useRef(false);
  const previousTurn = useRef<string | undefined>(undefined);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputId = useId();
  const scopeId = useId();
  const scope = activeSession?.scope ?? 'pre_experiments';
  const scopeIndex = QA_SCOPES.indexOf(scope);
  const draftKey = activeSession?.id ?? 'new';
  const draft = drafts[draftKey] ?? '';
  const turns = activeSession?.turns ?? [];
  const lastTurn = turns.at(-1);
  const recordedTurns = turns.filter(turn => turn.status !== 'generating');
  const conversationUsage: CompatibleUsage = {};
  const usageKeys = ['promptTokens', 'completionTokens', 'totalTokens', 'promptCacheHitTokens', 'promptCacheMissTokens'] as const;
  for (const turn of recordedTurns) for (const key of usageKeys) {
    if (typeof turn.usage?.[key] === 'number') conversationUsage[key] = (conversationUsage[key] ?? 0) + turn.usage[key]!;
  }
  const incompleteUsage = recordedTurns.some(turn => turn.usage?.promptTokens === undefined || turn.usage.completionTokens === undefined);

  useEffect(() => {
    setShowHistory(false); setDeleteId(null); keepAtEnd.current = true;
    previousTurn.current = undefined;
  }, [activeSession?.id]);
  useEffect(() => {
    if (!lastTurn || lastTurn.id === previousTurn.current) return;
    previousTurn.current = lastTurn.id;
    if (lastTurn.status === 'generating') setDrafts(old => old[draftKey]?.trim() === lastTurn.question.trim() ? { ...old, [draftKey]: '' } : old);
  }, [lastTurn?.id, lastTurn?.status, lastTurn?.question, draftKey]);
  useEffect(() => {
    if (!visible || !keepAtEnd.current || showHistory) return;
    const element = messagesRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [lastTurn?.text, lastTurn?.blocks, lastTurn?.status, turns.length, showHistory, visible]);
  useEffect(() => {
    if (!selection || busy) return;
    setShowHistory(false);
    const frame = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [selection]);
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); }, []);

  function focusComposer() { requestAnimationFrame(() => inputRef.current?.focus()); }
  function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!ready || busy || !draft.trim()) return;
    keepAtEnd.current = true;
    props.onSend(draft.trim());
  }
  function onInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey) return;
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || composing.current) return;
    event.preventDefault(); submit();
  }
  async function copyAnswer(turn: PaperQaTurn) {
    const text = turn.text || turn.blocks?.map(block => block.text).join('\n\n') || '';
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ id: turn.id, message: l('copying') });
    } catch { setCopyStatus({ id: turn.id, message: l('copyFailed') }); }
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus(null), 2500);
  }
  function answerText(text: string, sourceIds: readonly string[], enabled: boolean): ReactNode {
    if (props.renderAnswer) return props.renderAnswer(text, sourceIds, enabled);
    if (!enabled) return <LimitedMath text={text} />;
    const allowed = new Set(sourceIds);
    const mentioned = new Set<string>();
    const pieces: ReactNode[] = [];
    let cursor = 0;
    const sourceButton = (source: string, key: string) => <button key={key} type="button" className="qa-source" aria-label={l('source', { source })} onClick={event => props.onSource(source, event.currentTarget)}>[{source.replace(/^P0*/, '') || source}]</button>;
    for (const match of text.matchAll(/\[(P\d+)\]/g)) {
      const index = match.index!;
      if (index > cursor) pieces.push(<LimitedMath key={`text-${cursor}`} text={text.slice(cursor, index)} />);
      if (allowed.has(match[1])) { pieces.push(sourceButton(match[1], `source-${index}`)); mentioned.add(match[1]); }
      else pieces.push(match[0]);
      cursor = index + match[0].length;
    }
    if (cursor < text.length) pieces.push(<LimitedMath key={`text-${cursor}`} text={text.slice(cursor)} />);
    for (const source of allowed) if (!mentioned.has(source)) pieces.push(sourceButton(source, `extra-${source}`));
    return pieces;
  }
  function formatDate(timestamp: number) {
    try { return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp); }
    catch { return new Date(timestamp).toLocaleString(); }
  }

  return <section className="qa-panel" aria-label={l('title')}>
    <header className="qa-header">
      <h2>{showHistory ? l('history') : l('title')}</h2>
      <div className="qa-header-actions">
        <button type="button" disabled={busy} aria-expanded={showHistory} onClick={() => { setShowHistory(value => !value); setDeleteId(null); }}>{showHistory ? l('back') : l('history')}</button>
        <button type="button" disabled={busy || !ready} onClick={() => { setShowHistory(false); props.onNewSession(); focusComposer(); }}>{l('newSession')}</button>
      </div>
      <p className="qa-paper-title" title={title}>{title}</p>
    </header>
    {error && <p className="qa-panel-error" role="alert">{error}</p>}
    {showHistory ? <div className="qa-history">
      <p className="qa-muted">{l('local')}</p>
      {!sessions.length && <p className="qa-empty-note">{l('noSessions')}</p>}
      <ul>{sessions.map(session => <li key={session.id} className={session.id === activeSession?.id ? 'qa-history-current' : undefined}>
        <button type="button" className="qa-session-open" aria-current={session.id === activeSession?.id ? 'true' : undefined} disabled={busy} onClick={() => { props.onSelectSession(session.id); setShowHistory(false); setDeleteId(null); focusComposer(); }}>
          <strong>{session.title || l('untitled')}</strong><time dateTime={new Date(session.updatedAt).toISOString()}>{formatDate(session.updatedAt)}</time>
        </button>
        <button type="button" className="qa-session-delete" disabled={busy} aria-label={`${l('deleteSession')}: ${session.title || l('untitled')}`} onClick={() => setDeleteId(session.id)}>{l('delete')}</button>
        {deleteId === session.id && <div className="qa-delete-confirm" role="group" aria-label={l('deleteConfirm')}>
          <p>{l('deleteConfirm')}</p><button type="button" disabled={busy} onClick={() => { props.onDeleteSession(session.id); setDeleteId(null); }}>{l('delete')}</button><button type="button" onClick={() => setDeleteId(null)}>{l('keep')}</button>
        </div>}
      </li>)}</ul>
    </div> : <>
      <div className="qa-scope-control">
        <div className="qa-scope-heading"><label htmlFor={scopeId}>{l('scope')}</label><output htmlFor={scopeId}>{l(scope)}</output></div>
        <input id={scopeId} className="qa-scope-slider" type="range" min={0} max={2} step={1} value={scopeIndex}
          style={{ '--qa-scope-progress': `${scopeIndex * 50}%` } as CSSProperties}
          aria-valuetext={l(scope)}
          disabled={busy || !ready} onChange={event => props.onScopeChange(QA_SCOPES[Number(event.currentTarget.value)])} />
        <div className="qa-scope-steps" aria-hidden="true">{QA_SCOPES.map(item => <span key={item} className={scope === item ? 'is-current' : undefined}>{l(item)}</span>)}</div>
      </div>
      <div className="qa-messages" ref={messagesRef} onScroll={() => { if (!visible) return; const element = messagesRef.current; if (element) keepAtEnd.current = element.scrollHeight - element.scrollTop - element.clientHeight < 64; }}>
        {!ready && <p className="qa-empty-note" role="status">{l('preparing')}</p>}
        {ready && !turns.length && <div className="qa-empty"><p>{l('empty')}</p><p>{l('emptyHint')}</p></div>}
        {turns.map(turn => <article className="qa-turn" key={turn.id}>
          <div className="qa-question"><span className="qa-speaker">{l('you')}</span><p>{turn.question}</p>{turn.selection && <blockquote>{l('page', { page: turn.selection.pageIndex + 1 })} · {turn.selection.text}</blockquote>}</div>
          <div className="qa-answer" aria-busy={turn.status === 'generating'}>
            <span className="qa-speaker">{l('title')}</span>
            {turn.blocks?.length && turn.status === 'completed'
              ? turn.blocks.map((block, index) => <p className="qa-answer-text" key={index}>{answerText(block.text, block.sources, true)}</p>)
              : <p className="qa-answer-text">{answerText(turn.text, [], false)}</p>}
            {turn.status === 'completed' && turn.answerStatus && turn.answerStatus !== 'answered' && <div className="qa-insufficient" role="status"><p>{l(turn.answerStatus === 'partial' ? 'partial' : 'insufficient')}</p>{turn.missing && <p>{turn.missing}</p>}</div>}
            {turn.status === 'generating' && <p className="qa-status" role="status">{l('answering')}</p>}
            {turn.status === 'cancelled' && <p className="qa-status">{l('cancelled')}</p>}
            {turn.status === 'error' && <p className="qa-turn-error" role="alert">{turn.error || l('error')}</p>}
            {(turn.status === 'error' || turn.status === 'cancelled') && <button type="button" disabled={busy || !ready} className="qa-retry" onClick={() => props.onRetry(turn.id)}>{l('retry')}</button>}
            {(turn.text || turn.blocks?.length) && turn.status !== 'generating' && <div className="qa-answer-actions"><button type="button" className="qa-copy-answer" aria-label={l('copy')} title={l('copy')} onClick={() => void copyAnswer(turn)}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M8 8h12v13H8z M16 8V3H3v13h5" /></svg></button>{copyStatus?.id === turn.id && <span role="status">{copyStatus.message}</span>}</div>}
            {turn.status !== 'generating' && <RecordedUsage usage={turn.usage} locale={locale} label={l} />}
          </div>
        </article>)}
      </div>
      <form className="qa-composer" onSubmit={submit}>
        {selection && <div className="qa-selection"><div><strong>{l('selectedText')} · {l('page', { page: selection.pageIndex + 1 })}</strong><blockquote>{selection.text}</blockquote></div><button type="button" aria-label={l('clearSelection')} disabled={busy} onClick={props.onClearSelection}>×</button></div>}
        <label className="visually-hidden" htmlFor={inputId}>{l('inputLabel')}</label>
        <div className="qa-input-wrap"><textarea id={inputId} ref={inputRef} rows={3} value={draft} placeholder={l('placeholder')} disabled={!ready} onChange={event => setDrafts(old => ({ ...old, [draftKey]: event.target.value }))} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} onKeyDown={onInputKeyDown} />
          <div className="qa-input-actions"><span>{l('shortcut')}</span>{busy ? <button type="button" className="qa-stop" onClick={props.onCancel}>{l('stop')}</button> : <button type="submit" className="qa-send" disabled={!ready || !draft.trim()}>{l('send')}</button>}</div>
        </div>
        <p className="qa-caution">{l('caution')}</p>
        {recordedTurns.length > 0 && <RecordedUsage usage={conversationUsage} locale={locale} label={l} title={l('sessionUsage')} incomplete={incompleteUsage} />}
      </form>
    </>}
  </section>;
}
