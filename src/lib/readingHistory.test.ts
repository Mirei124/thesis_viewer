import { describe, expect, it } from 'vitest';
import { civilDay, historyIdentity, normalizeHistoryUrl, recentDays, updatedHistory } from './readingHistory';
describe('reading history identity and transactions inputs', () => {
  it('normalizes HTTPS fragments while retaining distinct queries', () => { expect(normalizeHistoryUrl('https://EXAMPLE.com/p.pdf?q=1#page=4')).toBe('https://example.com/p.pdf?q=1'); expect(historyIdentity('abc', { kind: 'online', url: 'https://example.com/p.pdf?q=1' })).not.toBe(historyIdentity('abc', { kind: 'online', url: 'https://example.com/p.pdf?q=2' })); });
  it('rejects credentials and unsafe protocols', () => { for (const url of ['http://example.com', 'javascript:alert(1)', 'https://user:pass@example.com']) expect(() => normalizeHistoryUrl(url)).toThrow(); });
  it('separates local and online sources for one content hash', () => { expect(historyIdentity('abc', { kind: 'local' })).not.toBe(historyIdentity('abc', { kind: 'online', url: 'https://example.com/a.pdf' })); });
  it('updates one source without resetting the original date', () => { const input = { hash: 'abc', title: 'A paper', titleSource: 'metadata' as const, source: { kind: 'local' as const } }; const first = updatedHistory(undefined, input, 100); const second = updatedHistory(first, input, 200); expect(second).toMatchObject({ firstOpened: 100, lastOpened: 200, openCount: 2 }); expect(updatedHistory(second, input, 150).lastOpened).toBe(200); });
});
describe('local civil-day calendar', () => {
  it('uses local date fields at midnight instead of UTC truncation', () => { const date = new Date(2026, 9, 4, 0, 1); expect(civilDay(date)).toBe('2026-10-04'); });
  it('includes leap day and ends today with exactly 365 days', () => { const days = recentDays(new Date(2024, 2, 1)); expect(days).toHaveLength(365); expect(days.at(-1)).toBe('2024-03-01'); expect(days).toContain('2024-02-29'); expect(new Set(days).size).toBe(365); });
  it('walks local calendar across DST boundaries without fixed-hour arithmetic', () => { const previous = process.env.TZ; process.env.TZ = 'America/New_York'; try { const days = recentDays(new Date(2026, 10, 3), 250); expect(days).toContain('2026-03-08'); expect(days).toContain('2026-11-01'); expect(new Set(days).size).toBe(250); } finally { process.env.TZ = previous; } });
});
