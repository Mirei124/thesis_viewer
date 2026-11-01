import type { EvidenceLedger } from './evidenceLedger';
import type { PageExtraction } from './pdfPageBlocks';
import { createStructuredPaper, type StructuredParagraph } from './structuredPaper';
import { estimateTextTokens } from './detailedContext';

/** Frozen B112-v2 selection: complete extracted paragraphs, never a character-cut source. */
const TEXT_BUDGET = 1900;
const MAX_PARAGRAPHS = 8;
const claim = /\b(?:we (?:propose|introduce|present|develop|construct|build|release|investigate|study|predict|test|estimate|measure|show|find|demonstrate)|our (?:contributions?|method|model|framework|dataset|benchmark)|contributions? (?:are|include)|in this (?:work|paper))\b/i;
const method = /\b(?:consists? of|compris\w*|encoder|decoder|attention|shortcut|residual|data engine|pipeline|training objective|loss|sampl\w*|annotat\w*|filter\w*|optim\w*|fit(?:ting)?|compute-optimal|iso[- ]?flop|parameter\w*|token\w*|input|output|prompt\w*|trajectory|canvas|represent\w*)\b/i;
const result = /\b(?:we (?:evaluate|show|find|demonstrate)|outperform\w*|improv\w*|achiev\w*|zero-shot|generaliz\w*|results?|evaluat\w*|compar\w*|ablations?)\b/i;
const methodOutline = /^(?:task|model|data engine|dataset|experiments?|contributions?)\s*(?:\(|\(|§|[:.])/i;
const boilerplate = /^(?:equal contribution|provided proper attribution|copyright|all rights reserved|arxiv:|https?:\/\/|www\.|\*?\s*corresponding author|references|acknowledg\w*)\b/i;


export type ThreeLineContext = { paragraphs: StructuredParagraph[]; readingNotes: string[] };

// Explicit short source headings also protect papers whose first-page title guard left them as frontmatter.
function explicitSupplementaryRegion(paragraphs: readonly StructuredParagraph[]): Set<StructuredParagraph> {
  const excluded = new Set<StructuredParagraph>();
  let supplementary = false;
  for (const paragraph of [...paragraphs].sort((a, b) => a.readOrder - b.readOrder)) {
    if (['heading', 'frontmatter'].includes(paragraph.kind)
      && /^(?:(?:appendix|appendices)(?:\s+[A-Z](?:\.\d+)*)?|supplementary(?:\s+(?:material|materials|information))?|references|bibliography)\.?$/i.test(paragraph.text.trim())) supplementary = true;
    if (supplementary) excluded.add(paragraph);
  }
  return excluded;
}

export function selectThreeLineContext(ledger: EvidenceLedger, pages: readonly PageExtraction[]): ThreeLineContext {
  const paper = createStructuredPaper(ledger, pages);
  const explicitExcluded = explicitSupplementaryRegion(paper.paragraphs);
  const bySection = new Map(paper.sections.map(section => [section.sectionId, section]));
  const hasRole = (p: StructuredParagraph, role: string) => {
    let section = bySection.get(p.sectionId);
    while (section) {
      if (section.role === role) return true;
      section = section.parentId ? bySection.get(section.parentId) : undefined;
    }
    return false;
  };
  const isUnlabelledAbstract = (p: StructuredParagraph) => {
    if (p.pageIndex !== 0 || p.kind !== 'frontmatter') return false;
    const t = p.text.trim();
    return t.length >= 320 && /^(?:We|In this (?:paper|work)|This (?:paper|work)|Here we)\b/.test(t)
      && /\b(?:investigate|study|propose|introduce|present|develop|construct|demonstrate|analy[sz]e|explore|address)\b/i.test(t.slice(0, 300))
      && (t.match(/[.!?](?:\s|$)/g)?.length ?? 0) >= 2
      && !/@|https?:\/\/|www\.|copyright|all rights reserved|equal contribut|corresponding author|department of|university of/i.test(t);
  };
  const captionContinuation = (p: StructuredParagraph) => {
    if (!/^[a-z]/.test(p.text.trim())) return false;
    let index = paper.paragraphs.indexOf(p) - 1;
    // Short labels/footnote markers may split a caption, but ordinary preceding body prose is never crossed.
    while (index >= 0 && paper.paragraphs[index].kind === 'body' && paper.paragraphs[index].text.trim().length < 30) index--;
    const previous = paper.paragraphs[index];
    return previous?.kind === 'caption' && previous.sectionId === p.sectionId && Math.abs(previous.pageIndex - p.pageIndex) <= 1;
  };
  const prose = paper.paragraphs.filter(p => {
    if (explicitExcluded.has(p) || hasRole(p, 'appendix') || hasRole(p, 'references') || ['contents', 'heading', 'table', 'equation', 'caption'].includes(p.kind) || captionContinuation(p)) return false;
    const t = p.text.trim();
    return t.length >= 140 && !boilerplate.test(t) && (t.match(/[\u0000-\u0008\u000e-\u001f]/g)?.length ?? 0) <= Math.floor(t.length * .01)
      && (t.match(/[A-Za-z]/g)?.length ?? 0) >= t.length * .45
      && (p.kind !== 'frontmatter' || /abstract/i.test(p.sectionTitle) || isUnlabelledAbstract(p));
  });
  const abstracts = prose.filter(p => /^abstract$/i.test(p.sectionTitle) || isUnlabelledAbstract(p));
  const intros = prose.filter(p => hasRole(p, 'intro') && !hasRole(p, 'related'));
  const methods = prose.filter(p => hasRole(p, 'method') && !hasRole(p, 'experiments'));
  const validations = prose.filter(p => (hasRole(p, 'experiments') || hasRole(p, 'intro') || hasRole(p, 'conclusion')) && result.test(p.text));
  const score = (p: StructuredParagraph, category: 'claim' | 'method' | 'result') => {
    let points = /\b(?:we (?:propose|introduce|present|develop|construct|build|release|investigate|study|predict|test|estimate|measure|show|find|demonstrate)|our (?:contributions?|method|model|framework|dataset|benchmark))\b/i.test(p.text) ? (category === 'result' ? 2 : 6) : 0;
    if (method.test(p.text)) points += category === 'method' ? 7 : 2;
    if (category === 'claim' && methodOutline.test(p.text)) points += 9;
    if (category === 'result' && /^(?:experiments?|evaluations?|results?)\b/i.test(p.text)) points += hasRole(p, 'intro') ? 14 : 5;
    if (category === 'result' && hasRole(p, 'experiments')) points += 6;
    if (/^[a-z]/.test(p.text.trim())) points -= 5;
    if (result.test(p.text)) points += category === 'result' ? 5 : 0;
    if (category === 'result' && /\b\d+(?:\.\d+)?\s*(?:%|times|datasets?|tasks?|models?|BLEU|parameters?|tokens?)\b/i.test(p.text)) points += 3;
    if (category === 'method' && /\b(?:consists? of|compris\w*|maps?|defined?|formulat\w*|instead|three|two|first|stages?)\b/i.test(p.text)) points += 3;
    if (/\b(?:our goal|we (?:seek|aim))\b/i.test(p.text) && !/\bwe (?:propose|introduce|present|develop|construct|build|release)\b/i.test(p.text)) points -= 8;
    if (/\b(?:existing|previous|prior)\b/i.test(p.text) && !claim.test(p.text)) points -= 3;
    // Prefer a coherent compact definition over a lengthy paragraph only when their content signals tie.
    return points;
  };
  const rank = (items: StructuredParagraph[], category: 'claim' | 'method' | 'result') => [...items].sort((a, b) => score(b, category) - score(a, category) || a.readOrder - b.readOrder);
  const chosen: StructuredParagraph[] = [];
  const keys = new Set<string>();
  const warnings: string[] = [];
  let spent = 0;
  const add = (p: StructuredParagraph | undefined, allowance = TEXT_BUDGET) => {
    if (!p || chosen.length >= MAX_PARAGRAPHS) return false;
    const key = p.text.replace(/\s+/gu, ' ').trim();
    if (keys.has(key)) return false;
    const cost = estimateTextTokens(p.text);
    if (spent + cost > allowance) return false;
    chosen.push(p); keys.add(key); spent += cost;
    return true;
  };
  // Reserve evidence for each role before filling remaining capacity. All paragraphs remain byte-for-byte intact.
  add(abstracts[0]);
  for (const p of rank(intros, 'claim').filter(p => claim.test(p.text) || methodOutline.test(p.text)).slice(0, 2)) add(p, 1150);
  for (const p of rank(methods, 'method')) if (add(p, 1550)) break;
  for (const p of rank(validations, 'result')) if (add(p)) break;
  const remaining = [
    ...rank(intros.filter(p => claim.test(p.text) || methodOutline.test(p.text)), 'claim'),
    ...rank(methods.filter(p => method.test(p.text)), 'method'),
    ...abstracts.slice(1),
  ];
  for (const p of remaining) add(p);
  // No chapter detector should cause an entirely empty packet when usable prose remains.
  if (!chosen.length) for (const p of prose) if (add(p)) break;
  if (!chosen.length && prose.length) {
    // An oversized core paragraph is retained whole rather than silently truncated into a misleading fragment.
    const p = abstracts[0] ?? rank(intros, 'claim')[0] ?? prose[0];
    chosen.push(p); warnings.push('A single complete core paragraph exceeds the normal compact-input target; it is retained whole.');
  }
  if (!chosen.some(p => hasRole(p, 'method'))) warnings.push('No separate method paragraph fit the compact packet; do not infer unstated mechanism details.');
  if (!chosen.some(p => validations.includes(p))) warnings.push('No direct validation paragraph fit the compact packet; omit unsupported performance details.');
  const paragraphs = chosen.sort((a, b) => a.readOrder - b.readOrder);
  return { paragraphs, readingNotes: [
        'Whole extracted body paragraphs; appendices/references excluded. No source text was cut to fit.',
        'Prioritize distinct actual contributions and explain the key operation, not only module names; do not impose three fixed categories.',
        'Keep task, model, data engine/dataset and evaluation distinct; do not merge their actors or steps.',
        'Prefer mechanism to scale/score lists; include a number only with its stated object and conditions.',
        'Enumerate a claimed number of alternatives or stages only when the sources fully define all of them. Never turn one alternative’s internal substeps into separate alternatives. If coverage is incomplete, summarize the high-level approach without inventing missing alternatives.',
        ...warnings,
  ] };
}

/** Restrict legacy excerpt fallback to known body paragraphs, retaining original candidate identities. */
export function threeLineFallbackLedger(ledger: EvidenceLedger, pages: readonly PageExtraction[]): EvidenceLedger {
  const paper = createStructuredPaper(ledger, pages);
  const explicitExcluded = explicitSupplementaryRegion(paper.paragraphs);
  const sections = new Map(paper.sections.map(section => [section.sectionId, section]));
  const allowed = new Set<EvidenceLedger['candidates'][number]>();
  for (const paragraph of paper.paragraphs) {
    if (explicitExcluded.has(paragraph) || ['contents', 'heading'].includes(paragraph.kind)) continue;
    let section = sections.get(paragraph.sectionId), forbidden = false;
    while (section) {
      if (section.role === 'appendix' || section.role === 'references') { forbidden = true; break; }
      section = section.parentId ? sections.get(section.parentId) : undefined;
    }
    if (!forbidden) paragraph.members.forEach(member => allowed.add(member.candidate));
  }
  return { ...ledger, candidates: ledger.candidates.filter(candidate => allowed.has(candidate)) };
}
