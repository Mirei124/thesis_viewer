import type { ModelConfig } from './modelConfig';
import type { StructuredPaper, StructuredParagraph, StructuredSection } from './structuredPaper';

export type DetailedContextSectionId = 'problem_motivation' | 'contributions_novelty' | 'method' | 'experiments_ablations' | 'limitations';
export type DetailedContextSelection = {
  paragraphs: StructuredParagraph[];
  sections: StructuredSection[];
  warnings: string[];
  methodChecklist: string[];
};
const METHOD_CHECKLIST = [
  'Explain the task, assumptions, inputs and final outputs.',
  'Reconstruct the complete procedure in execution order.',
  'For every named module, explain what it is, its inputs, transformation, outputs and connections.',
  'Explain representations, important equations and their symbols when needed to understand the mechanism.',
  'Separate training objectives/data/updates from inference or evaluation operations.',
  'For datasets, benchmarks or scaling studies, explain construction, annotation, experimental design and scoring protocols.',
  'Check the explanation against source definitions; distinguish unspecified details from established facts.',
];
export const DETAILED_CONTEXT_SELECTION_VERSION = 'detailed-context-selection-v3';
const excluded = (p: StructuredParagraph) => p.role === 'references' || p.role === 'appendix' || p.kind === 'frontmatter' || p.kind === 'contents';
const isSupplementaryTitle = (title: string) => /\b(?:appendi(?:x|ces)|supplement(?:ary|al)(?:\s+material)?)\b/i.test(title)
  || /^(?:[A-Z](?:\.\d+)+(?:\.|\s)|[A-Z]\.\s)/.test(title);
const resultTitle = /\b(?:results?|ablations?)\b/i;
const analysisTitle = /\b(?:analysis|analyses|performance|comparisons?)\b/i;
const detailTitle = /\b(?:training|implementation|setup|settings?|protocol|optimization|optimisation)\b/i;
const introRules = {
  method: /\b(?:we (?:propose|introduce|present|develop)|our (?:method|model|approach|framework)|task|approach|framework|pipeline|contribut\w*|input|output|objective)\b/i,
  contributions_novelty: /\b(?:we|our|propos\w*|contribut\w*|unlike|contrast|prior|previous|novel\w*|first)\b/i,
};

// Start-of-paragraph discourse cues only: ordinary mentions inside a paragraph do not expand context.
const backwardCue = /^(?:(?:to (?:address|overcome|resolve|answer|bridge|tackle)\s+)?(?:this|these|such|the above|the aforementioned)\s+(?:(?:central|key|fundamental|open|remaining|outstanding|critical|important)\s+)?(?:gap|question|limitation|challenge|issue|problem|observation|finding|result|constraint|bottleneck|shortcoming|drawback|difficulty|assumption|motivation|approach|method|design|objective|reason|insight|requirement|deficienc|ambiguity)\w*\b|(?:therefore|thus|hence|consequently|accordingly|nevertheless|however|in contrast|by contrast|as a result|for this reason|to (?:this|that) end|in this context|under (?:this|these) (?:setting|assumption)s?|this (?:raises|leads to|motivates)|building on|based on (?:this|these|the above))\b|(?:为(?:了解决|解决|克服|弥补|回答|应对))?(?:这一|这些|上述|该|此类|此)(?:核心|关键|主要|根本|剩余)?(?:缺口|问题|局限|限制|挑战|不足|观察|结果|发现|假设|方法|设计|目标|需求|原因|瓶颈)|因此|因而|由此|为此|然而|不过|相比之下|基于上述|基于此|鉴于此)/iu;
const forwardCue = /^(?:where\b|here[,， ]|in (?:this|the above) (?:equation|expression|definition)\b|其中|这里|式中|上式|具体而言|具体来说)/iu;
const paragraphNoise = (p: StructuredParagraph) => /^\s*(?:\d{1,4}|arxiv:\s*\S+|(?:preprint|under review|accepted (?:at|by)|published (?:at|in))\b.*)\s*$/iu.test(p.text);
const prose = (p: StructuredParagraph) => p.kind === 'body' && !paragraphNoise(p) && !/^\s*(?:[-•*]|\(?\d+[.)])\s/u.test(p.text);
const unfinished = (p: StructuredParagraph) => /[:：,，;；=+−-]\s*$/u.test(p.text) || !/[.!?。！？][”’"')\]]?\s*$/u.test(p.text);

/** Role-based body selection. Appendix exclusion is unconditional, including references from retained prose. */
export function selectDetailedContext(paper: StructuredPaper, sectionId: DetailedContextSectionId): DetailedContextSelection {
  const sectionMap = new Map(paper.sections.map(s => [s.sectionId, s]));
  const chain = (s: StructuredSection): StructuredSection[] => {
    const ancestors: StructuredSection[] = [], seen = new Set<string>();
    let current: StructuredSection | undefined = s;
    while (current && !seen.has(current.sectionId)) {
      seen.add(current.sectionId); ancestors.push(current); current = sectionMap.get(current.parentId ?? '');
    }
    return ancestors;
  };
  const appendix = (s: StructuredSection) => chain(s).some(a => a.role === 'appendix' || isSupplementaryTitle(a.title));
  const forbidden = (s: StructuredSection) => appendix(s) || chain(s).some(a => a.role === 'references');
  const eligible = paper.sections.filter(s => !forbidden(s) && s.sectionId !== 'section:frontmatter');
  const isIntro = (s: StructuredSection) => chain(s).some(a => a.role === 'intro');
  const isExperiment = (s: StructuredSection) => chain(s).some(a => a.role === 'experiments' || /\b(?:experiments?|evaluations?|results?|ablations?)\b/i.test(a.title));
  const isMethod = (s: StructuredSection) => {
    const ancestors = chain(s);
    const experiment = isExperiment(s);
    const isResult = (a: StructuredSection) => resultTitle.test(a.title) || experiment && analysisTitle.test(a.title);
    const boundary = ancestors.find(a => isResult(a) || detailTitle.test(a.title));
    if (boundary && isResult(boundary)) return false;
    if (experiment) return Boolean(boundary && detailTitle.test(boundary.title));
    return ancestors.some(a => a.role === 'method' || detailTitle.test(a.title));
  };
  const bySection = new Map<string, StructuredParagraph[]>();
  for (const p of paper.paragraphs) {
    const section = sectionMap.get(p.sectionId);
    if (excluded(p) || paragraphNoise(p) || !section || forbidden(section)) continue;
    bySection.set(p.sectionId, [...(bySection.get(p.sectionId) ?? []), p]);
  }
  const chosen = new Set<string>();
  let continuityAdded = 0, continuityTokens = 0, continuitySkipped = 0;
  const addSection = (s: StructuredSection) => (bySection.get(s.sectionId) ?? []).forEach(p => chosen.add(p.paragraphId));
  const selectMatching = (sections: StructuredSection[], rule: RegExp, fallback: boolean) => {
    const matches = sections.flatMap(s => (bySection.get(s.sectionId) ?? []).filter(p => p.kind !== 'heading' && rule.test(p.text)));
    if (!matches.length && fallback) { sections.forEach(addSection); return; }
    matches.forEach(p => chosen.add(p.paragraphId));
    // Expand original matches only. The growth allowance is shared per call, never recursive.
    const seeds = new Set(matches.map(p => p.paragraphId));
    const allowance = Math.max(768, Math.min(2400, Math.ceil(matches.reduce((n, p) => n + estimateTextTokens(p.text), 0) / 2)));
    let spent = 0;
    const ordered = paper.paragraphs.filter(p => !paragraphNoise(p)).sort((a, b) => a.readOrder - b.readOrder);
    const positions = new Map(ordered.map((p, i) => [p.paragraphId, i]));
    const adjacent = (a: StructuredParagraph, b: StructuredParagraph | undefined) => Boolean(b && a.sectionId === b.sectionId && Math.abs(a.pageIndex - b.pageIndex) <= 1 && bySection.get(b.sectionId)?.includes(b));
    const addNeighbor = (p: StructuredParagraph) => {
      if (chosen.has(p.paragraphId) || seeds.has(p.paragraphId)) return;
      const cost = estimateTextTokens(p.text);
      if (cost > Math.min(allowance - spent, 2400 - continuityTokens)) { continuitySkipped++; return; }
      chosen.add(p.paragraphId); spent += cost; continuityTokens += cost; continuityAdded++;
    };
    for (const match of matches) {
      if (!prose(match)) continue;
      const index = positions.get(match.paragraphId)!;
      const prev = ordered[index - 1], next = ordered[index + 1];
      if (adjacent(match, prev) && prose(prev) && (backwardCue.test(match.text.trim()) || match.pageIndex !== prev.pageIndex && unfinished(prev))) addNeighbor(prev);
      if (adjacent(match, next) && prose(next) && (backwardCue.test(next.text.trim()) || forwardCue.test(next.text.trim()) || unfinished(match))) addNeighbor(next);
      // A short displayed equation and its immediate definition form one anchored connection.
      for (const direction of [-1, 1]) {
        const equation = ordered[index + direction], definition = ordered[index + 2 * direction];
        if (!adjacent(match, equation) || equation.kind !== 'equation' || estimateTextTokens(equation.text) > 120) continue;
        if (!(unfinished(match) || direction === -1 && forwardCue.test(match.text.trim()))) continue;
        const includeDefinition = adjacent(equation, definition) && prose(definition) && (direction === 1 ? forwardCue.test(definition.text.trim()) : unfinished(definition));
        const group = [equation, ...(includeDefinition ? [definition] : [])];
        const cost = group.filter(p => !chosen.has(p.paragraphId) && !seeds.has(p.paragraphId)).reduce((n, p) => n + estimateTextTokens(p.text), 0);
        if (cost > Math.min(allowance - spent, 2400 - continuityTokens)) { continuitySkipped += group.length; continue; }
        group.forEach(addNeighbor);
      }
    }
    const ids = new Set(matches.map(p => p.sectionId));
    sections.filter(s => ids.has(s.sectionId)).forEach(s => (bySection.get(s.sectionId) ?? []).filter(p => p.kind === 'heading').forEach(p => chosen.add(p.paragraphId)));
  };
  const warnings = [...paper.diagnostics];
  const intros = eligible.filter(isIntro);
  if (sectionId === 'problem_motivation') intros.forEach(addSection);
  if (sectionId in introRules) selectMatching(intros, introRules[sectionId as keyof typeof introRules], true);
  if (sectionId === 'method') {
    const methods = eligible.filter(s => !isIntro(s) && isMethod(s));
    methods.forEach(addSection);
    if (!methods.length) {
      // No global unknown-body fallback: only explicit procedure/definition paragraphs can enter.
      const unknown = eligible.filter(s => s.role === 'unknown' && !isIntro(s) && !isExperiment(s));
      selectMatching(unknown, /\b(?:we (?:propose|introduce|define)|our (?:method|model|approach)|consists? of|takes? as input|outputs?|training objective|algorithm|architecture)\b/i, false);
      warnings.push('No confident method chapter was recognized; used selected introduction and explicit procedure paragraphs only. Method coverage may be incomplete.');
    }
  } else if (sectionId === 'contributions_novelty') {
    selectMatching(eligible.filter(s => chain(s).some(a => a.role === 'related')), /\b(?:unlike|whereas|however|contrast|compar\w*|prior|previous|existing|differ\w*|our|we)\b/i, true);
  } else if (sectionId === 'experiments_ablations') {
    eligible.filter(isExperiment).forEach(addSection);
    selectMatching(eligible.filter(s => !isIntro(s) && isMethod(s) && !isExperiment(s)), /\b(?:overall (?:architecture|pipeline|framework)|method overview|our (?:model|method|framework) consists|takes? as input|outputs?)\b/i, false);
  } else if (sectionId === 'limitations') {
    eligible.filter(s => chain(s).some(a => a.role === 'limitations' || a.role === 'conclusion' || /\b(?:limitations?|discussion|conclusions?)\b/i.test(a.title))).forEach(addSection);
  }
  // Only exact whitespace-normalized duplicates are removed. Retained paragraphs and members are untouched.
  const seen = new Set<string>(); let duplicateCount = 0;
  const paragraphs = paper.paragraphs.filter(p => chosen.has(p.paragraphId)).sort((a, b) => a.readOrder - b.readOrder).filter(p => {
    const normalized = p.text.replace(/\s+/gu, ' ').trim();
    if (seen.has(normalized)) { duplicateCount++; return false; }
    seen.add(normalized); return true;
  });
  if (continuityAdded || continuitySkipped) warnings.push(`Adjacent context: added ${continuityAdded} paragraphs (approximately ${continuityTokens} tokens); ${continuitySkipped} candidates exceeded the bounded growth allowance. The column-wide ceiling is 2400 tokens. Only original matches expand, within the same subsection and adjacent pages.`);
  const selectedIds = new Set(paragraphs.map(p => p.sectionId));
  if (duplicateCount) warnings.push(`${duplicateCount} whitespace-normalized exact duplicate paragraphs were omitted; similar definitions were retained.`);
  if (paper.sections.some(appendix)) warnings.push('Appendices and all supplementary subsections are excluded, including when referenced by the body.');
  if (!paragraphs.length) warnings.push('No usable body paragraphs were found for this section; unavailable details must not be invented.');
  return { paragraphs, sections: paper.sections.filter(s => selectedIds.has(s.sectionId)), warnings: [...new Set(warnings)], methodChecklist: sectionId === 'method' ? [...METHOD_CHECKLIST] : [] };
}

/** Conservative language-aware approximation, not a provider tokenizer or a guarantee of exact usage. */
export function estimateTextTokens(text: string): number {
  let ascii = 0, other = 0;
  for (const char of text) { if (char.codePointAt(0)! <= 127) ascii++; else other += char.codePointAt(0)! > 0xffff ? 3 : 2; }
  return Math.ceil(ascii / 3 + other);
}
export type ContextMessage = { role: string; content: string };
export function estimateMessagesTokens(messages: readonly ContextMessage[]): number {
  return 16 + messages.reduce((total, message) => total + 12 + estimateTextTokens(message.role) + estimateTextTokens(message.content), 0);
}
export function requestBudget(messages: readonly ContextMessage[], config: Pick<ModelConfig, 'contextLimit' | 'outputLimit'>) {
  if (!Number.isSafeInteger(config.contextLimit) || config.contextLimit < 1 || !Number.isSafeInteger(config.outputLimit) || config.outputLimit < 1) throw new DetailedContextBudgetError('Context and output limits must be positive whole numbers.');
  const inputTokens = estimateMessagesTokens(messages);
  const safetyMargin = Math.max(256, Math.ceil(config.contextLimit * 0.05));
  const minimumOutputTokens = Math.min(1024, config.outputLimit);
  const outputLimit = Math.max(0, Math.min(config.outputLimit, config.contextLimit - inputTokens - safetyMargin));
  const canSend = outputLimit >= minimumOutputTokens;
  return { canSend, inputTokens, outputLimit, safetyMargin, contextLimit: config.contextLimit, minimumOutputTokens,
    warnings: ['Token counts are conservative estimates; provider tokenization and reasoning usage may differ.',
      ...(outputLimit < config.outputLimit ? ['Actual output allowance was reduced to fit the configured total context window.'] : []),
      ...(!canSend ? ['Input requires paragraph batching before this request can be sent.'] : [])] };
}
export class DetailedContextBudgetError extends Error {
  constructor(message: string) { super(message); this.name = 'DetailedContextBudgetError'; }
}
/** Paragraph text budget only; callers must reserve prompt, alias/metadata and response overhead. */
export function partitionParagraphs(paragraphs: readonly StructuredParagraph[], tokenBudget: number): StructuredParagraph[][] {
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget < 1) throw new DetailedContextBudgetError('Paragraph token budget must be a positive whole number.');
  const pieces: StructuredParagraph[] = [];
  for (const paragraph of paragraphs) {
    if (estimateTextTokens(paragraph.text) <= tokenBudget) { pieces.push(paragraph); continue; }
    if (!paragraph.members.length) throw new DetailedContextBudgetError(`Paragraph ${paragraph.paragraphId} exceeds budget and has no anchored member boundaries.`);
    let startMember = 0;
    while (startMember < paragraph.members.length) {
      const start = startMember === 0 ? 0 : paragraph.members[startMember].textStart;
      let endMember = startMember;
      let end = start;
      while (endMember < paragraph.members.length) {
        const next = endMember + 1 === paragraph.members.length ? paragraph.text.length : paragraph.members[endMember + 1].textStart;
        if (estimateTextTokens(paragraph.text.slice(start, next)) > tokenBudget) break;
        end = next; endMember++;
      }
      if (endMember === startMember) throw new DetailedContextBudgetError(`Anchored member ${paragraph.members[startMember].candidate.evidenceId} cannot fit the paragraph budget; increase context capacity.`);
      pieces.push({ ...paragraph, paragraphId: `${paragraph.paragraphId}:members:${startMember}-${endMember}`, passageId: `${paragraph.passageId}:members:${startMember}-${endMember}`,
        text: paragraph.text.slice(start, end), members: paragraph.members.slice(startMember, endMember).map(m => ({ ...m, textStart: m.textStart - start, textEnd: m.textEnd - start })) });
      startMember = endMember;
    }
  }
  const batches: StructuredParagraph[][] = [];
  let batch: StructuredParagraph[] = [], tokens = 0;
  for (const piece of pieces) {
    const cost = estimateTextTokens(piece.text) + (batch.length ? 1 : 0);
    if (batch.length && tokens + cost > tokenBudget) { batches.push(batch); batch = []; tokens = 0; }
    tokens += estimateTextTokens(piece.text) + (batch.length ? 1 : 0); batch.push(piece);
  }
  if (batch.length) batches.push(batch);
  return batches;
}
