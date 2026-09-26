import { isModelEligibleCandidate } from './evidencePacket';
import type { EvidenceCandidate, EvidenceLedger, EvidenceSlot } from './evidenceLedger';
import type { EvidencePassage, EvidencePassageCollection } from './evidencePassages';

/** Bump when tokenization, queries, or scoring rules change. */
export const LOCAL_RETRIEVAL_VERSION = 'local-lexical-retrieval-v1';

export type DetailedRetrievalPurpose =
  | 'problem_motivation'
  | 'method'
  | 'contributions'
  | 'relative_novelty'
  | 'experiments_ablations'
  | 'limitations';

export const DETAILED_RETRIEVAL_PURPOSES: readonly DetailedRetrievalPurpose[] = [
  'problem_motivation', 'method', 'contributions', 'relative_novelty', 'experiments_ablations', 'limitations',
];

export type RetrievalScoreBreakdown = {
  lexical: number;
  sectionBoost: number;
  slotBoost: number;
  /** Query terms that actually occurred in this local excerpt. */
  matchedTokens: string[];
};

export type RankedEvidenceCandidate = {
  candidate: EvidenceCandidate;
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  /** A diagnosis only; never send this or scores to the model. */
  diagnostics: string[];
};

export type RetrievalSelectionOptions = {
  /** Must fit the eventual progressive-stage evidence budget. */
  maxCandidates: number;
  /** Prevent one dense page from crowding out the rest of the paper. */
  maxCandidatesPerPage?: number;
  /** Whether a short high-ranked paragraph may bring one local neighbour. */
  includeAdjacent?: boolean;
};

export type RetrievalIndex = {
  version: typeof LOCAL_RETRIEVAL_VERSION;
  documentVersion: string;
  candidateCount: number;
  /** These local records deliberately retain no altered evidence or anchors. */
  records: readonly RetrievalRecord[];
  diagnostics: string[];
};

/** A passage index keeps the readable joined text for ranking, while its
 * members remain the only evidence anchors that can later be validated. */
export type PassageRetrievalIndex = {
  documentVersion: string;
  passages: readonly EvidencePassage[];
  diagnostics: string[];
};

export type RankedEvidencePassage = {
  passage: EvidencePassage;
  score: number;
  scoreBreakdown: RetrievalScoreBreakdown;
  diagnostics: string[];
};

type RetrievalRecord = {
  candidate: EvidenceCandidate;
  tokens: readonly string[];
  termFrequency: ReadonlyMap<string, number>;
  length: number;
  sectionTokens: readonly string[];
};

type QueryDefinition = {
  terms: readonly string[];
  /** Broader, paper-type-specific cues. They expand recall without letting a
   * lone generic word such as "benchmark" displace direct method prose. */
  supplementaryTerms?: readonly string[];
  sectionTerms: readonly string[];
  slots: readonly EvidenceSlot[];
};

const QUERY_DEFINITIONS: Record<DetailedRetrievalPurpose, QueryDefinition> = {
  problem_motivation: {
    terms: ['problem', 'challenge', 'limitation', 'motivate', 'motivation', 'however', 'aim', 'address', '问题', '挑战', '动机', '限制', '局限', '目标', '解决'],
    sectionTerms: ['abstract', 'introduction', 'background', '摘要', '引言', '背景'], slots: ['problem', 'motivation', 'relative_novelty'],
  },
  method: {
    // "Method" is broader than a model architecture. Dataset, benchmark, and
    // evaluation papers legitimately describe their construction, annotation,
    // task, and protocol as the method. Keep the model-work vocabulary here
    // too: these are retrieval cues, not a paper-type classifier.
    terms: [
      'propose', 'framework', 'method', 'architecture', 'approach', 'model', 'consists', 'training', 'inference', 'algorithm',
      '方法', '框架', '模型', '架构', '训练', '推理', '算法', '提出',
    ],
    supplementaryTerms: [
      'dataset', 'benchmark', 'collection', 'collect', 'annotation', 'annotate', 'label', 'question', 'answer', 'qa', 'evaluation', 'evaluate', 'protocol', 'video', 'subtitle', 'audio',
      '数据集', '基准', '收集', '采集', '构建', '标注', '标签', '问题', '答案', '问答', '评测', '评估', '协议', '视频', '字幕', '音频',
    ],
    sectionTerms: [
      'method', 'methods', 'approach', 'model', 'framework', 'dataset', 'benchmark', 'data collection', 'annotation', 'evaluation',
      '方法', '模型', '框架', '数据集', '基准', '收集', '构建', '标注', '评测', '评估',
    ], slots: ['method_overview', 'method_step', 'experimental_setup', 'evaluation_scope'],
  },
  contributions: {
    terms: ['contribution', 'contributions', 'propose', 'introduce', 'novel', 'demonstrate', 'contribute', '贡献', '提出', '引入', '创新', '证明'],
    sectionTerms: ['abstract', 'introduction', 'conclusion', 'contribution', '摘要', '引言', '结论', '贡献'], slots: ['contribution', 'method_overview', 'main_result'],
  },
  relative_novelty: {
    terms: ['unlike', 'compared', 'prior', 'previous', 'existing', 'different', 'related', 'baseline', '相比', '不同', '已有', '现有', '先前', '相关工作'],
    sectionTerms: ['introduction', 'related', 'prior', 'method', '引言', '相关', '方法'], slots: ['relative_novelty', 'contribution', 'method_overview'],
  },
  experiments_ablations: {
    terms: ['experiment', 'evaluate', 'evaluation', 'dataset', 'baseline', 'result', 'results', 'table', 'ablation', 'performance', 'benchmark', '实验', '评估', '数据集', '结果', '消融', '性能', '基准'],
    sectionTerms: ['experiment', 'experiments', 'result', 'results', 'evaluation', 'ablation', '实验', '结果', '评估', '消融'], slots: ['main_result', 'ablation', 'experimental_setup', 'evaluation_scope'],
  },
  limitations: {
    terms: ['limitation', 'limitations', 'future', 'failure', 'fail', 'cannot', 'only', 'restricted', 'constraint', '局限', '限制', '未来', '失败', '无法', '仅', '约束'],
    sectionTerms: ['limitation', 'discussion', 'conclusion', 'future', '局限', '讨论', '结论', '未来'], slots: ['author_limitation', 'evaluation_scope', 'ablation'],
  },
};

const WORD = /[\p{L}\p{N}]+/gu;
const CJK = /[\p{Script=Han}]/u;

/**
 * Small deterministic tokenizer: word tokens for alphabetic/numeric text and
 * CJK uni/bi-grams for Chinese/Japanese/Korean text. It is deliberately local
 * and dependency-free so a PDF's text never leaves the browser during search.
 */
export function tokenizeForRetrieval(value: string): string[] {
  const normalized = value.normalize('NFKC').toLocaleLowerCase();
  const tokens: string[] = [];
  for (const match of normalized.matchAll(WORD)) {
    const term = match[0];
    if (!term) continue;
    if ([...term].some((character) => CJK.test(character))) {
      const characters = [...term].filter((character) => CJK.test(character));
      for (let index = 0; index < characters.length; index += 1) tokens.push(characters[index]);
      for (let index = 0; index + 1 < characters.length; index += 1) tokens.push(`${characters[index]}${characters[index + 1]}`);
    } else {
      tokens.push(term);
    }
  }
  return tokens;
}

function termFrequency(tokens: readonly string[]): Map<string, number> {
  const frequencies = new Map<string, number>();
  for (const token of tokens) frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
  return frequencies;
}

function includesAny(tokens: readonly string[], terms: readonly string[]): boolean {
  const available = new Set(tokens);
  return terms.some((term) => tokenizeForRetrieval(term).some((token) => available.has(token)));
}

/** Builds a re-generable, memory-only lexical index over already-local evidence. */
export function createRetrievalIndex(ledger: EvidenceLedger): RetrievalIndex {
  const records: RetrievalRecord[] = [];
  let excluded = 0;
  for (const candidate of ledger.candidates) {
    if (candidate.coverage === 'unreadable' || !isModelEligibleCandidate(candidate, ledger.candidates)) {
      excluded += 1;
      continue;
    }
    const tokens = tokenizeForRetrieval(candidate.quote);
    if (tokens.length === 0) {
      excluded += 1;
      continue;
    }
    records.push({ candidate, tokens, termFrequency: termFrequency(tokens), length: tokens.length, sectionTokens: tokenizeForRetrieval(candidate.section.title) });
  }
  return {
    version: LOCAL_RETRIEVAL_VERSION,
    documentVersion: ledger.documentVersion,
    candidateCount: records.length,
    records,
    diagnostics: records.length === 0
      ? ['No eligible readable body excerpts are available for local retrieval.']
      : [`${records.length} eligible readable body excerpt${records.length === 1 ? '' : 's'} indexed locally; ${excluded} candidate${excluded === 1 ? '' : 's'} excluded by the shared evidence quality rule.`],
  };
}

/** Builds a local lexical index over conservative, readable passages rather
 * than individual PDF.js text items. */
export function createPassageRetrievalIndex(collection: EvidencePassageCollection): PassageRetrievalIndex {
  return {
    documentVersion: collection.documentVersion,
    passages: collection.passages.filter((passage) => tokenizeForRetrieval(passage.text).length > 0),
    diagnostics: collection.passages.length
      ? [`${collection.passages.length} locally joined passages are available for retrieval.`]
      : ['No locally joined readable passages are available for retrieval.'],
  };
}

export function rankPassagesForPurpose(
  index: PassageRetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  maxPassages = 12,
): RankedEvidencePassage[] {
  if (!Number.isInteger(maxPassages) || maxPassages < 1) throw new Error('maxPassages must be a positive integer.');
  if (!index.passages.length) return [];
  const definition = QUERY_DEFINITIONS[purpose];
  const terms = queryTokens(definition);
  const records = index.passages.map((passage) => ({
    passage,
    tokens: tokenizeForRetrieval(passage.text),
    frequencies: termFrequency(tokenizeForRetrieval(passage.text)),
    sectionTokens: tokenizeForRetrieval(passage.sectionTitle),
  }));
  const averageLength = records.reduce((sum, record) => sum + record.tokens.length, 0) / records.length;
  const documentFrequency = new Map(terms.map((term) => [term, records.filter((record) => record.frequencies.has(term)).length]));
  return records.map((record, sourceIndex) => {
    let lexical = 0;
    const matchedTokens: string[] = [];
    for (const term of terms) {
      const frequency = record.frequencies.get(term) ?? 0;
      if (!frequency) continue;
      matchedTokens.push(term);
      const denominator = frequency + 1.2 * (1 - 0.75 + 0.75 * (record.tokens.length / averageLength));
      lexical += inverseDocumentFrequency(records.length, documentFrequency.get(term) ?? 0) * ((frequency * 2.2) / denominator);
    }
    const sectionBoost = includesAny(record.sectionTokens, definition.sectionTerms) ? 0.35 : 0;
    const slotBoost = record.passage.members.some((member) => definition.slots.includes(member.candidate.slot)) ? 0.15 : 0;
    return { passage: record.passage, score: lexical + sectionBoost + slotBoost,
      scoreBreakdown: { lexical, sectionBoost, slotBoost, matchedTokens },
      diagnostics: [lexical ? `Matched ${matchedTokens.length} local purpose token${matchedTokens.length === 1 ? '' : 's'}.` : 'No purpose query token matched; retained as readable global-body fallback.'], sourceIndex };
  }).sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .slice(0, maxPassages).map(({ sourceIndex: _sourceIndex, ...item }) => item);
}

/** Passage-level diversity is intentionally simple: rank by joined prose,
 * cap any page, and never reopen individual fragment selection. */
export function selectRankedPassagesForPurpose(index: PassageRetrievalIndex, purpose: DetailedRetrievalPurpose, options: RetrievalSelectionOptions): EvidencePassage[] {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  const perPageLimit = options.maxCandidatesPerPage ?? 2;
  const perPage = new Map<number, number>();
  const selected: EvidencePassage[] = [];
  for (const result of rankPassagesForPurpose(index, purpose, index.passages.length)) {
    const page = result.passage.pageIndex;
    if ((perPage.get(page) ?? 0) >= perPageLimit) continue;
    selected.push(result.passage); perPage.set(page, (perPage.get(page) ?? 0) + 1);
    if (selected.length === options.maxCandidates) break;
  }
  return selected;
}

function queryTokens(definition: QueryDefinition): string[] {
  return [...new Set([...definition.terms, ...(definition.supplementaryTerms ?? [])].flatMap(tokenizeForRetrieval))];
}

function inverseDocumentFrequency(recordCount: number, documentFrequency: number): number {
  return Math.log(1 + ((recordCount - documentFrequency + 0.5) / (documentFrequency + 0.5)));
}

/**
 * Ranks only pre-existing candidates. Section and slot signals are deliberately
 * weak bonuses after lexical evidence, never admission requirements.
 */
export function rankEvidenceForPurpose(
  index: RetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  maxCandidates = 12,
): RankedEvidenceCandidate[] {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  if (index.records.length === 0) return [];
  const definition = QUERY_DEFINITIONS[purpose];
  const terms = queryTokens(definition);
  const supplementaryTokens = new Set((definition.supplementaryTerms ?? []).flatMap(tokenizeForRetrieval));
  const documentFrequency = new Map(terms.map((term) => [term, 0]));
  for (const record of index.records) for (const term of terms) if (record.termFrequency.has(term)) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  const averageLength = index.records.reduce((total, record) => total + record.length, 0) / index.records.length;
  const k1 = 1.2;
  const b = 0.75;
  const ranked = index.records.map((record, sourceIndex) => {
    let lexical = 0;
    let supplementaryLexical = 0;
    const matchedSupplementaryTokens = new Set<string>();
    const matchedTokens: string[] = [];
    for (const term of terms) {
      const frequency = record.termFrequency.get(term) ?? 0;
      if (!frequency) continue;
      matchedTokens.push(term);
      const denominator = frequency + k1 * (1 - b + b * (record.length / averageLength));
      const contribution = inverseDocumentFrequency(index.records.length, documentFrequency.get(term) ?? 0) * ((frequency * (k1 + 1)) / denominator);
      if (supplementaryTokens.has(term)) {
        supplementaryLexical += contribution;
        matchedSupplementaryTokens.add(term);
      } else {
        lexical += contribution;
      }
    }
    // A single word such as "benchmark" or "evaluation" is often merely an
    // experiment mention. Treat supplementary cues as construction evidence
    // only when a passage supplies a small constellation of them.
    if (matchedSupplementaryTokens.size >= 2) lexical += supplementaryLexical * 0.35;
    const sectionBoost = includesAny(record.sectionTokens, definition.sectionTerms) ? 0.35 : 0;
    const slotBoost = definition.slots.includes(record.candidate.slot) ? 0.15 : 0;
    const fallback = lexical === 0;
    return {
      candidate: record.candidate,
      score: lexical + sectionBoost + slotBoost,
      scoreBreakdown: { lexical, sectionBoost, slotBoost, matchedTokens },
      diagnostics: [
        fallback ? 'No purpose query token matched; retained as readable global-body fallback.' : `Matched ${matchedTokens.length} local purpose token${matchedTokens.length === 1 ? '' : 's'}.`,
        sectionBoost ? 'Automatic/unknown section title matched a weak section prior.' : 'No section prior matched; global retrieval remains eligible.',
        slotBoost ? 'Section-derived slot added a weak prior only.' : 'No slot prior matched.',
      ],
      sourceIndex,
    };
  });
  return ranked
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .slice(0, maxCandidates)
    .map(({ sourceIndex: _sourceIndex, ...result }) => result);
}

type CandidatePosition = { pageIndex: number; sourceOrder: number; ledgerOrder: number };

function positionForCandidate(candidate: EvidenceCandidate, ledgerOrder: number): CandidatePosition {
  // Evidence IDs created by the ledger carry the original PDF.js page/item
  // coordinate. The ledger-order fallback keeps deterministic behavior for
  // synthetic/test ledgers without manufacturing a PDF location.
  const match = /:p(\d+):i(\d+)$/.exec(candidate.evidenceId);
  return match
    ? { pageIndex: Number(match[1]), sourceOrder: Number(match[2]), ledgerOrder }
    : { pageIndex: ledgerOrder, sourceOrder: ledgerOrder, ledgerOrder };
}

function sectionKey(candidate: EvidenceCandidate): string {
  return candidate.section.title.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function readableLength(value: string): number {
  return Array.from(value).filter((character) => /[\p{L}\p{N}]/u.test(character)).length;
}

/**
 * Turns a purpose ranking into a bounded, source-preserving stage order. It
 * never creates excerpts or alters anchors: every returned value is one of
 * the index's original ledger candidates.
 */
export function selectRankedEvidenceForPurpose(
  index: RetrievalIndex,
  purpose: DetailedRetrievalPurpose,
  options: RetrievalSelectionOptions,
): EvidenceCandidate[] {
  if (!Number.isInteger(options.maxCandidates) || options.maxCandidates < 1) throw new Error('maxCandidates must be a positive integer.');
  const maxCandidatesPerPage = options.maxCandidatesPerPage ?? 2;
  if (!Number.isInteger(maxCandidatesPerPage) || maxCandidatesPerPage < 1) throw new Error('maxCandidatesPerPage must be a positive integer.');
  if (index.records.length === 0) return [];

  const ranked = rankEvidenceForPurpose(index, purpose, index.records.length).map((item) => item.candidate);
  const originalOrder = new Map(index.records.map((record, index) => [record.candidate, index]));
  const positions = new Map(index.records.map((record, index) => [record.candidate, positionForCandidate(record.candidate, index)]));
  const selected: EvidenceCandidate[] = [];
  const selectedIds = new Set<string>();
  const selectedQuotes = new Set<string>();
  const perPage = new Map<number, number>();

  const add = (candidate: EvidenceCandidate): boolean => {
    const position = positions.get(candidate);
    const quoteKey = candidate.quote.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
    if (!position || !quoteKey || selectedIds.has(candidate.evidenceId) || selectedQuotes.has(quoteKey)) return false;
    if ((perPage.get(position.pageIndex) ?? 0) >= maxCandidatesPerPage || selected.length >= options.maxCandidates) return false;
    // At most two immediately adjacent text items may be selected. This is a
    // diversity cap, not a claim that PDF.js source order is reading order.
    const adjacentSelected = selected.filter((item) => {
      const other = positions.get(item);
      return other?.pageIndex === position.pageIndex && Math.abs(other.sourceOrder - position.sourceOrder) === 1;
    }).length;
    if (adjacentSelected >= 2) return false;
    selected.push(candidate);
    selectedIds.add(candidate.evidenceId);
    selectedQuotes.add(quoteKey);
    perPage.set(position.pageIndex, (perPage.get(position.pageIndex) ?? 0) + 1);
    return true;
  };

  for (const candidate of ranked) {
    if (!add(candidate)) continue;
    if (!options.includeAdjacent || selected.length >= options.maxCandidates || readableLength(candidate.quote) > 180) continue;
    const position = positions.get(candidate)!;
    const neighbour = index.records
      .map((record) => record.candidate)
      .filter((item) => item !== candidate && sectionKey(item) === sectionKey(candidate))
      .filter((item) => {
        const other = positions.get(item)!;
        return other.pageIndex === position.pageIndex && Math.abs(other.sourceOrder - position.sourceOrder) === 1;
      })
      .sort((left, right) => (originalOrder.get(left)! - originalOrder.get(candidate)!) - (originalOrder.get(right)! - originalOrder.get(candidate)!))[0];
    if (neighbour) add(neighbour);
  }
  return selected;
}

export function retrievalQueryDefinition(purpose: DetailedRetrievalPurpose): Readonly<QueryDefinition> {
  return QUERY_DEFINITIONS[purpose];
}
