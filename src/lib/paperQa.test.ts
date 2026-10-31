import { describe, expect, it } from 'vitest';
import {
  buildPaperQaSources, completePaperQaTurn, newPaperQaSession, PAPER_QA_INPUT_LIMIT, PAPER_QA_OUTPUT_LIMIT, PaperQaError,
  paperQaRepairMessages, paperQaScopeSources, paperQaSourceVersion, parsePaperQaAnswer, preparePaperQaTurn, setPaperQaScope, streamedPaperQaText,
} from './paperQa';
import type { PaperQaSource } from './paperQaTypes';
import { pageBlocksFromTextContent } from './pdfPageBlocks';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { pdfSectionCandidatesFromPages } from './pdfSectionCandidates';
const source = (index: number, role: string, section: string, text = `Original passage ${index}.`): PaperQaSource => ({ id: `P${String(index).padStart(4, '0')}`, paragraphId: `doc:structured-paper-v1:p${index}:0`, pageIndex: index - 1, section, role, text, evidenceIds: [`doc:source:p${index}:i0`] });
const sources = [source(1, 'intro', '1 Introduction'), source(2, 'method', '2 Method'), source(3, 'experiments', '3 Experiments'), source(4, 'unknown', '4 Discussion'), source(5, 'references', 'References'), source(6, 'appendix', 'Appendix')];
const session = () => newPaperQaSession('doc', paperQaSourceVersion(sources));
const response = (id = 'P0002') => JSON.stringify({ answer: [{ text: 'The original explanation.', sources: [id] }], status: 'answered', missing: '' });
function completed() { const prepared = preparePaperQaTurn(session(), sources, 'How does it work?'); return completePaperQaTurn(prepared.session, prepared.turnId, response()); }

describe('paper QA source ranges and immutable conversation prefixes', () => {
  it('uses a chronological experiment boundary and keeps unknown theory prose before it', () => {
    expect(paperQaScopeSources(sources, 'pre_experiments').map(s => s.id)).toEqual(['P0001', 'P0002']);
    expect(paperQaScopeSources(sources, 'body').map(s => s.id)).toEqual(['P0001', 'P0002', 'P0003', 'P0004']);
    expect(paperQaScopeSources(sources, 'full')).toEqual(sources);
    const theory = [source(1, 'intro', 'Introduction'), source(2, 'unknown', '2 Proofs'), source(3, 'conclusion', 'Conclusion')];
    expect(paperQaScopeSources(theory, 'pre_experiments')).toEqual(theory);
    expect(paperQaScopeSources([source(1, 'unknown', 'Theory'), source(2, 'method', '4 Experimental Setup'), source(3, 'unknown', 'Later prose')], 'pre_experiments')).toHaveLength(1);
  });
  it('permits an initial mode replacement before any answer, without duplicating paper context', () => {
    const pre = setPaperQaScope(session(), sources, 'pre_experiments');
    const full = setPaperQaScope(pre, sources, 'full');
    expect(full.messages).toHaveLength(2); expect(full.sourceIds).toEqual(sources.map(s => s.id));
    expect(pre.sourceIds).toHaveLength(2);
  });
  it('only appends unseen original paragraphs after an answer and never rewrites existing messages', () => {
    const first = completed(), snapshot = structuredClone(first);
    const expanded = setPaperQaScope(first, sources, 'body');
    expect(expanded.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(JSON.parse(expanded.messages.at(-1)!.content).sources.map((s: { id: string }) => s.id)).toEqual(['P0003', 'P0004']);
    const full = setPaperQaScope(expanded, sources, 'full');
    expect(full.messages.slice(0, expanded.messages.length)).toEqual(expanded.messages);
    expect(new Set(full.sourceIds).size).toBe(sources.length);
    const downgraded = setPaperQaScope(full, sources, 'pre_experiments');
    expect(downgraded.messages).toEqual(full.messages); expect(downgraded.sourceIds).toEqual(full.sourceIds);
    expect(setPaperQaScope(downgraded, sources, 'full').messages).toEqual(full.messages);
    expect(first).toEqual(snapshot);
  });
  it('does not place pending/cancelled partial output in committed assistant history', () => {
    const prepared = preparePaperQaTurn(completed(), sources, 'What about the result?');
    expect(prepared.messages.slice(0, prepared.session.messages.length)).toEqual(prepared.session.messages);
    expect(prepared.session.messages.at(-1)?.role).toBe('assistant');
    const cancelled = structuredClone(prepared.session); cancelled.turns.at(-1)!.status = 'cancelled'; cancelled.turns.at(-1)!.text = 'partial text';
    const next = preparePaperQaTurn(cancelled, sources, 'A new question');
    expect(next.messages.some(m => m.content === 'partial text')).toBe(false);
    expect(() => completePaperQaTurn(cancelled, prepared.turnId, response())).toThrow(PaperQaError);
  });
  it('adds an explicit selection outside the selected range as original context without rewriting the prefix', () => {
    const first = completed();
    const prepared = preparePaperQaTurn(first, sources, 'Explain this', { text: sources[5].text, pageIndex: 5 });
    expect(prepared.session.sourceIds).toContain('P0006');
    expect(prepared.session.messages.slice(0, first.messages.length)).toEqual(first.messages);
    expect(prepared.session.scope).toBe('pre_experiments');
  });
  it('rejects a changed source registry and another document rather than reusing aliases', () => {
    const changed = structuredClone(sources); changed[0].text = 'Changed PDF content';
    expect(() => preparePaperQaTurn(session(), changed, 'Question')).toThrow('source-version');
    const other = structuredClone(sources); other[0].paragraphId = 'other:structured-paper-v1:p0:0';
    expect(paperQaSourceVersion(other)).not.toBe(paperQaSourceVersion(sources));
    expect(() => setPaperQaScope(session(), other, 'body')).toThrow('source-version');
  });
  it('keeps independent 128K input / 64K output limits and rejects overflow instead of truncating original text', () => {
    expect(PAPER_QA_INPUT_LIMIT).toBe(128000); expect(PAPER_QA_OUTPUT_LIMIT).toBe(64000);
    const large = [source(1, 'method', 'Method', 'a'.repeat(400000))];
    expect(() => preparePaperQaTurn(newPaperQaSession('doc', paperQaSourceVersion(large)), large, 'Question')).toThrow('context-too-large');
    const pre = completed(); pre.messages.push({ role: 'assistant', content: 'x'.repeat(400000) });
    expect(() => preparePaperQaTurn(pre, sources, 'Question')).toThrow('context-too-large');
    expect(pre.messages.at(-1)!.content.length).toBe(400000);
  });
  it('disallows another question or scope edit while a turn is still generating', () => {
    const prepared = preparePaperQaTurn(session(), sources, 'Question');
    expect(() => preparePaperQaTurn(prepared.session, sources, 'Second')).toThrow('busy');
    expect(() => setPaperQaScope(prepared.session, sources, 'full')).toThrow('busy');
  });
});

describe('paper QA answer validation and stream projection', () => {
  it('binds sources only to actually supplied IDs and rejects unknown inline IDs', () => {
    expect(parsePaperQaAnswer(response(), ['P0002']).blocks[0].sources).toEqual(['P0002']);
    expect(() => parsePaperQaAnswer(response('P0006'), ['P0002'])).toThrow('invalid-source');
    expect(() => parsePaperQaAnswer(response().replace('The original explanation.', 'Claim [P9999]'), ['P0002'])).toThrow('invalid-source');
    expect(() => parsePaperQaAnswer('{bad}', ['P0002'])).toThrow('invalid-format');
    expect(() => parsePaperQaAnswer(JSON.stringify({ answer: [{ text: 'A claim', sources: [] }], status: 'answered', missing: '' }), [])).toThrow('invalid-source');
  });
  it('accepts bare hardware names but requires bracketed citations to be supplied and declared by their answer block', () => {
    const answer = (text: string, refs: string[]) => JSON.stringify({ answer: [{ text, sources: refs }], status: 'answered', missing: '' });
    expect(parsePaperQaAnswer(answer('The measured device is NVIDIA Quadro P1000.', ['P0002']), ['P0002']).blocks[0].text).toContain('P1000');
    expect(() => parsePaperQaAnswer(answer('This claim [P9999].', ['P0002']), ['P0002'])).toThrow('invalid-source');
    expect(() => parsePaperQaAnswer(answer('This claim [P0001].', ['P0002']), ['P0001', 'P0002'])).toThrow('invalid-source');
    expect(parsePaperQaAnswer(answer('This claim [P0001].', ['P0001']), ['P0001']).blocks[0].sources).toEqual(['P0001']);
  });
  it('retains insufficient/partial status and missing material independently from answer text', () => {
    const prepared = preparePaperQaTurn(session(), sources, 'A question');
    const raw = JSON.stringify({ answer: [{ text: '当前材料不足。', sources: [] }], status: 'insufficient', missing: '需要实验章节。' });
    const final = completePaperQaTurn(prepared.session, prepared.turnId, raw, { totalTokens: 150 });
    expect(final.turns[0]).toMatchObject({ answerStatus: 'insufficient', missing: '需要实验章节。', usage: { totalTokens: 150 } });
    expect(final.messages.at(-1)!.content).toBe(raw);
    expect(final.messages.slice(0, prepared.session.messages.length)).toEqual(prepared.session.messages);
  });
  it('projects only answer text across partial JSON and escape boundaries, never JSON keys or source arrays', () => {
    expect(streamedPaperQaText('{"answer":[{"text":"你好')).toBe('你好');
    expect(streamedPaperQaText('{"answer":[{"text":"A\\nB\\\"C\\\\D","sources":["P0001"]},{"text":"第二段')).toBe('A\nB"C\\D\n\n第二段');
    expect(streamedPaperQaText('{"answer":[{"text":"quote \\"text\\":value')).toContain('quote');
    expect(streamedPaperQaText('{"missing":"secret","answer":[')).toBe('');
    expect(streamedPaperQaText('{"answer":[{"metadata":{"text":"not the answer"},"text":"real","sources":["P0001"]}]}')).toBe('real');
    expect(streamedPaperQaText('{"answer":[{"text":"A\\u4f')).toBe('A');
    expect(streamedPaperQaText('{"answer":[{"text":"A\\ud83d')).toBe('A');
    expect(streamedPaperQaText('{"answer":[{"text":"A\\ud83d\\ude00')).toBe('A😀');
  });
  it('a format repair preserves the previous complete request as an exact prefix and is budget checked', () => {
    const prepared = preparePaperQaTurn(session(), sources, 'Question');
    const repair = paperQaRepairMessages(prepared.messages, 'not JSON');
    expect(repair.slice(0, prepared.messages.length)).toEqual(prepared.messages);
    expect(repair.at(-2)).toEqual({ role: 'assistant', content: 'not JSON' });
    expect(() => paperQaRepairMessages(prepared.messages, 'x'.repeat(400000))).toThrow('context-too-large');
  });
});

it('creates stable paragraph IDs and original evidence member mappings from real PDF.js-style geometry', () => {
  const page = pageBlocksFromTextContent({ items: [['1 Introduction', 750, 14], ['We introduce an anchored method for document reasoning.', 725, 10], ['2 Experiments', 690, 14], ['We evaluate the method on a fixed benchmark.', 665, 10]].map(([str, y, size]) => ({ str: String(str), transform: [Number(size), 0, 0, Number(size), 40, Number(y)], width: 260, height: Number(size), dir: 'ltr', fontName: 'test', hasEOL: true })), styles: {}, lang: 'en' }, 0, 'sha256:fixture');
  const pages = [page], ledger = pdfEvidenceLedgerFromPages(pages, 'sha256:fixture', pdfSectionCandidatesFromPages(pages, 'sha256:fixture'));
  const registry = buildPaperQaSources(ledger, pages);
  expect(registry).toEqual(buildPaperQaSources(ledger, pages));
  expect(registry.sourceVersion).toContain('sha256:fixture');
  expect(registry.sources.every(source => source.evidenceIds.length > 0)).toBe(true);
  expect(registry.sources.map(source => source.id)).toEqual(registry.sources.map((_, i) => `P${String(i + 1).padStart(4, '0')}`));
  expect(paperQaScopeSources(registry.sources, 'pre_experiments').some(source => source.text.includes('fixed benchmark'))).toBe(false);
});
