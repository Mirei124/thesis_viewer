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
  it('attaches the R2-Omni superscript using its local base without changing quotes or anchors', () => {
    const pages = [page([
      ['3.1 Overview', 62, 220, 12, 150],
      ['A preceding paragraph ends here.', 62, 195.335, 10.9091, 443],
      ['As shown in Fig. 2, R', 62.013, 175.011, 10.8981909, 100.0889852256],
      ['2', 162.100, 178.971, 7.9701, 4.4313756],
      ['-Omni applies two training-free stages.', 167.029, 175.011, 10.8981909, 365.885],
      ['The two stages preserve diverse information.', 62, 161.462, 10.9091, 470],
    ])];
    const snapshot = structuredClone(pages);
    const { paper, ledger } = build(pages);
    const paragraph = paper.paragraphs.find(p => p.text.startsWith('As shown'))!;
    expect(paragraph.text).toContain('R 2 -Omni');
    expect(paragraph.members.map(m => m.candidate.quote)).toEqual([
      'As shown in Fig. 2, R', '2', '-Omni applies two training-free stages.', 'The two stages preserve diverse information.',
    ]);
    expect(paper.paragraphs.some(p => p.text === '2')).toBe(false);
    expect(pages).toEqual(snapshot);
    for (const m of paragraph.members) {
      expect(ledger.candidates).toContain(m.candidate);
      expect(paragraph.text.slice(m.textStart, m.textEnd)).toBe(m.candidate.quote);
      expect(locateEvidenceCandidate(m.candidate, pages)?.anchor).toBeDefined();
    }
  });

  it('keeps a subscript and an inline footnote marker with their base but not footnote prose', () => {
    const { paper } = build([page([
      ['2 Method', 50, 740, 12, 120],
      ['The representation x', 50, 720, 10, 100], ['model', 150, 716, 7, 16],
      [' carries information.', 167, 720, 10, 100], ['3', 267, 724, 7, 4],
      ['3', 50, 90, 7, 4], ['A separately printed footnote belongs below.', 56, 90, 8, 230],
    ])]);
    const paragraph = paper.paragraphs.find(p => p.text.startsWith('The representation'))!;
    expect(paragraph.text).toBe('The representation x model carries information. 3');
    expect(paragraph.text).not.toContain('separately printed');
    expect(paper.paragraphs.find(p => p.text.includes('separately printed'))?.text).toBe('3 A separately printed footnote belongs below.');
  });

  it('does not attach page numbers, list prefixes, same-size text or a distant preceding line', () => {
    const { paper } = build([page([
      ['2 Method', 50, 740, 12, 120],
      ['The preceding text ends here.', 50, 720, 10, 100],
      ['2', 150, 708, 7, 4],
      ['1', 50, 684, 7, 4], ['A list starts here.', 56, 680, 10, 230],
      ['Same-size x', 50, 650, 10, 100], ['2', 150, 654, 10, 4],
      ['12', 300, 42, 7, 8],
    ])]);
    expect(paper.paragraphs.find(p => p.text === '2')).toBeDefined();
    expect(paper.paragraphs.find(p => p.text === '1')).toBeDefined();
    expect(paper.paragraphs.find(p => p.text === '12')).toBeDefined();
    expect(paper.paragraphs.some(p => p.text.includes('Same-size x 2'))).toBe(true);
  });

  it('does not cross a nonempty unrepresented item or a column gap to find a base', () => {
    const pages = [page([
      ['2 Method', 50, 740, 12, 120], ['The original R', 50, 720, 10, 100],
      ['unreliable', 150, 720, 10, 1], ['2', 151, 724, 7, 4],
      ['-name remains here.', 156, 720, 10, 160],
      ['Left R', 50, 680, 10, 100], ['2', 310, 684, 7, 4],
      ['Right paragraph text begins here.', 315, 680, 10, 220],
    ])];
    pages[0].blocks[2].qualityFlags.push('non-axis-aligned-transform');
    const { paper } = build(pages);
    const scripts = paper.paragraphs.filter(p => p.text === '2');
    expect(scripts).toHaveLength(2);
    expect(paper.paragraphs.find(p => p.text.startsWith('Left R'))?.text).not.toContain('2');
  });

  it('leaves a script independent when two normal lines provide equally close geometric bases', () => {
    const { paper } = build([page([
      ['2 Method', 50, 740, 12, 120],
      ['Upper base', 50, 712, 10, 100], ['Lower base', 50, 700, 10, 100],
      ['2', 150, 706, 7, 4],
    ])]);
    expect(paper.paragraphs.find(p => p.text === '2')).toBeDefined();
  });

  it('retains appendix headings with restored superscripts without admitting body letter-number prefixes', () => {
    const { paper } = build([
      page([
        ['2 Methods', 50, 780, 12, 150],
        ['B.9. R2-Omni Example', 50, 760, 10.9091, 180],
        ['References', 50, 720, 12, 100],
        ['Appendix', 50, 680, 12, 100],
        ['B. Implementation Details', 50, 650, 12, 230],
      ]),
      page([
        ['B.1. R', 62.362, 745.891, 10.9091, 32.2691178],
        ['2', 94.631, 749.851, 7.9701, 4.4313756],
        ['-Omni Implementation', 99.561, 745.891, 10.9091, 115.5164599],
        ['The implementation details are recorded here.', 62.362, 725, 10.9091, 470],
        ['B.4. R', 62.362, 516.045, 10.9091, 32.2691178],
        ['2', 94.631, 520.005, 7.9701, 4.4313756],
        ['-Omni Compression-Ratio Configurations', 99.561, 516.045, 10.9091, 207.6329003],
        ['The compression settings are recorded here.', 62.362, 495, 10.9091, 470],
      ], 1),
    ]);
    for (const title of ['B.1. R 2 -Omni Implementation', 'B.4. R 2 -Omni Compression-Ratio Configurations']) {
      const section = paper.sections.find(section => section.title === title);
      expect(section).toMatchObject({ role: 'appendix', level: 2 });
      expect(paper.paragraphs.find(paragraph => paragraph.text === title)?.members.map(member => member.candidate.quote))
        .toEqual(title.startsWith('B.1') ? ['B.1. R', '2', '-Omni Implementation'] : ['B.4. R', '2', '-Omni Compression-Ratio Configurations']);
    }
    expect(paper.sections.some(section => section.title.startsWith('B.9'))).toBe(false);
  });

  it('rejects appendix contents with distant page labels while allowing numbers in real titles', () => {
    const { paper } = build([page([
      ['2 Method', 50, 820, 12, 120], ['References', 50, 800, 12, 120],
      ['A Complete Experimental Results', 50, 760, 10, 220], ['16', 520, 760, 10, 12],
      ['B Implementation Details', 50, 740, 10, 160], ['18', 520, 740, 10, 12],
      ['C Long-Form Generation Benchmarks', 50, 720, 10, 235], ['26', 520, 720, 10, 12],
      ['D Evaluated Omni-LLMs', 50, 700, 10, 150], ['29', 520, 700, 10, 12],
      ['E Qualitative Case Studies', 50, 680, 10, 175], ['29', 520, 680, 10, 12],
      ['Appendix', 50, 630, 12, 120],
      ['B.1. Experiment', 50, 600, 10, 100], ['2', 153, 600, 10, 6],
      ['The second experiment is described here.', 50, 580, 10, 230],
    ])]);
    expect(paper.sections.some(section => /(?:Results 16|Details 18|Benchmarks 26|Omni-LLMs 29|Studies 29)$/.test(section.title))).toBe(false);
    expect(paper.sections.find(section => section.title === 'B.1. Experiment 2')).toMatchObject({ role: 'appendix', level: 2 });
  });

});
