import { describe, expect, it } from 'vitest';
import { prepareSharedDetailedOverview } from './detailedOverviewShared';
import { generateDetailedOverview } from './detailedOverviewPipeline';
import { PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION } from './detailedOverview';
import { pageBlocksFromTextContent } from './pdfPageBlocks';
import { pdfEvidenceLedgerFromPages } from './evidenceLedger';
import type { ModelConfig } from './modelConfig';
import { createStructuredPaper } from './structuredPaper';
import { selectDetailedContext } from './detailedContext';
import type { CompatibleRequest } from './compatibleProvider';
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
describe('default source-prefix detailed overview pipeline', () => {
  it('reuses exact source-only prefixes without feeding generated answers into later requests', () => {
    const plan = prepareSharedDetailedOverview(fixture());
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
    const input = fixture(), plan = prepareSharedDetailedOverview(input);
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
  it('routes the public default wrapper through the shared source-only path and current cache generation', async () => {
    const calls: CompatibleRequest[] = [];
    const result = await generateDetailedOverview({ ...fixture(), request: async request => { calls.push(request); return validCompletion(request); } });
    expect(calls).toHaveLength(5);
    expect(calls.every(request => task(request).promptVersion === PROGRESSIVE_DETAILED_OVERVIEW_PROMPT_VERSION)).toBe(true);
    expect(calls.every(request => task(request).contextStrategy === 'detailed-shared-context-v1')).toBe(true);
    expect(calls.every(request => !('newSources' in task(request)) && request.messages.every(message => message.role !== 'assistant'))).toBe(true);
    expect(result.result.sections.every(section => section.status === 'available')).toBe(true);
  });
  it('validates against the sources actually sent, not the full local alias registry', async () => {
    const input = fixture(), plan = prepareSharedDetailedOverview(input);
    const unsent = plan.requests[1].legalAliases.find(a => !plan.requests[0].legalAliases.includes(a))!;
    let count = 0;
    const result = await generateDetailedOverview({ ...input, request: async request => {
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
    const result = await generateDetailedOverview({ ...fixture(), onSectionComplete: sections => snapshots.push(sections), request: async request => {
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
    await expect(generateDetailedOverview({ ...fixture(), signal: controller.signal, request: async request => { calls++; return validCompletion(request); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(0);
  });
  it('falls back before making experimental requests when review or capacity requires the production path', () => {
    expect(prepareSharedDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true } }).fallbackReason).toContain('semantic-review');
    expect(prepareSharedDetailedOverview({ ...fixture(), config: { ...config, contextLimit: 4000 } }).fallbackReason).toContain('independent');
  });
  it('keeps earlier published output when a later source check fails', async () => {
    const snapshots: Array<readonly { status: string; blocks: { text: string }[] }[]> = [];
    const result = await generateDetailedOverview({ ...fixture(), onSectionComplete: sections => snapshots.push(sections), request: async request => {
      if (task(request).section === 'method') return { content: JSON.stringify({ status: 'available', text: 'UNSUPPORTED E999', sources: ['E999'] }) };
      return validCompletion(request);
    } });
    expect(snapshots).toHaveLength(5);
    expect(snapshots[1][0]).toEqual(snapshots[0][0]);
    expect(snapshots[1][1].status).toBe('unavailable');
    expect(JSON.stringify(result.result)).not.toContain('UNSUPPORTED');
    expect(result.diagnostics[1].failures?.[0].reason).toBe('source');
  });
  it('cancels during format repair without publishing the unfinished column', async () => {
    const controller = new AbortController(), snapshots: unknown[] = [];
    let count = 0;
    await expect(generateDetailedOverview({ ...fixture(), signal: controller.signal, onSectionComplete: sections => snapshots.push(sections), request: async request => {
      count++;
      if (task(request).kind === 'detailed_format_repair') { controller.abort(); return validCompletion(request); }
      return task(request).section === 'method' ? { content: '{broken' } : validCompletion(request);
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(count).toBe(3); expect(snapshots).toHaveLength(1);
  });
  it('routes enabled semantic review to the independent runner instead of skipping that setting', async () => {
    const calls: CompatibleRequest[] = [];
    const result = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => { calls.push(request); return validCompletion(request); } });
    expect(calls.some(request => task(request).kind === 'method_semantic_review')).toBe(true);
    expect(calls.some(request => task(request).contextStrategy)).toBe(false);
    expect(result.diagnostics.every(diagnostic => diagnostic.warnings.some(warning => warning.includes('fallback:')))).toBe(true);
    expect(result.diagnostics.find(diagnostic => diagnostic.id === 'method')?.semanticReviewCount).toBe(1);
  });
  it('chooses capacity fallback before any provider request and retains budget failures', async () => {
    let calls = 0;
    const result = await generateDetailedOverview({ ...fixture(), config: { ...config, contextLimit: 500, outputLimit: 100 }, request: async request => { calls++; return validCompletion(request); } });
    expect(calls).toBe(0);
    expect(result.diagnostics.every(diagnostic => diagnostic.warnings.some(warning => warning.includes('fallback:')))).toBe(true);
    expect(result.result.sections.every(section => section.failureReason === 'budget' || section.failureReason === 'no_context')).toBe(true);
  });
  it('allows only one format repair and never exposes provider error text in diagnostics', async () => {
    const calls = new Map<string, number>();
    const result = await generateDetailedOverview({ ...fixture(), request: async request => {
      const section = task(request).section;
      calls.set(section, (calls.get(section) ?? 0) + 1);
      if (section === 'method') return { content: '{broken' };
      if (section === 'problem_motivation') throw new Error('private-api-key https://private-provider.test');
      return validCompletion(request);
    } });
    expect(calls.get('method')).toBe(2);
    expect(result.diagnostics[1].failures?.[0].reason).toBe('format');
    expect(result.diagnostics[0].failures?.[0].reason).toBe('request');
    expect(JSON.stringify(result.diagnostics)).not.toMatch(/private-api-key|private-provider/);
  });
});
