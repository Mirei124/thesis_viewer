import { useEffect, useId, useState } from 'react';
import type { MessageKey } from '../lib/i18n';
import { recentDays, type ReadingHistoryEntry, type ReadingSnapshot } from '../lib/readingHistory';
type Labels = (key: MessageKey, values?: Record<string, string | number>) => string;
type Props = { snapshot: ReadingSnapshot; loading: boolean; error: boolean; t: Labels; locale: string; onOpen: (entry: ReadingHistoryEntry) => void; onClear: () => void };
export function ReadingHistoryList({ snapshot, loading, error, t, locale, onOpen, onClear }: Props) {
  const searchId = useId();
  const [query, setQuery] = useState(''); const [limit, setLimit] = useState(20); const [confirm, setConfirm] = useState(false);
  useEffect(() => { setLimit(20); }, [query]);
  const rows = snapshot.entries.filter((entry) => `${entry.title} ${entry.source.kind === 'online' ? entry.source.url : ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <div className="reading-history-list">
    <div className="reading-history-controls"><label htmlFor={searchId}><span className="visually-hidden">{t('reader.reading.search')}</span><input id={searchId} type="search" value={query} placeholder={t('reader.reading.search')} onChange={(event) => setQuery(event.target.value)} /></label><button type="button" disabled={!snapshot.entries.length} onClick={() => setConfirm(true)}>{t('reader.reading.clear')}</button></div>
    {confirm && <div className="reading-history-confirm" role="group" aria-label={t('reader.reading.clearConfirm')}><p>{t('reader.reading.clearConfirm')}</p><button type="button" onClick={() => { onClear(); setConfirm(false); }}>{t('reader.reading.clear')}</button><button type="button" onClick={() => setConfirm(false)}>{t('reader.cancel')}</button></div>}
    {error && <p role="status">{t('reader.reading.error')}</p>}
    {loading ? <p role="status">{t('reader.reading.loading')}</p> : !rows.length ? <p>{t(snapshot.entries.length ? 'reader.reading.noResults' : 'reader.reading.empty')}</p> : <ul className="reading-history-entries">{rows.slice(0, limit).map((entry) => <li key={entry.id}><button type="button" className="reading-history-open" onClick={() => onOpen(entry)}><strong>{entry.title}</strong><span>{t(entry.source.kind === 'online' ? 'reader.reading.online' : 'reader.reading.local')} · <time dateTime={new Date(entry.lastOpened).toISOString()}>{new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(entry.lastOpened)}</time></span></button>{entry.source.kind === 'online' && <a className="reading-history-url" href={entry.source.url} target="_blank" rel="noopener noreferrer">{entry.source.url}</a>}</li>)}</ul>}
    {rows.length > limit && <button type="button" className="reading-history-more" onClick={() => setLimit((value) => value + 20)}>{t('reader.reading.more')}</button>}
  </div>;
}
export function ReadingActivity({ snapshot, t, locale }: Pick<Props, 'snapshot' | 't' | 'locale'>) {
  const days = recentDays(); const counts = new Map<string, number>();
  for (const activity of snapshot.activities) counts.set(activity.day, (counts.get(activity.day) ?? 0) + 1);
  const sum = days.reduce((total, day) => total + (counts.get(day) ?? 0), 0); const active = days.filter((day) => counts.has(day)).length;
  const first = new Date(`${days[0]}T12:00:00`); const pad = first.getDay();
  const cells: (string | null)[] = [...Array<null>(pad).fill(null), ...days]; while (cells.length % 7) cells.push(null);
  const weeks = Array.from({ length: cells.length / 7 }, (_, index) => cells.slice(index * 7, index * 7 + 7));
  const level = (count: number) => count === 0 ? 0 : count === 1 ? 1 : count === 2 ? 2 : count < 5 ? 3 : 4;
  const month = new Intl.DateTimeFormat(locale, { month: 'short' }); const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' });
  return <section className="reading-activity" aria-labelledby="reading-activity-title"><h2 id="reading-activity-title">{t('reader.reading.activity')}</h2><p>{t('reader.reading.summary', { count: sum, days: active })}</p>
    <div className="reading-heatmap-scroll"><table className="reading-heatmap"><caption className="visually-hidden">{t('reader.reading.activityCaption')}</caption><thead><tr><th scope="col" className="visually-hidden">{t('reader.reading.weekday')}</th>{weeks.map((week, index) => { const day = week.find((item) => item !== null)!; const date = new Date(`${day}T12:00:00`); return <th scope="col" key={index}>{index === 0 || date.getDate() <= 7 ? month.format(date) : ''}</th>; })}</tr></thead><tbody>{Array.from({ length: 7 }, (_, row) => <tr key={row}><th scope="row">{row % 2 === 1 ? weekday.format(new Date(2024, 0, 7 + row)) : <span className="visually-hidden">{weekday.format(new Date(2024, 0, 7 + row))}</span>}</th>{weeks.map((week, column) => <td key={column}>{week[row] && <span className={`reading-heatmap-cell reading-level-${level(counts.get(week[row]!) ?? 0)}`} title={`${week[row]}: ${t('reader.reading.dayCount', { count: counts.get(week[row]!) ?? 0 })}`}><span className="visually-hidden">{week[row]}: {t('reader.reading.dayCount', { count: counts.get(week[row]!) ?? 0 })}</span></span>}</td>)}</tr>)}</tbody></table></div>
    <div className="reading-heatmap-legend">{[0, 1, 2, 3, 4].map((value) => <span key={value}><i className={`reading-heatmap-cell reading-level-${value}`} aria-hidden="true" />{['0', '1', '2', '3–4', '5+'][value]}</span>)}</div>
    <details className="reading-activity-details"><summary>{t('reader.reading.dailyDetails')}</summary><ul>{days.slice().reverse().map((day) => <li key={day}><time dateTime={day}>{day}</time> — {t('reader.reading.dayCount', { count: counts.get(day) ?? 0 })}</li>)}</ul></details>
  </section>;
}
