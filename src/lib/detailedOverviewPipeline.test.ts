import { describe, expect, it } from 'vitest';
import { generateIndependentDetailedOverview as generateDetailedOverview } from './detailedOverviewPipeline';
import { pageBlocksFromTextContent } from './pdfPageBlocks';
import { locateEvidenceCandidate, pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { createDetailedEvidenceLedger, createStructuredPaper } from './structuredPaper';
import { requestBudget, selectDetailedContext } from './detailedContext';
import type { CompatibleRequest } from './compatibleProvider';
import type { ModelConfig } from './modelConfig';
import type { DetailedOverviewSection } from './detailedOverview';
const config: ModelConfig = { baseUrl: 'https://example.test/v1', model: 'test', structuredOutput: true, contextLimit: 128000, outputLimit: 16000 };
function fixture(count = 3, extraSections = false) {
  const pages = Array.from({ length: count }, (_, p) => pageBlocksFromTextContent({
    items: [
      { str: p === 0 ? '1 Introduction' : extraSections && p === count - 2 ? `${p + 1} Experiments` : extraSections && p === count - 1 ? `${p + 1} Limitations` : `${p + 1} Method`, transform: [12, 0, 0, 12, 50, 740], width: 230, height: 12, hasEOL: true, fontName: 'f', dir: 'ltr' },
      ...Array.from({ length: 30 }, (_, i) => ({ str: `Marker${p}line${i} explains the representation transformation and necessary training procedure with supervision and a decoder output.`, transform: [10, 0, 0, 10, 50, 720 - i * 12], width: 230, height: 10, hasEOL: true, fontName: 'f', dir: 'ltr' })),
    ], styles: {}, lang: null,
  }, p, 'doc'));
  return { pages, ledger: pdfEvidenceLedgerFromPages(pages, 'doc', []) };
}
function payload(request: CompatibleRequest) {
  return JSON.parse([...request.messages].reverse().find(message => message.role === 'user' && message.content.includes('newSources'))!.content) as { section: string; newSources: Array<{ alias: string; excerpt: string }>; readingPlan: { batch: number; batchCount: number }; instruction: string };
}
function completion(request: CompatibleRequest) {
  const sources = payload(request).newSources.map(source => source.alias);
  return { content: JSON.stringify({ status: 'available', text: `完整解释 ${sources[0]}。`, sources }), usage: { promptTokens: 100, completionTokens: 50 } };
}
describe('independent complete chapter overview pipeline', () => {
  it('publishes each completed column before later requests with detached immutable anchors', async () => {
    const snapshots: Array<readonly DetailedOverviewSection[]> = [];
    const output = await generateDetailedOverview({ ...fixture(5, true), config,
      onSectionComplete: sections => snapshots.push(sections),
      request: async request => {
        if (payload(request).section === 'method') {
          expect(snapshots).toHaveLength(1);
          expect(snapshots[0].map(section => section.id)).toEqual(['problem']);
          expect(snapshots[0][0].blocks[0].evidenceRefs?.[0].evidenceIds.length).toBeGreaterThan(0);
        }
        return completion(request);
      },
    });
    expect(snapshots.map(sections => sections.length)).toEqual([1, 2, 3, 4, 5]);
    expect(snapshots[4]).toEqual(output.result.sections);
    expect(snapshots[0][0]).not.toBe(snapshots[4][0]);
    expect(Object.isFrozen(snapshots[0])).toBe(true);
    expect(Object.isFrozen(snapshots[0][0].blocks[0].evidenceRefs?.[0].evidenceIds)).toBe(true);
    output.result.sections[0].blocks[0].text = 'mutated return';
    expect(snapshots[0][0].blocks[0].text).not.toBe('mutated return');
  });

  it('withholds a method draft until repair and semantic review finish', async () => {
    const snapshots: Array<readonly DetailedOverviewSection[]> = [];
    let reviews = 0;
    const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true },
      onSectionComplete: sections => snapshots.push(sections),
      request: async request => {
        if (payload(request).section === 'method') {
          expect(snapshots).toHaveLength(1);
          if (request.messages.at(-1)!.content.includes('method_semantic_review')) {
            reviews++;
            const response = completion(request);
            return { ...response, content: response.content.replace('完整解释', 'verified replacement') };
          }
          return { content: '{broken method draft' };
        }
        return completion(request);
      },
    });
    expect(reviews).toBe(1);
    expect(snapshots[1][1].blocks).toHaveLength(reviews);
    expect(snapshots[1][1].blocks.every(block => block.text.includes('verified replacement'))).toBe(true);
    expect(snapshots[1][1]).toEqual(output.result.sections[1]);
  });

  it('keeps the published first column unchanged when cancelled during a later request', async () => {
    const snapshots: Array<readonly DetailedOverviewSection[]> = [];
    const controller = new AbortController();
    let requests = 0;
    await expect(generateDetailedOverview({ ...fixture(), config, signal: controller.signal,
      onSectionComplete: sections => snapshots.push(sections),
      request: async request => {
        requests++;
        if (payload(request).section === 'method') controller.abort();
        return completion(request);
      },
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toBe(2);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0][0].status).toBe('available');
  });

  it('publishes a failed column without discarding earlier verified output or exposing invalid prose', async () => {
    const snapshots: Array<readonly DetailedOverviewSection[]> = [];
    await generateDetailedOverview({ ...fixture(), config,
      onSectionComplete: sections => snapshots.push(sections),
      request: async request => payload(request).section === 'method'
        ? { content: JSON.stringify({ status: 'available', text: 'UNSUPPORTED E999', sources: ['E999'] }) }
        : completion(request),
    });
    expect(snapshots[1][0]).toEqual(snapshots[0][0]);
    expect(snapshots[1][1].status).toBe('unavailable');
    expect(JSON.stringify(snapshots)).not.toContain('UNSUPPORTED');
  });

  it('sends full intro and method paragraphs without the old 5-source or 1500-character truncation', async () => {
    const source = fixture(7);
    const requests: CompatibleRequest[] = [];
    const usages: unknown[] = [];
    const result = await generateDetailedOverview({ ...source, config, onUsage: usage => usages.push(usage), request: async request => { requests.push(request); return completion(request); } });
    const method = requests.find(request => payload(request).section === 'method')!;
    const inputs = payload(method).newSources;
    expect(inputs.length).toBeGreaterThan(5);
    expect(inputs.some(input => input.excerpt.length > 1500)).toBe(true);
    expect(inputs.map(input => input.excerpt).join(' ')).toContain('Marker6line29');
    expect(method.config.outputLimit).toBeGreaterThanOrEqual(12000);
    expect(result.result.sections).toHaveLength(5);
    expect(usages).toHaveLength(requests.length);
    const ledger = createDetailedEvidenceLedger(source.ledger, source.pages);
    for (const section of result.result.sections) for (const block of section.blocks) for (const id of block.evidenceIds) {
      expect(locateEvidenceCandidate(ledger.candidates.find(candidate => candidate.evidenceId === id)!, source.pages)).toBeDefined();
    }
  });

  it('covers the chapter tail in bounded requests and gives merged output globally distinct source aliases', async () => {
    const source = fixture(8);
    const small = { ...config, contextLimit: 6500, outputLimit: 1500 };
    const requests: CompatibleRequest[] = [];
    const snapshots: Array<readonly DetailedOverviewSection[]> = [];
    const output = await generateDetailedOverview({ ...source, config: small,
      onSectionComplete: sections => snapshots.push(sections),
      request: async request => {
        if (payload(request).section === 'method') expect(snapshots).toHaveLength(1);
        requests.push(request); return completion(request);
      },
    });
    expect(snapshots[1][1]).toEqual(output.result.sections[1]);
    const method = requests.filter(request => payload(request).section === 'method');
    expect(method.length).toBeGreaterThan(1);
    expect(method.every(request => payload(request).instruction.includes('不得每批各写一份整栏篇幅'))).toBe(true);
    const text = method.flatMap(request => payload(request).newSources.map(source => source.excerpt)).join('\n');
    const selected = selectDetailedContext(createStructuredPaper(createDetailedEvidenceLedger(source.ledger, source.pages), source.pages), 'method');
    for (const paragraph of selected.paragraphs) for (const member of paragraph.members) expect(text).toContain(member.candidate.quote);
    for (const request of requests) {
      const budget = requestBudget(request.messages, { ...small, outputLimit: request.config.outputLimit });
      expect(budget.canSend).toBe(true);
      expect(budget.inputTokens + request.config.outputLimit + budget.safetyMargin).toBeLessThanOrEqual(small.contextLimit);
    }
    const refs = output.result.sections.flatMap(section => section.blocks.flatMap(block => block.evidenceRefs ?? []));
    expect(new Set(refs.map(ref => ref.alias)).size).toBe(refs.length);
    expect(output.diagnostics.find(item => item.id === 'method')?.warnings.join(' ')).toContain('joined in source order');
    expect(output.diagnostics.find(item => item.id === 'method')?.usage?.promptTokens).toBe(100 * method.length);
  });

  it('stops immediately on cancellation before or during a request', async () => {
    const source = fixture();
    const controller = new AbortController();
    let calls = 0;
    await expect(generateDetailedOverview({ ...source, config, signal: controller.signal, request: async request => {
      calls++; controller.abort(); return completion(request);
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
    await expect(generateDetailedOverview({ ...source, config, signal: controller.signal, request: async request => { calls++; return completion(request); } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(calls).toBe(1);
  });

  it('discards unsupported aliases rather than exposing unverified prose', async () => {
    const result = await generateDetailedOverview({ ...fixture(), config, request: async () => ({ content: JSON.stringify({ status: 'available', text: 'Unsupported E999', sources: ['E999'] }) }) });
    expect(result.result.sections.every(section => section.status === 'unavailable')).toBe(true);
    expect(JSON.stringify(result.result)).not.toContain('Unsupported');
    expect(result.result.sections.every(section => section.blocks.every(block => block.evidenceIds.length === 0))).toBe(true);
  });

  it('retains completed sections after provider failure and marks a mixed batch section incomplete', async () => {
    let failed = false;
    const output = await generateDetailedOverview({ ...fixture(8), config: { ...config, contextLimit: 6500, outputLimit: 1500 }, request: async request => {
      if (payload(request).section === 'method' && !failed) { failed = true; throw new Error('Provider unavailable'); }
      return completion(request);
    } });
    expect(output.result.sections[0].status).toBe('available');
    const method = output.result.sections.find(section => section.id === 'method')!;
    expect(method.status).toBe('unavailable');
    expect(method.failureReason).toBe('request');
    expect(method.blocks.some(block => block.claimKind === 'missing_information')).toBe(true);
    expect(method.blocks.some(block => block.evidenceIds.length > 0)).toBe(true);
    expect(output.result.sections.find(section => section.id === 'contributions_novelty')?.status).toBe('available');
    expect(output.diagnostics.find(item => item.id === 'method')?.failures).toContainEqual(expect.objectContaining({ reason: 'request' }));
  });

  it('uses original sources to correct a method draft and counts review usage', async () => {
    const reviewed: CompatibleRequest[] = [];
    const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => {
      const base = completion(request);
      if (request.messages.at(-1)!.content.includes('method_semantic_review')) {
        reviewed.push(request);
        return { ...base, content: base.content.replace('完整解释', '纠正后的点积解释') };
      }
      return base;
    } });
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].messages.at(-1)!.content).toContain('unverifiedDraft');
    expect(reviewed[0].messages.at(-1)!.content).toContain('不扩写初稿');
    expect(reviewed[0].messages.at(-1)!.content).toContain('1000–1400');
    expect(reviewed[0].messages.at(-1)!.content).not.toContain('900–1600');
    expect(reviewed[0].messages.at(-2)!.content).toContain('newSources');
    expect(output.result.sections.find(section => section.id === 'method')?.blocks[0].text).toContain('纠正后的点积解释');
    expect(output.diagnostics.find(item => item.id === 'method')).toMatchObject({ semanticReviewCount: 1, usage: { promptTokens: 200 } });
  });

  it('retains a source-bound draft if the semantic reviewer fails or invents a source', async () => {
    for (const failure of ['provider', 'source']) {
      const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => {
        if (request.messages.at(-1)!.content.includes('method_semantic_review')) {
          if (failure === 'provider') throw new Error('Review unavailable');
          return { content: '{"status":"available","text":"错误 E999","sources":["E999"]}' };
        }
        return completion(request);
      } });
      expect(output.result.sections.find(section => section.id === 'method')?.blocks[0].text).toContain('完整解释');
      expect(output.diagnostics.find(item => item.id === 'method')?.warnings.join(' ')).toContain('without a successful semantic review');
    }
  });

  it('repairs malformed method drafts only through a strictly verified review replacement', async () => {
    for (const repair of [true, false]) {
      let reviews = 0;
      const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => {
        const method = payload(request).section === 'method';
        if (request.messages.at(-1)!.content.includes('method_semantic_review')) {
          reviews++;
          return repair ? completion(request) : { content: '{bad review' };
        }
        return method ? { content: '{"status":"available","text":"bad "quote" here","sources":["E001"]}' } : completion(request);
      } });
      expect(reviews).toBe(1);
      expect(output.result.sections.find(section => section.id === 'method')?.status).toBe(repair ? 'available' : 'unavailable');
      expect(output.diagnostics.find(item => item.id === 'method')?.semanticReviewCount ?? 0).toBe(repair ? 1 : 0);
      expect(JSON.stringify(output.result)).not.toContain('bad');
    }
  });

  it('attributes an unsendable format repair to budget without discarding valid review drafts', async () => {
    for (const valid of [false, true]) {
      let methodCalls = 0;
      const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => {
        if (payload(request).section !== 'method') return completion(request);
        methodCalls++;
        if (!valid) return { content: '{broken' + 'x'.repeat(600000) };
        const reply = JSON.parse(completion(request).content);
        reply.text += 'x'.repeat(600000);
        return { content: JSON.stringify(reply) };
      } });
      const method = output.result.sections.find(section => section.id === 'method')!;
      expect(methodCalls).toBe(1);
      expect(method.status).toBe(valid ? 'available' : 'unavailable');
      expect(method.failureReason).toBe(valid ? undefined : 'budget');
      const diagnostic = output.diagnostics.find(section => section.id === 'method')!;
      if (valid) expect(diagnostic.semanticReviewSkipped).toBe(1);
      else expect(diagnostic.failures).toEqual([{ reason: 'budget', detail: expect.any(String) }]);
    }
  });

  it('records a failed format repair once with its specific local validation error', async () => {
    const output = await generateDetailedOverview({ ...fixture(), config, request: async () => ({ content: '{broken' }) });
    for (const diagnostic of output.diagnostics.filter(section => section.batchCount > 0)) {
      expect(diagnostic.failures).toHaveLength(diagnostic.batchCount);
      expect(diagnostic.failures?.every(failure => failure.reason === 'format' && failure.detail === 'The model response was not valid detailed-section JSON.')).toBe(true);
    }
  });

  it('defaults to one generation call per selected section without semantic review', async () => {
    const calls: CompatibleRequest[] = [];
    const output = await generateDetailedOverview({ ...fixture(), config, request: async request => { calls.push(request); return completion(request); } });
    expect(calls.every(request => request.messages.length === 2)).toBe(true);
    expect(output.diagnostics.every(item => !item.semanticReviewEnabled && !item.semanticReviewCount)).toBe(true);
  });

  it('repairs JSON and schema errors once across detailed sections with review disabled', async () => {
    for (const broken of ['{bad JSON', '{"status":"available","text":"existing claim","sources":"E001"}']) {
      const calls: CompatibleRequest[] = [];
      const output = await generateDetailedOverview({ ...fixture(5, true), config, request: async request => {
        calls.push(request);
        if (request.messages.at(-1)!.content.includes('detailed_format_repair')) return completion(request);
        return { content: broken };
      } });
      const repaired = output.diagnostics.filter(item => item.batchCount > 0);
      expect(repaired).toHaveLength(5);
      expect(repaired.every(item => item.formatRepairCount === item.batchCount)).toBe(true);
      expect(calls).toHaveLength(repaired.reduce((n, item) => n + item.batchCount * 2, 0));
      expect(calls.some(request => request.messages.at(-1)!.content.includes('method_semantic_review'))).toBe(false);
      expect(output.result.sections.filter(section => section.blocks[0].evidenceIds.length > 0).every(section => section.status === 'available')).toBe(true);
    }
  });

  it('never treats unknown or undeclared source aliases as a format repair, even with review enabled', async () => {
    for (const response of [
      { status: 'available', text: 'Wrong E999', sources: ['E999'] },
      { status: 'available', text: 'Undeclared E999', sources: ['E001'] },
    ]) {
      const calls: CompatibleRequest[] = [];
      const output = await generateDetailedOverview({ ...fixture(), config: { ...config, semanticReview: true }, request: async request => { calls.push(request); return { content: JSON.stringify(response) }; } });
      expect(calls.every(request => request.messages.length === 2)).toBe(true);
      expect(output.result.sections.every(section => section.status === 'unavailable')).toBe(true);
      expect(output.result.sections.every(section => section.failureReason === 'source' || section.failureReason === 'no_context')).toBe(true);
    }
  });

  it('cancels during the one format repair without issuing later requests', async () => {
    const controller = new AbortController();
    let count = 0;
    await expect(generateDetailedOverview({ ...fixture(), config, signal: controller.signal, request: async () => {
      count++;
      if (count === 2) controller.abort();
      return { content: '{broken' };
    } })).rejects.toMatchObject({ name: 'AbortError' });
    expect(count).toBe(2);
  });

  it('distinguishes model refusal from invalid JSON and omits arbitrary provider errors', async () => {
    for (const reason of ['model_unavailable', 'format', 'request'] as const) {
      const output = await generateDetailedOverview({ ...fixture(), config, request: async () => {
        if (reason === 'request') throw new Error('secret-key https://provider.test/private');
        return { content: reason === 'format' ? '{broken' : JSON.stringify({ status: 'unavailable', text: 'Supplied context lacks the necessary explanation.', sources: [] }) };
      } });
      expect(output.result.sections.every(section => section.failureReason === reason || section.failureReason === 'no_context')).toBe(true);
      expect(output.diagnostics.every(diagnostic => diagnostic.failures?.some(failure => failure.reason === reason || failure.reason === 'no_context'))).toBe(true);
      expect(JSON.stringify(output.diagnostics)).not.toMatch(/secret-key|provider.test/);
    }
  });

  it('refuses a context too small for the instructions without sending any request', async () => {
    let calls = 0;
    const output = await generateDetailedOverview({ ...fixture(), config: { ...config, contextLimit: 500, outputLimit: 100 }, request: async request => { calls++; return completion(request); } });
    expect(output.result.sections.every(section => section.failureReason === 'budget' || section.failureReason === 'no_context')).toBe(true);
    expect(output.diagnostics.every(diagnostic => diagnostic.failures?.[0].reason === 'budget' || diagnostic.failures?.[0].reason === 'no_context')).toBe(true);
    expect(calls).toBe(0);
  });
});
