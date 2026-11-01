import { describe, expect, it } from 'vitest';
import { generateDetailedCandidate, prepareDetailedCandidate } from './overview-detailed';
import { pageBlocksFromTextContent } from '../../src/lib/pdfPageBlocks';
import { pdfEvidenceLedgerFromPages } from '../../src/lib/evidenceLedger';
import type { ModelConfig } from '../../src/lib/modelConfig';
import { createStructuredPaper } from '../../src/lib/structuredPaper';
import { selectDetailedContext } from '../../src/lib/detailedContext';
import type { CompatibleRequest } from '../../src/lib/compatibleProvider';
const config: ModelConfig = { baseUrl: 'https://example.test/v1', model: 'test', structuredOutput: true, contextLimit: 128000, outputLimit: 16000 };
function fixture() {
  const headings = ['1 Introduction', '2 Method', '3 Experiments', '4 Limitations'];
  const pages = headings.map((heading, p) => pageBlocksFromTextContent({ items: [
    { str: heading, transform: [12, 0, 0, 12, 50, 740], width: 230, height: 12, hasEOL: true, fontName: 'f', dir: 'ltr' },
    ...Array.from({ length: 20 }, (_, i) => ({ str: `Marker${p}line${i} explains the representation transformation and necessary training procedure with supervision and a decoder output.`, transform: [10, 0, 0, 10, 50, 720 - i * 12], width: 230, height: 10, hasEOL: true, fontName: 'f', dir: 'ltr' })),
  ], styles: {}, lang: null }, p, 'doc'));
  return { pages, ledger: pdfEvidenceLedgerFromPages(pages, 'doc', []), config };
}
function task(request: CompatibleRequest) { return JSON.parse(request.messages.at(-1)!.content); }
function validCompletion(request: CompatibleRequest) {
  const payload = [...request.messages].reverse().map(m => JSON.parse(m.content.startsWith('{') ? m.content : '{}')).find(p => p.legalSourceAliases);
  const alias = payload.legalSourceAliases[0];
  return { content: JSON.stringify({ status: 'available', text: `Source grounded ${alias}.`, sources: [alias] }), usage: { promptTokens: 10, completionTokens: 4 } };
}
describe('B112 source-prefix detailed overview experiment', () => {
  it('reuses exact source-only prefixes without feeding generated answers into later requests', () => {
    const plan = prepareDetailedCandidate(fixture());
    expect(plan.fallbackReason).toBeUndefined();
    const problem = plan.requests[0], method = plan.requests[1], contribution = plan.requests[2];
    expect(method.messages.slice(0, 2)).toEqual(problem.messages.slice(0, 2));
    expect(contribution.messages.slice(0, 2)).toEqual(method.messages.slice(0, 2));
    expect(contribution.messages).toHaveLength(3);
    expect(plan.requests.flatMap(item => item.messages).every(m => m.role !== 'assistant')).toBe(true);
    const methodSources = JSON.parse(method.messages[2].content).sources;
    expect(methodSources.map((s: { excerpt: string }) => s.excerpt).join(' ')).toContain('Marker1line19');
    expect(methodSources.every((s: object) => Object.keys(s).sort().join(',') === 'alias,excerpt,section')).toBe(true);
  });
  it('keeps all originally selected non-core paragraphs without prepending the full introduction', () => {
    const input = fixture(), plan = prepareDetailedCandidate(input);
    const paper = createStructuredPaper(plan.ledger, input.pages);
    const normalized = (text: string) => text.trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
    for (const id of ['experiments_ablations', 'limitations'] as const) {
      const item = plan.requests.find(request => request.id === id)!;
      const expected = new Set(selectDetailedContext(paper, id).paragraphs.map(p => normalized(p.text)));
      const groups = item.messages.slice(1, -1).map(m => JSON.parse(m.content));
      expect(groups.every(group => group.kind === 'paper_sources' && group.group === id)).toBe(true);
      const received = new Set(groups.flatMap(group => group.sources.map((source: { excerpt: string }) => normalized(source.excerpt))));
      expect(received).toEqual(expected);
      expect(item.sharedSourceCount).toBe(0);
    }
  });
  it('validates against the sources actually sent, not the full local alias registry', async () => {
    const input = fixture(), plan = prepareDetailedCandidate(input);
    const unsent = plan.requests[1].legalAliases.find(a => !plan.requests[0].legalAliases.includes(a))!;
    let count = 0;
    const result = await generateDetailedCandidate({ ...input, request: async request => {
      count++;
      return task(request).section === 'problem_motivation'
        ? { content: JSON.stringify({ status: 'available', text: `Not actually sent ${unsent}`, sources: [unsent] }) }
        : validCompletion(request);
    } });
    expect(result.diagnostics[0].failures?.[0].reason).toBe('source');
    expect(result.result.sections[0].status).toBe('unavailable');
    expect(count).toBe(5); // source errors do not trigger paid format retries
  });
  it('performs one format-only repair and publishes immutable completed snapshots', async () => {
    const calls: CompatibleRequest[] = [], snapshots: unknown[] = [];
    const result = await generateDetailedCandidate({ ...fixture(), onSectionComplete: sections => snapshots.push(sections), request: async request => {
      calls.push(request);
      if (task(request).section === 'method' && task(request).kind !== 'detailed_format_repair') return { content: '{broken json' };
      return validCompletion(request);
    } });
    expect(calls).toHaveLength(6);
    expect(result.diagnostics[1].formatRepairCount).toBe(1);
    expect(snapshots).toHaveLength(5); expect(Object.isFrozen(snapshots[0])).toBe(true);
    const firstMethod = calls.findIndex(request => task(request).section === 'method');
    expect(calls[firstMethod + 1].messages.slice(0, -1)).toEqual(calls[firstMethod].messages);
  });
  it('rejects cancellation before making any provider request', async () => {
    const controller = new AbortController(); controller.abort(); let calls = 0;
    await expect(generateDetailedCandidate({ ...fixture(), signal: controller.signal, request: async request => { calls++; return validCompletion(request); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });
  it('falls back before making experimental requests when review or capacity requires the production path', () => {
    expect(prepareDetailedCandidate({ ...fixture(), config: { ...config, semanticReview: true } }).fallbackReason).toContain('semantic-review');
    expect(prepareDetailedCandidate({ ...fixture(), config: { ...config, contextLimit: 4000 } }).fallbackReason).toContain('independent');
  });
});
