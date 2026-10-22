import { describe, expect, it } from 'vitest';
import { estimateMessagesTokens, estimateTextTokens, partitionParagraphs, requestBudget, selectDetailedContext } from './detailedContext';
import { STRUCTURED_PAPER_VERSION, type StructuredPaper, type StructuredParagraph, type StructuredSection } from './structuredPaper';
function paragraph(id: string, text: string, role: StructuredParagraph['role'] = 'method'): StructuredParagraph {
  let cursor = 0;
  return { paragraphId: id, passageId: id, sectionId: id, sectionTitle: id, role, kind: 'body', readOrder: Number(id.replace(/\D/g, '')) || 0, column: 0, pageIndex: 0, text, diagnostics: [],
    members: text.split(' ').map((quote, index) => {
      const start = cursor; cursor += quote.length + 1;
      return { textStart: start, textEnd: start + quote.length, candidate: { evidenceId: `${id}:${index}`, blockId: `${id}:${index}`, quote, normalizedStart: 0, normalizedEnd: quote.length, slot: 'method_overview', precision: 'block', section: { title: id, confidence: 'automatic' }, coverage: 'full-text', qualityWarnings: [] } };
    }) };
}
function paper(): StructuredPaper {
  const specs: Array<[string, string, StructuredSection['role'], string?]> = [
    ['1', '1 Introduction', 'intro'], ['2', '2 Architecture', 'method'], ['3', '2.1 Secret mechanism', 'unknown', '2'],
    ['4', '3 Evaluation Settings', 'experiments'], ['5', '4 Unfamiliar design', 'unknown'], ['6', 'References', 'references'],
    ['7', 'Appendix A Training', 'appendix'], ['8', 'A.1 Schedule', 'method', '7'], ['9', 'Appendix B Survey', 'appendix'],
  ];
  const sections = specs.map(([sectionId, title, role, parentId]) => ({ sectionId, title, role, parentId, level: parentId ? 2 : 1, children: specs.filter(s => s[3] === sectionId).map(s => s[0]), paragraphIds: [sectionId], startPage: 0, endPage: 0 }));
  const paragraphs = specs.map(([id, , role]) => paragraph(id, id === '2' ? 'See Appendix A for training details.' : 'Complete chapter content.', role));
  return { version: STRUCTURED_PAPER_VERSION, documentVersion: 'doc', paragraphs, sections, coverage: 'full-text', diagnostics: [], unrepresentedBlockCount: 0 };
}
describe('focused body context', () => {
  it('never follows appendix references and excludes appendix descendants regardless of role', () => {
    const p = paper();
    const result = selectDetailedContext(p, 'method');
    expect(result.sections.map(s=>s.sectionId)).not.toEqual(expect.arrayContaining(['7', '8', '9']));
    expect(result.paragraphs.some(p=>['7','8','9'].includes(p.sectionId))).toBe(false);
    expect(result.warnings.join(' ')).toContain('Appendices');
  });
  it('excludes lettered and explicitly titled supplementary chapters even with unknown roles', () => {
    const p = paper(); p.sections.find(s=>s.sectionId==='7')!.role='unknown';
    p.sections.find(s=>s.sectionId==='9')!.role='unknown'; p.sections.find(s=>s.sectionId==='9')!.title='B. Training Details';
    expect(selectDetailedContext(p,'method').sections.map(s=>s.sectionId)).not.toEqual(expect.arrayContaining(['7','8','9']));
  });
  it('keeps complete method paragraphs and necessary experimental setup, never results or ablations inherited as method', () => {
    const p=paper();
    p.paragraphs.forEach(x=>x.text=`Unique ${x.sectionId}`);
    p.sections.find(s=>s.sectionId==='4')!.title='3 Experiments and Results';
    p.sections.push({sectionId:'10',title:'3.1 Training Settings',role:'method',parentId:'4',children:[],paragraphIds:['10'],level:2,startPage:0,endPage:0},
      {sectionId:'11',title:'3.2 Ablation Results',role:'method',parentId:'4',children:[],paragraphIds:['11'],level:2,startPage:0,endPage:0});
    p.sections.find(s=>s.sectionId==='4')!.children=['10','11'];
    p.paragraphs.push(paragraph('10','Training learning rate details.'),paragraph('11','Ablation result metrics.'));
    const r=selectDetailedContext(p,'method');
    expect(r.paragraphs.map(p=>p.paragraphId)).toEqual(['1','2','3','10']);
    expect(selectDetailedContext(p,'experiments_ablations').paragraphs.map(p=>p.paragraphId)).toEqual(['4','10','11']);
  });
  it('keeps theoretical analysis within a method chapter and does not mistake the article A for an appendix label', () => {
    const p=paper();p.paragraphs.forEach(x=>x.text=`Unique ${x.sectionId}`);
    p.sections.push({sectionId:'10',title:'2.2 Theoretical and Convergence Analysis',role:'method',parentId:'2',children:[],paragraphIds:['10'],level:2,startPage:0,endPage:0},
      {sectionId:'11',title:'A New Method',role:'method',children:[],paragraphIds:['11'],level:1,startPage:0,endPage:0});
    p.paragraphs.push(paragraph('10','The proof defines convergence bounds.'),paragraph('11','This method contains full definitions.'));
    const ids=selectDetailedContext(p,'method').paragraphs.map(p=>p.paragraphId);
    expect(ids).toContain('10');expect(ids).toContain('11');
  });
  it('selects intro paragraphs using transparent content rules without a paragraph count cap', () => {
    const p=paper(); p.paragraphs=p.paragraphs.filter(p=>p.sectionId!=='1');
    for(let i=0;i<9;i++) p.paragraphs.push({...paragraph(`intro${i}`,`We propose a task-specific model component ${i}.`,'intro'),sectionId:'1'});
    p.paragraphs.push({...paragraph('intro99','Unrelated historical anecdote.','intro'),sectionId:'1'});
    const r=selectDetailedContext(p,'method');
    expect(r.paragraphs.filter(p=>p.sectionId==='1')).toHaveLength(9);
    expect(r.paragraphs.some(p=>p.paragraphId==='intro99')).toBe(false);
  });
  it('falls back to intro if no intro rule matches, without adding unknown body to every column', () => {
    const p=paper(); p.paragraphs.forEach(x=>x.text=`Unique ${x.sectionId}`);
    expect(selectDetailedContext(p,'problem_motivation').paragraphs.map(p=>p.paragraphId)).toEqual(['1']);
    expect(selectDetailedContext(p,'limitations').paragraphs).toEqual([]);
    p.sections.find(s=>s.sectionId==='2')!.role='unknown';
    const r=selectDetailedContext(p,'method');
    expect(r.paragraphs.map(p=>p.paragraphId)).toEqual(['1','4']); // recognized evaluation settings is a necessary detail section
    p.sections.find(s=>s.sectionId==='4')!.title='3 Experiments';
    const fallback=selectDetailedContext(p,'method');
    expect(fallback.paragraphs.map(p=>p.paragraphId)).toEqual(['1']);
    expect(fallback.warnings.join(' ')).toContain('No confident method');
  });
  it('deduplicates only exact whitespace-normalized copies; similar definitions and original members survive', () => {
    const p=paper();const a=paragraph('21','A module uses a learned query.');a.sectionId='2';
    const b=paragraph('22','A  module uses a learned query.');b.sectionId='2';
    const c=paragraph('23','A module uses two learned queries.');c.sectionId='2';
    p.paragraphs.push(a,b,c);
    const r=selectDetailedContext(p,'method');
    expect(r.paragraphs).toContain(a);expect(r.paragraphs).not.toContain(b);expect(r.paragraphs).toContain(c);
    expect(r.paragraphs.find(p=>p.paragraphId==='21')!.members).toBe(a.members);
    expect(r.paragraphs.find(p=>p.paragraphId==='23')!.members).toBe(c.members);
  });
  it('limits limitations to designated discussion and conclusion chapters and excludes full experiments', () => {
    const p=paper();p.sections.find(s=>s.sectionId==='5')!.role='limitations';p.paragraphs.find(p=>p.sectionId==='5')!.text='A known limitation.';
    expect(selectDetailedContext(p,'limitations').paragraphs.map(p=>p.paragraphId)).toEqual(['5']);
  });
});
// Consecutive paragraphs within one intro subsection, with stable original evidence members.
function introPaper(texts: string[]): StructuredPaper {
  const p = paper();
  p.paragraphs = texts.map((text, i) => ({ ...paragraph(`p${i}`, text, 'intro'), sectionId: '1', readOrder: i }));
  return p;
}
describe('complete motivation and bounded adjacent context', () => {
  it('keeps the complete introduction, including premises and central questions without keyword matches', () => {
    const p = introPaper(['Credit is broadcast across every token.', 'A central question is whether attention can distribute credit.', 'We propose a token-level objective.', '12', 'Under review at Some Conference 2026']);
    const r = selectDetailedContext(p, 'problem_motivation');
    expect(r.paragraphs).toEqual(p.paragraphs.slice(0, 3));
    expect(r.paragraphs[0].members).toBe(p.paragraphs[0].members);
  });
  it.each(['This gap', 'These limitations', 'Such challenges', 'The above observation', 'To address this key issue', 'This central question', 'To this end', 'In this context', 'Therefore', 'However', '为解决上述关键问题', '这一局限', '这些挑战', '因此', '基于此'])('retains the preceding premise for %s', cue => {
    const p = introPaper(['An otherwise unmatched premise.', `${cue}, our method assigns credit.`]);
    expect(selectDetailedContext(p, 'method').paragraphs).toEqual(p.paragraphs);
  });
  it('keeps a following dependent paragraph but never expands the added paragraph again', () => {
    const p = introPaper(['Our method uses visual credit.', 'This observation supports a bounded coefficient.', 'This gap receives an unrelated treatment.']);
    const r = selectDetailedContext(p, 'method');
    expect(r.paragraphs.map(p => p.paragraphId)).toEqual(['p0', 'p1']);
    expect(r.warnings.join(' ')).toContain('added 1 paragraphs');
  });
  it('does not expand ordinary internal mentions, complete neighboring prose or lists', () => {
    const p = introPaper(['A historical premise.', 'Our method discusses this gap in its proof.', 'An unrelated final remark.', 'This gap, our method explains.']);
    p.paragraphs[3].kind = 'table';
    expect(selectDetailedContext(p, 'method').paragraphs.map(p => p.paragraphId)).toEqual(['p1', 'p3']);
    const list = introPaper(['- A numbered premise.', 'This gap motivates our method.']);
    expect(selectDetailedContext(list, 'method').paragraphs.map(p => p.paragraphId)).toEqual(['p1']);
  });
  it('preserves cross-page continuation past an isolated page number, with original anchors', () => {
    const p = introPaper(['Our method processes the visual', '42', 'features before computing credit.']);
    p.paragraphs[2].pageIndex = 1;
    const r = selectDetailedContext(p, 'method');
    expect(r.paragraphs).toEqual([p.paragraphs[0], p.paragraphs[2]]);
    expect(r.paragraphs[1].members).toBe(p.paragraphs[2].members);
  });
  it('keeps a short equation and its immediate symbol explanation as complete anchored paragraphs', () => {
    const p = introPaper(['Our method defines the coefficient as:', 'a = b + c', 'where b represents visual credit.', 'An unrelated observation.']);
    p.paragraphs[1].kind = 'equation';
    const r = selectDetailedContext(p, 'method');
    expect(r.paragraphs).toEqual(p.paragraphs.slice(0, 3));
    r.paragraphs.forEach((x, i) => expect(x.members).toBe(p.paragraphs[i].members));
  });
  it('does not cross subsection headings, remote pages, appendix or reference boundaries', () => {
    for (const boundary of ['heading', 'subsection', 'remote', 'appendix', 'references'] as const) {
      const p = introPaper(['Our method defines a procedure:', 'This observation gives its implications.']);
      if (boundary === 'heading') { p.paragraphs[1].kind = 'heading'; p.paragraphs.push({...paragraph('p2', 'This observation is after a heading.', 'intro'), sectionId:'1', readOrder:2}); }
      if (boundary === 'remote') p.paragraphs[1].pageIndex = 3;
      if (boundary === 'appendix' || boundary === 'references') p.paragraphs[1].role = boundary;
      if (boundary === 'subsection') p.paragraphs[1].sectionId = '5';
      expect(selectDetailedContext(p, 'method').paragraphs.map(x => x.paragraphId), boundary).toEqual(boundary === 'heading' ? ['p0', 'p1'] : ['p0']);
    }
  });
  it('caps added input and reports skipped neighbors rather than truncating source text', () => {
    const p = introPaper(Array.from({length: 30}, (_, i) => i % 2 ? `This observation connects ${'credit '.repeat(150)}.` : `Our method has stage ${i}.`));
    const r = selectDetailedContext(p, 'method');
    const added = r.paragraphs.filter(x => !x.text.startsWith('Our method'));
    expect(added.length).toBeGreaterThan(0);
    expect(added.reduce((n, x) => n + estimateTextTokens(x.text), 0)).toBeLessThanOrEqual(2400);
    expect(added.length).toBeLessThan(15);
    expect(r.warnings.join(' ')).toMatch(/[1-9]\d* candidates exceeded/);
    added.forEach(x => expect(p.paragraphs).toContain(x));
  });
});
describe('total window budget', () => {
  it('dynamically splits default 32k window/output and preserves requested output in larger windows', () => {
    const messages = [{ role: 'user', content: 'Method '.repeat(4000) }];
    const small = requestBudget(messages, { contextLimit: 32000, outputLimit: 32000 });
    expect(small.canSend).toBe(true); expect(small.outputLimit).toBeLessThan(32000);
    expect(small.inputTokens + small.outputLimit + small.safetyMargin).toBeLessThanOrEqual(32000);
    expect(requestBudget(messages, { contextLimit: 128000, outputLimit: 32000 }).outputLimit).toBe(32000);
    expect(requestBudget(messages, { contextLimit: 8000, outputLimit: 32000 }).canSend).toBe(false);
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(estimateTextTokens(messages[0].content));
  });
  it('rejects impossible and invalid configurations', () => {
    expect(requestBudget([], { contextLimit: 50, outputLimit: 50 }).canSend).toBe(false);
    expect(() => requestBudget([], { contextLimit: NaN, outputLimit: 1 })).toThrow();
  });
});
describe('lossless paragraph batching', () => {
  it('does not cap paragraph count, preserves order, original candidates, and all characters', () => {
    const paragraphs = Array.from({ length: 12 }, (_, i) => paragraph(`${i}`, 'first longish middle last'));
    const batches = partitionParagraphs(paragraphs, 6);
    expect(batches.length).toBeGreaterThan(5);
    for (const batch of batches) expect(estimateTextTokens(batch.map(p => p.text).join('\n'))).toBeLessThanOrEqual(6);
    const pieces = batches.flat();
    expect(pieces.map(p => p.text).join('')).toBe(paragraphs.map(p => p.text).join(''));
    const original = paragraphs.flatMap(p => p.members.map(m => m.candidate));
    const split = pieces.flatMap(p => p.members.map(m => m.candidate));
    expect(split).toHaveLength(original.length); split.forEach((c, i) => expect(c).toBe(original[i]));
    pieces.forEach(p => p.members.forEach(m => expect(p.text.slice(m.textStart, m.textEnd)).toBe(m.candidate.quote)));
  });
  it('keeps fitting paragraphs unchanged and fails explicitly on an indivisible member', () => {
    const p = paragraph('1', 'short text'); expect(partitionParagraphs([p], 20)[0][0]).toBe(p);
    expect(() => partitionParagraphs([paragraph('2', 'indivisible')], 1)).toThrow('cannot fit');
    expect(() => partitionParagraphs([p], 0)).toThrow();
  });
});
