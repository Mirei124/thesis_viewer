import { describe, expect, it } from 'vitest';
import { pageBlocksFromTextContent } from './pdfPageBlocks';
import { locateEvidenceCandidate, pdfEvidenceLedgerFromPages } from './evidenceLedger';
import { createDetailedEvidenceLedger, createStructuredPaper } from './structuredPaper';
function page(rows: Array<[string, number, number, number?, number?]>, index = 0) {
  return pageBlocksFromTextContent({ items: rows.map(([str, x, y, size = 10, width = 230]) => ({ str, transform: [size, 0, 0, size, x, y], width, height: size, hasEOL: true, fontName: 'f', dir: 'ltr' })), styles: {}, lang: null }, index, 'doc');
}
function build(pages: ReturnType<typeof page>[]) {
  const body = pdfEvidenceLedgerFromPages(pages, 'doc', []);
  const ledger = createDetailedEvidenceLedger(body, pages);
  return { body, ledger, paper: createStructuredPaper(ledger, pages) };
}
describe('structured paper', () => {
  it('joins split numbered headings, preserves whole paragraphs and exact members', () => {
    const pages = [page([['3', 50, 740, 12, 8], ['Model Architecture', 70, 740, 12], ...Array.from({ length: 18 }, (_, i) => ['The representation carries the complete module definition and transformation', 50, 720 - i * 12] as [string, number, number])])];
    const { paper, ledger } = build(pages);
    expect(paper.sections.some(s => s.title === '3 Model Architecture' && s.role === 'method')).toBe(true);
    const paragraph = paper.paragraphs.find(p => p.kind === 'body')!;
    expect(paragraph.text.length).toBeGreaterThan(1200);
    for (const member of paragraph.members) {
      expect(paragraph.text.slice(member.textStart, member.textEnd)).toBe(member.candidate.quote);
      expect(ledger.candidates).toContain(member.candidate);
      expect(locateEvidenceCandidate(member.candidate, pages)?.anchor).toBeDefined();
    }
  });
  it('recognizes colon-bearing methodological subheadings and isolates formula rows', () => {
    const { paper } = build([page([['3 Estimation', 50, 740, 12], ['3.1 Approach 1: Fit the parametric law', 50, 715, 11], ['The loss is defined by the following equation.', 50, 695],
      ['L', 100, 675, 10, 7], ['=', 115, 675, 10, 7], ['N', 130, 675, 10, 7], ['+', 145, 675, 10, 7], ['D', 160, 675, 10, 7], ['(1)', 180, 675, 10, 14]])]);
    expect(paper.sections.some(s => s.title.startsWith('3.1 Approach 1:'))).toBe(true);
    expect(paper.paragraphs.some(p => p.kind === 'equation')).toBe(true);
  });
  it('reads two columns independently rather than interleaving baselines', () => {
    const rows: Array<[string, number, number, number?, number?]> = [['2 Method', 50, 740, 12, 220]];
    for (let i = 0; i < 6; i++) { rows.push([`Left prose line ${i} contains the mechanism description`, 50, 720 - 12 * i, 10, 220]); rows.push([`Right prose line ${i} contains the next mechanism stage`, 310, 720 - 12 * i, 10, 220]); }
    const { paper } = build([page(rows)]);
    const body = paper.paragraphs.filter(p => p.kind === 'body');
    expect(body[0].text).toContain('Left prose line 5');
    expect(body[0].text).not.toContain('Right prose');
    expect(body[1].text).toContain('Right prose line 0');
  });
  it('does not recognize numerical prose as a section and keeps parent roles', () => {
    const { paper } = build([page([['2 Methods', 50, 740, 12], ['2.1 Encoder', 50, 715, 11], ['2014 English-French dataset is used to train the representation.', 50, 695], ['The decoder consumes this representation.', 50, 683]])]);
    expect(paper.sections).toHaveLength(3);
    expect(paper.paragraphs.at(-1)?.role).toBe('method');
  });
  it('suppresses contents headings and restores references/appendix sources without changing body identities', () => {
    const pages = [page([['Contents', 50, 740, 12], ['1 Introduction .... 2', 50, 720], ['2 Methods .... 3', 50, 708], ['3 Results .... 4', 50, 696]]), page([['1 Introduction', 50, 740, 12], ['We explain the task and its motivation.', 50, 720], ['References', 50, 690, 12], ['A. Author and B. Author. Article.', 50, 670], ['Appendix', 50, 630, 12], ['A Training Details', 50, 610, 12], ['We update the model with this training objective.', 50, 590]], 1)];
    const { body, ledger, paper } = build(pages);
    for (const candidate of body.candidates) expect(ledger.candidates).toContain(candidate);
    expect(ledger.candidates.length).toBeGreaterThan(body.candidates.length);
    expect(paper.sections.filter(s => s.title.includes('....'))).toHaveLength(0);
    expect(paper.paragraphs.find(p => p.text.startsWith('A. Author'))?.role).toBe('references');
    expect(paper.unrepresentedBlockCount).toBe(0);
    for (const p of paper.paragraphs) for (const m of p.members) expect(locateEvidenceCandidate(m.candidate, pages)?.qualityWarnings).not.toContain('quote-fallback-used');
  });
  it('keeps unnumbered and numeric supplementary headings inside the appendix region', () => {
    const { paper } = build([page([['1 Introduction', 50, 740, 12], ['The task is defined here.', 50, 720], ['References', 50, 680, 12], ['Appendix', 50, 620, 12], ['A Training Details', 50, 595, 12], ['Model Details', 50, 565, 12], ['3. Does the dataset contain all instances', 50, 545], ['7. Detailed Experimental Settings', 50, 500, 12]])]);
    expect(paper.sections.filter(s => /Model Details|Experimental Settings/.test(s.title)).every(s => s.role === 'appendix')).toBe(true);
    expect(paper.sections.some(s => s.title.startsWith('3. Does'))).toBe(false);
  });
  it('recognizes small-cap titles and references without altering original quotes', () => {
    const { paper } = build([page([['1', 50, 740, 12, 8], ['I', 70, 740, 12, 5], ['NTRODUCTION', 75, 740, 10, 100], ['The task is defined here.', 50, 720], ['4', 50, 680, 12, 8], ['O', 70, 680, 12, 8], ['UR', 78, 680, 10, 15], ['M', 98, 680, 12, 8], ['ETHOD', 106, 680, 10, 50], ['The trainable update is factored into two matrices.', 50, 660], ['R', 50, 620, 12, 8], ['EFERENCES', 58, 620, 10, 80], ['An author and a cited paper.', 50, 600]])]);
    expect(paper.sections.find(s => s.title === '1 INTRODUCTION')?.role).toBe('intro');
    expect(paper.sections.find(s => s.title === '4 OUR METHOD')?.role).toBe('method');
    expect(paper.paragraphs.at(-1)?.role).toBe('references');
    expect(paper.paragraphs[0].members[1].candidate.quote).toBe('I');
  });
  it('retains captions and equations separately and never merges across pages', () => {
    const { paper } = build([page([['2 Method', 50, 740, 12], ['A paragraph begins here and continues', 50, 720], ['Figure 1. The complete module architecture.', 50, 680]]), page([['with another page of the mechanism.', 50, 740]], 1)]);
    expect(paper.paragraphs.some(p => p.kind === 'caption')).toBe(true);
    expect(paper.paragraphs.filter(p => p.kind === 'body')).toHaveLength(2);
  });
});
